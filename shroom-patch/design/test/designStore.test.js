import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyStaticDesignConfig,
  createDesignStore,
  normalizeDesignConfigMessage,
  useDesignStore,
} from '../designStore.js'

const payload = {
  schemaVersion: '1.0.0',
  file: { id: 'file-id', name: '座椅控制台' },
  page: { id: 'page-id', name: '设备状态' },
  exportedAt: '2026-08-10T08:00:00.000Z',
  instances: [
    {
      id: 'instance-id',
      name: 'Drawer/设备状态',
      component: 'Drawer',
      import: '@/components/Drawer/Drawer',
      version: '1.0.0',
      props: { title: '设备状态', show: true },
    },
  ],
}

class FakeWebSocket {
  static instances = []

  constructor(url) {
    this.url = url
    this.readyState = 0
    this.sent = []
    FakeWebSocket.instances.push(this)
  }

  send(message) {
    this.sent.push(message)
  }

  open() {
    this.readyState = 1
    this.onopen?.({})
  }

  receive(message) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }

  close() {
    this.readyState = 3
    this.onclose?.({})
  }
}

test('连接后声明 frontend 角色并消费 design:config', () => {
  FakeWebSocket.instances = []
  const store = createDesignStore({
    WebSocketImpl: FakeWebSocket,
    now: () => '2026-08-10T09:00:00.000Z',
  })

  store.getState().connect()
  const socket = FakeWebSocket.instances[0]
  assert.equal(store.getState().status, 'connecting')

  socket.open()
  assert.deepEqual(JSON.parse(socket.sent[0]), {
    type: 'hello',
    role: 'frontend',
    protocolVersion: '1.0',
  })
  assert.equal(store.getState().status, 'connected')

  socket.receive({ type: 'design:config', payload })
  assert.deepEqual(store.getState().config, payload)
  assert.equal(store.getState().lastSyncedAt, '2026-08-10T09:00:00.000Z')
  store.getState().disconnect()
})

test('兼容服务端直接发送 payload 的旧消息形态', () => {
  assert.equal(normalizeDesignConfigMessage(payload), payload)
  assert.equal(normalizeDesignConfigMessage(JSON.stringify(payload)).schemaVersion, '1.0.0')
  assert.equal(normalizeDesignConfigMessage('{invalid json'), null)
  assert.equal(normalizeDesignConfigMessage({ type: 'design:ack', ok: true }), null)
})

test('静态配置入口校验并应用 current.json，且不连接 WebSocket', () => {
  useDesignStore.getState().disconnect()
  useDesignStore.getState().clearConfig()
  const statusBefore = useDesignStore.getState().status

  assert.equal(applyStaticDesignConfig(payload), true)
  assert.equal(useDesignStore.getState().config, payload)
  assert.equal(useDesignStore.getState().status, statusBefore)

  assert.equal(applyStaticDesignConfig({ schemaVersion: '2.0.0', instances: [] }), false)
  assert.equal(useDesignStore.getState().config, payload)
  assert.equal(useDesignStore.getState().status, statusBefore)

  useDesignStore.getState().clearConfig()
})

test('仅在连接打开且命令合法时发送反向命令', () => {
  FakeWebSocket.instances = []
  const store = createDesignStore({ WebSocketImpl: FakeWebSocket })

  assert.equal(store.getState().sendCommand('select-instance', { instanceId: 'drawer-a' }), false)
  store.getState().connect()
  const socket = FakeWebSocket.instances[0]
  assert.equal(store.getState().sendCommand('select-instance', { instanceId: 'drawer-a' }), false)

  socket.open()
  assert.equal(store.getState().sendCommand('select-instance', { instanceId: 'drawer-a' }), true)
  assert.deepEqual(JSON.parse(socket.sent[1]), {
    type: 'design:command',
    command: 'select-instance',
    payload: { instanceId: 'drawer-a' },
  })

  assert.equal(store.getState().sendCommand('', {}), false)
  assert.equal(store.getState().sendCommand('select-instance', { callback: () => {} }), false)
  const cyclicPayload = {}
  cyclicPayload.self = cyclicPayload
  assert.equal(store.getState().sendCommand('select-instance', cyclicPayload), false)
  assert.equal(socket.sent.length, 2)

  store.getState().disconnect()
  assert.equal(store.getState().sendCommand('select-instance'), false)
})

test('断线后按配置延迟自动重连，手动断开则停止', async () => {
  FakeWebSocket.instances = []
  const store = createDesignStore({ WebSocketImpl: FakeWebSocket, reconnectDelay: 5 })

  store.getState().connect('ws://127.0.0.1:7311')
  FakeWebSocket.instances[0].open()
  FakeWebSocket.instances[0].close()
  assert.equal(store.getState().status, 'reconnecting')

  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(FakeWebSocket.instances.length, 2)
  store.getState().disconnect()

  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(FakeWebSocket.instances.length, 2)
  assert.equal(store.getState().status, 'disconnected')
})

test('SSR 或无 WebSocket 环境安全降级', () => {
  const store = createDesignStore({ WebSocketImpl: null })
  assert.doesNotThrow(() => store.getState().connect())
  assert.equal(store.getState().status, 'unavailable')
  assert.match(store.getState().error, /WebSocket/)
  store.getState().disconnect()
})
