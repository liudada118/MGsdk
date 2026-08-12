'use strict'

const { EventEmitter } = require('node:events')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const fs = require('node:fs/promises')
const { WebSocket, WebSocketServer } = require('ws')

const LOOPBACK_HOST = '127.0.0.1'
const DEFAULT_PORT = 7311
const PROTOCOL_VERSION = '1.0'
const MAX_MESSAGE_BYTES = 1024 * 1024
const ROLE_PLUGIN = 'plugin'
const ROLE_FRONTEND = 'frontend'
const ALLOWED_ROLES = new Set([ROLE_PLUGIN, ROLE_FRONTEND])

let defaultBridge = null

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isVersionFromMajorOne(value) {
  return (
    typeof value === 'string' &&
    /^1(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)
  )
}

/**
 * Validate the versioned transport schema without making newer 1.x producers
 * depend on every optional metadata field understood by this bridge.
 */
function validateConfig(payload) {
  const errors = []

  if (!isRecord(payload)) {
    return { valid: false, errors: ['payload 必须是 JSON 对象'] }
  }

  if (!isVersionFromMajorOne(payload.schemaVersion)) {
    errors.push('schemaVersion 必须是 1.x 版本')
  }

  if (!Array.isArray(payload.instances)) {
    errors.push('instances 必须是数组')
  } else {
    payload.instances.forEach((instance, index) => {
      if (!isRecord(instance)) {
        errors.push(`instances[${index}] 必须是对象`)
        return
      }

      for (const key of ['id', 'name', 'component', 'import', 'version', 'slot']) {
        if (key in instance && typeof instance[key] !== 'string') {
          errors.push(`instances[${index}].${key} 必须是字符串`)
        }
      }

      if ('props' in instance && !isRecord(instance.props)) {
        errors.push(`instances[${index}].props 必须是对象`)
      }
      if ('unmapped' in instance && !isRecord(instance.unmapped)) {
        errors.push(`instances[${index}].unmapped 必须是对象`)
      }
    })
  }

  for (const key of ['file', 'page']) {
    if (key in payload && !isRecord(payload[key])) {
      errors.push(`${key} 必须是对象`)
      continue
    }

    if (isRecord(payload[key])) {
      for (const field of ['id', 'name']) {
        if (field in payload[key] && typeof payload[key][field] !== 'string') {
          errors.push(`${key}.${field} 必须是字符串`)
        }
      }
    }
  }

  if ('exportedAt' in payload && typeof payload.exportedAt !== 'string') {
    errors.push('exportedAt 必须是字符串')
  }

  return { valid: errors.length === 0, errors }
}

function normalizePort(value) {
  const port = value === undefined ? DEFAULT_PORT : Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new TypeError('port 必须是 0 到 65535 之间的整数')
  }
  return port
}

function log(logger, level, message) {
  const method = logger && (logger[level] || logger.log)
  if (typeof method === 'function') {
    method.call(logger, message)
  }
}

