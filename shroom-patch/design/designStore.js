import { create } from 'zustand'

export const DESIGN_BRIDGE_PROTOCOL_VERSION = '1.0'
export const DEFAULT_DESIGN_BRIDGE_URL = 'ws://127.0.0.1:7311'
export const DESIGN_BRIDGE_RECONNECT_DELAY = 3000

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

function isJsonSafeValue(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (seen.has(value)) return false

  const prototype = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false

  seen.add(value)
  let entries
  try {
    entries = Array.isArray(value) ? value : Object.values(value)
  } catch {
    seen.delete(value)
    return false
  }

  const valid = entries.every((entry) => isJsonSafeValue(entry, seen))
  seen.delete(value)
  return valid
}

function isCommandPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return isJsonSafeValue(value)
}

export function isDesignConfig(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof value.schemaVersion === 'string' &&
      /^1\./.test(value.schemaVersion) &&
      Array.isArray(value.instances),
  )
}

/**
 * Accepts the 1.0 protocol envelope and the legacy direct-payload shape.
 * Unknown messages deliberately return null so acknowledgements and errors do
 * not accidentally replace the active design configuration.
 */
export function normalizeDesignConfigMessage(message) {
  let value = message

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }

  if (!value || typeof value !== 'object') return null

  if (value.type === 'design:config') {
    return isDesignConfig(value.payload) ? value.payload : null
  }

  return isDesignConfig(value) ? value : null
}

function toIsoTime(now) {
  const value = typeof now === 'function' ? now() : Date.now()
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

/**
 * Creates an isolated Zustand store. The optional dependencies make the
 * transport testable and keep SSR/non-browser environments safe.
 */
export function createDesignStore(options = {}) {
  const reconnectDelay = Number.isFinite(options.reconnectDelay)
    ? Math.max(0, options.reconnectDelay)
    : DESIGN_BRIDGE_RECONNECT_DELAY
  const setTimer = options.setTimeout || globalThis.setTimeout
  const clearTimer = options.clearTimeout || globalThis.clearTimeout
  const now = options.now || Date.now
  const webSocketWasProvided = hasOwn(options, 'WebSocketImpl')

  let socket = null
  let reconnectTimer = null
  let reconnectEnabled = false
  let activeUrl = options.url || DEFAULT_DESIGN_BRIDGE_URL
  let connectionGeneration = 0
  let useStore

  const getWebSocket = () => {
    if (webSocketWasProvided) return options.WebSocketImpl
    return typeof globalThis !== 'undefined' ? globalThis.WebSocket : undefined
  }

  const setConnectionState = (status, error = null) => {
    useStore.setState({
      status,
      connectionStatus: status,
      connected: status === 'connected',
      error,
    })
  }

  const clearReconnectTimer = () => {
    if (reconnectTimer !== null) {
      clearTimer(reconnectTimer)
      reconnectTimer = null
    }
  }

  const scheduleReconnect = () => {
    if (!reconnectEnabled || reconnectTimer !== null) return

    setConnectionState('reconnecting', useStore.getState().error)
    reconnectTimer = setTimer(() => {
      reconnectTimer = null
      openSocket()
    }, reconnectDelay)
  }

  const openSocket = () => {
    if (!reconnectEnabled) return
    if (socket && (socket.readyState === 0 || socket.readyState === 1)) return

    const WebSocketImpl = getWebSocket()
    if (typeof WebSocketImpl !== 'function') {
      setConnectionState('unavailable', '当前环境不支持 WebSocket')
      return
    }

    setConnectionState('connecting')

    let nextSocket
    try {
      nextSocket = new WebSocketImpl(activeUrl)
    } catch (error) {
      setConnectionState('error', error instanceof Error ? error.message : String(error))
      scheduleReconnect()
      return
    }

    socket = nextSocket
    const generation = ++connectionGeneration

    nextSocket.onopen = () => {
      if (generation !== connectionGeneration || socket !== nextSocket) return

      try {
        nextSocket.send(
          JSON.stringify({
            type: 'hello',
            role: 'frontend',
            protocolVersion: DESIGN_BRIDGE_PROTOCOL_VERSION,
          }),
        )
        setConnectionState('connected')
      } catch (error) {
        setConnectionState('error', error instanceof Error ? error.message : String(error))
        try {
          nextSocket.close()
        } catch {
          scheduleReconnect()
        }
      }
    }

    nextSocket.onmessage = (event) => {
      if (generation !== connectionGeneration || socket !== nextSocket) return
      const config = normalizeDesignConfigMessage(event?.data)
      if (!config) return

      useStore.setState({
        config,
        lastSyncedAt: toIsoTime(now),
      })
    }

    nextSocket.onerror = (event) => {
      if (generation !== connectionGeneration || socket !== nextSocket) return
      const message = event?.message || 'WebSocket 连接异常'
      setConnectionState('error', message)
      try {
        nextSocket.close()
      } catch {
        socket = null
        scheduleReconnect()
      }
    }

    nextSocket.onclose = () => {
      if (generation !== connectionGeneration || socket !== nextSocket) return
      socket = null

      if (reconnectEnabled) scheduleReconnect()
      else setConnectionState('disconnected')
    }
  }

  const connect = (url) => {
    const nextUrl = typeof url === 'string' && url.trim() ? url.trim() : activeUrl
    const urlChanged = nextUrl !== activeUrl
    activeUrl = nextUrl
    reconnectEnabled = true
    clearReconnectTimer()

    useStore.setState({ url: activeUrl })

    if (urlChanged && socket) {
      const previousSocket = socket
      socket = null
      connectionGeneration += 1
      previousSocket.onopen = null
      previousSocket.onmessage = null
      previousSocket.onerror = null
      previousSocket.onclose = null
      try {
        previousSocket.close()
      } catch {
        // A replacement connection is still safe to open.
      }
    }

    openSocket()
  }

  const disconnect = () => {
    reconnectEnabled = false
    clearReconnectTimer()
    connectionGeneration += 1

    const previousSocket = socket
    socket = null
    if (previousSocket) {
      previousSocket.onopen = null
      previousSocket.onmessage = null
      previousSocket.onerror = null
      previousSocket.onclose = null
      try {
        previousSocket.close()
      } catch {
        // The public disconnect operation is intentionally idempotent.
      }
    }

    setConnectionState('disconnected')
  }

  const sendCommand = (command, payload = {}) => {
    if (typeof command !== 'string' || !command.trim() || !isCommandPayload(payload)) return false
    if (!socket || socket.readyState !== 1 || typeof socket.send !== 'function') return false

    try {
      socket.send(
        JSON.stringify({
          type: 'design:command',
          command: command.trim(),
          payload,
        }),
      )
      return true
    } catch {
      return false
    }
  }

  const applyConfig = (config) => {
    if (!isDesignConfig(config)) return false
    useStore.setState({ config, lastSyncedAt: toIsoTime(now) })
    return true
  }

  useStore = create(() => ({
    url: activeUrl,
    config: null,
    lastSyncedAt: null,
    status: 'idle',
    connectionStatus: 'idle',
    connected: false,
    error: null,
    connect,
    disconnect,
    sendCommand,
    applyConfig,
    clearConfig: () => useStore.setState({ config: null, lastSyncedAt: null }),
  }))

  return useStore
}

export const useDesignStore = createDesignStore()

/**
 * Applies a locally imported current.json to the shared store without opening
 * a WebSocket connection. This is the static/manual-copy integration path.
 */
export function applyStaticDesignConfig(config) {
  return useDesignStore.getState().applyConfig(config)
}

export default useDesignStore