async function writeJsonAtomically(filePath, value) {
  const directory = path.dirname(filePath)
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  )
  let handle

  await fs.mkdir(directory, { recursive: true })

  try {
    handle = await fs.open(temporaryPath, 'wx', 0o600)
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await fs.rename(temporaryPath, filePath)
  } finally {
    if (handle) {
      await handle.close().catch(() => {})
    }
    await fs.unlink(temporaryPath).catch((error) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}

class DesignBridge extends EventEmitter {
  constructor(options = {}) {
    super()

    this.host = LOOPBACK_HOST
    this.requestedPort = normalizePort(options.port)
    this.dir = path.resolve(options.dir || path.join(process.cwd(), 'design'))
    this.file = path.join(this.dir, 'current.json')
    this.maxPayload = options.maxPayload || MAX_MESSAGE_BYTES
    this.logger = options.logger === undefined ? console : options.logger

    this.wss = null
    this.clients = new Map()
    this.plugins = new Set()
    this.frontends = new Set()
    this._listenPromise = null
    this._stopPromise = null
    this._writeTail = Promise.resolve()
    this._stopping = false
  }

  get port() {
    if (!this.wss) return this.requestedPort
    const address = this.wss.address()
    return address && typeof address === 'object' ? address.port : this.requestedPort
  }

  get url() {
    return `ws://${this.host}:${this.port}`
  }

  get clientCounts() {
    return {
      total: this.clients.size,
      plugin: this.plugins.size,
      frontend: this.frontends.size,
      unregistered: this.clients.size - this.plugins.size - this.frontends.size
    }
  }

  listen() {
    if (this._listenPromise) return this._listenPromise

    this._listenPromise = this._listen()
    return this._listenPromise
  }

  async _listen() {
    await fs.mkdir(this.dir, { recursive: true })

    if (this._stopping) {
      throw new Error('设计桥已停止')
    }

    this.wss = new WebSocketServer({
      host: LOOPBACK_HOST,
      port: this.requestedPort,
      clientTracking: false,
      perMessageDeflate: false,
      maxPayload: this.maxPayload
    })

    this.wss.on('connection', (socket) => this._handleConnection(socket))
    this.wss.on('error', (error) => {
      log(this.logger, 'error', `[designBridge] 服务错误：${error.message}`)
      this.emit('serverError', error)
    })

    await new Promise((resolve, reject) => {
      const onListening = () => {
        this.wss.off('error', onStartupError)
        resolve()
      }
      const onStartupError = (error) => {
        this.wss.off('listening', onListening)
        reject(error)
      }

      this.wss.once('listening', onListening)
      this.wss.once('error', onStartupError)
    })

    log(this.logger, 'log', `[designBridge] 已监听 ${this.url}`)
    log(this.logger, 'log', `[designBridge] 配置输出目录 ${this.dir}`)
    this.emit('listening', { host: this.host, port: this.port, url: this.url })
    return this
  }

  _handleConnection(socket) {
    const context = { role: null }
    this.clients.set(socket, context)
    this.emit('connection', socket)

    socket.on('message', (data, isBinary) => {
      if (this._stopping) return
      this._handleMessage(socket, context, data, isBinary)
    })

    socket.on('close', () => {
      this._removeClient(socket, context)
    })

    socket.on('error', (error) => {
      log(this.logger, 'warn', `[designBridge] 客户端连接错误：${error.message}`)
    })
  }

  _removeClient(socket, context) {
    this.clients.delete(socket)
    this.plugins.delete(socket)
    this.frontends.delete(socket)
    context.role = null
    this.emit('disconnect', socket)
  }

  _handleMessage(socket, context, data, isBinary) {
    if (isBinary) {
      this._sendError(socket, 'unsupported_data', '只接受 UTF-8 JSON 文本消息')
      return
    }

    let message
    try {
      message = JSON.parse(data.toString('utf8'))
    } catch {
      this._sendError(socket, 'invalid_json', '消息不是有效的 JSON')
      return
    }

    if (!isRecord(message) || typeof message.type !== 'string') {
      this._sendError(socket, 'invalid_message', '消息必须是带 type 的 JSON 对象')
      return
    }

    if (message.type === 'hello') {
      this._handleHello(socket, context, message)
      return
    }

    if (!context.role) {
      this._sendError(socket, 'hello_required', '请先发送 hello 消息注册客户端角色')
      return
    }

    if (message.type === 'design:config') {
      if (context.role !== ROLE_PLUGIN) {
        this._sendError(socket, 'forbidden', '只有 plugin 可以发送 design:config')
        return
      }
      this._handleConfig(socket, message)
      return
    }

    if (message.type === 'design:command') {
      if (context.role !== ROLE_FRONTEND) {
        this._sendError(socket, 'forbidden', '只有 frontend 可以发送 design:command')
        return
      }
      if (typeof message.command !== 'string' || message.command.trim() === '') {
        this._sendError(socket, 'invalid_command', 'command 必须是非空字符串')
        return
      }
      this._broadcast(this.plugins, message)
      return
    }

    this._sendError(socket, 'unknown_type', `不支持的消息类型：${message.type}`)
  }

  _handleHello(socket, context, message) {
    if (!ALLOWED_ROLES.has(message.role)) {
      const error = 'role 必须是 plugin 或 frontend'
      this._safeSend(socket, {
        type: 'hello:ack',
        ok: false,
        message: error,
        error
      })
      return
    }

    if (!isVersionFromMajorOne(message.protocolVersion)) {
      const error = 'protocolVersion 必须兼容 1.x'
      this._safeSend(socket, {
        type: 'hello:ack',
        ok: false,
        message: error,
        error
      })
      return
    }

    this.plugins.delete(socket)
    this.frontends.delete(socket)
    context.role = message.role
    const roleSet = message.role === ROLE_PLUGIN ? this.plugins : this.frontends
    roleSet.add(socket)

    this._safeSend(socket, {
      type: 'hello:ack',
      ok: true,
      role: message.role,
      protocolVersion: PROTOCOL_VERSION
    })
  }

  _handleConfig(socket, message) {
    const validation = validateConfig(message.payload)
    if (!validation.valid) {
      const error = `配置校验未通过：${validation.errors.join('；')}`
      log(this.logger, 'warn', `[designBridge] ${error}`)
      this._safeSend(socket, {
        type: 'design:ack',
        ok: false,
        message: error,
        error,
        errors: validation.errors
      })
      return
    }

    this._writeTail = this._writeTail
      .catch(() => {})
      .then(async () => {
        await writeJsonAtomically(this.file, message.payload)
        const frontendCount = this._broadcast(this.frontends, message)
        this._safeSend(socket, {
          type: 'design:ack',
          ok: true,
          frontendCount,
          file: this.file
        })

        const instanceCount = message.payload.instances.length
        log(
          this.logger,
          'log',
          `[designBridge] 已接收配置：${instanceCount} 个顶层实例，落盘 ${this.file}，转发 ${frontendCount} 个前端`
        )
        this.emit('config', message.payload)
      })
      .catch((error) => {
        const errorMessage = `配置落盘失败：${error.message}`
        log(this.logger, 'error', `[designBridge] ${errorMessage}`)
        this._safeSend(socket, {
          type: 'design:ack',
          ok: false,
          message: errorMessage,
          error: errorMessage
        })
      })
  }

  _broadcast(recipients, message) {
    let sent = 0
    for (const socket of recipients) {
      if (this._safeSend(socket, message)) sent += 1
    }
    return sent
  }

  _sendError(socket, code, error) {
    this._safeSend(socket, {
      type: 'design:error',
      ok: false,
      code,
      message: error,
      error
    })
  }

  _safeSend(socket, value) {
    if (socket.readyState !== WebSocket.OPEN) return false
    try {
      socket.send(JSON.stringify(value))
      return true
    } catch (error) {
      log(this.logger, 'warn', `[designBridge] 消息发送失败：${error.message}`)
      return false
    }
  }

  stop() {
    if (this._stopPromise) return this._stopPromise

    this._stopping = true
    this._stopPromise = this._stop()
    return this._stopPromise
  }

  async _stop() {
    if (!this.wss) return

    for (const socket of this.clients.keys()) {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1001, 'design bridge stopping')
      }
    }

    const forceCloseTimer = setTimeout(() => {
      for (const socket of this.clients.keys()) {
        if (socket.readyState !== WebSocket.CLOSED) socket.terminate()
      }
    }, 100)
    forceCloseTimer.unref()

    const closeServer = new Promise((resolve) => {
      this.wss.close(() => resolve())
    })

    await Promise.all([this._writeTail.catch(() => {}), closeServer])
    clearTimeout(forceCloseTimer)

    this.clients.clear()
    this.plugins.clear()
    this.frontends.clear()
    this.emit('close')
  }
}

async function start(options = {}) {
  const bridge = new DesignBridge(options)
  defaultBridge = bridge

  try {
    return await bridge.listen()
  } catch (error) {
    if (defaultBridge === bridge) defaultBridge = null
    await bridge.stop().catch(() => {})
    throw error
  }
}

async function stop(bridge = defaultBridge) {
  if (!bridge) return
  const resolvedBridge = await bridge
  await resolvedBridge.stop()
  if (defaultBridge === resolvedBridge) defaultBridge = null
}

module.exports = {
  DEFAULT_PORT,
  LOOPBACK_HOST,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  DesignBridge,
  start,
  stop,
  validateConfig,
  writeJsonAtomically
}
