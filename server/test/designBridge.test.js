'use strict'

const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const WebSocket = require('ws')

const {
  LOOPBACK_HOST,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  start,
  stop,
  validateConfig
} = require('../designBridge')
const { parseArgs } = require('../standalone')

const silentLogger = {
  log() {},
  warn() {},
  error() {}
}

function sampleConfig(overrides = {}) {
  return {
    schemaVersion: '1.0.0',
    file: { id: 'file-1', name: 'Shroom' },
    page: { id: 'page-1', name: '设备页' },
    exportedAt: '2026-08-10T00:00:00.000Z',
    instances: [
      {
        id: 'instance-1',
        name: 'Drawer / 设备状态',
        component: 'Drawer',
        import: '@/components/Drawer/Drawer',
        version: '1.0.0',
        props: { title: '设备状态', show: true }
      }
    ],
    ...overrides
  }
}

async function createBridge(t, options = {}) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shroom-bridge-test-'))
  const dir = options.dir || path.join(temporaryRoot, 'design')
  const bridge = await start({ port: 0, dir, logger: silentLogger, ...options })

  t.after(async () => {
    await stop(bridge)
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  return { bridge, dir, temporaryRoot }
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    const onError = (error) => {
      socket.off('open', onOpen)
      reject(error)
    }
    const onOpen = () => {
      socket.off('error', onError)
      resolve(socket)
    }
    socket.once('error', onError)
    socket.once('open', onOpen)
  })
}

function nextJson(socket, predicate = () => true, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('等待 WebSocket 消息超时'))
    }, timeout)

    const onMessage = (data, isBinary) => {
      if (isBinary) return
      let message
      try {
        message = JSON.parse(data.toString('utf8'))
      } catch {
        return
      }
      if (!predicate(message)) return
      cleanup()
      resolve(message)
    }

    const onClose = () => {
      cleanup()
      reject(new Error('收到预期消息前连接已关闭'))
    }

    function cleanup() {
      clearTimeout(timer)
      socket.off('message', onMessage)
      socket.off('close', onClose)
    }

    socket.on('message', onMessage)
    socket.once('close', onClose)
  })
}

function expectNoMessage(socket, timeout = 120) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage)
      resolve()
    }, timeout)
    const onMessage = (data) => {
      clearTimeout(timer)
      socket.off('message', onMessage)
      reject(new Error(`不应收到消息：${data.toString('utf8')}`))
    }
    socket.on('message', onMessage)
  })
}

async function hello(socket, role, protocolVersion = PROTOCOL_VERSION) {
  const response = nextJson(socket, (message) => message.type === 'hello:ack')
  socket.send(JSON.stringify({ type: 'hello', role, protocolVersion }))
  return response
}

async function registeredClient(url, role) {
  const socket = await connect(url)
  const acknowledgement = await hello(socket, role)
  assert.equal(acknowledgement.ok, true)
  return socket
}

test('配置校验只接受结构正确的 1.x schema', () => {
  assert.equal(validateConfig(sampleConfig()).valid, true)
  assert.equal(validateConfig(sampleConfig({ schemaVersion: '1.9.0' })).valid, true)
  assert.equal(validateConfig(sampleConfig({ schemaVersion: '2.0.0' })).valid, false)
  assert.equal(validateConfig({ schemaVersion: '1.0.0' }).valid, false)
  assert.equal(validateConfig(null).valid, false)
  assert.equal(
    validateConfig(sampleConfig({ instances: [{ props: [] }] })).valid,
    false
  )
})

test('slot 作为可选字符串字段透传，类型错误会被拒绝', () => {
  const withSlot = sampleConfig()
  withSlot.instances[0].slot = 'equipPanel.drawer'
  assert.equal(validateConfig(withSlot).valid, true)

  const badSlot = sampleConfig()
  badSlot.instances[0].slot = 42
  const result = validateConfig(badSlot)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => error.includes('slot')))
})

test('standalone 参数解析支持 --port 和 --dir', () => {
  const outputDirectory = path.join(os.tmpdir(), 'bridge-output')
  const options = parseArgs(['--port=8123', '--dir', outputDirectory])
  assert.equal(options.port, 8123)
  assert.equal(options.dir, path.resolve(outputDirectory))
  assert.throws(() => parseArgs(['--port', '70000']), /0 到 65535/)
  assert.throws(() => parseArgs(['--unknown']), /未知参数/)
})

test('服务只绑定回环地址并自动创建输出目录', async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shroom-bridge-bind-'))
  const dir = path.join(temporaryRoot, 'nested', 'design')
  const bridge = await start({ port: 0, dir, logger: silentLogger })
  t.after(async () => {
    await stop(bridge)
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  assert.equal(bridge.host, LOOPBACK_HOST)
  assert.equal(bridge.wss.address().address, LOOPBACK_HOST)
  assert.equal((await fs.stat(dir)).isDirectory(), true)
})

test('standalone CLI 可以启动并接受连接', async (t) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shroom-bridge-cli-'))
  const dir = path.join(temporaryRoot, 'output')
  const executable = path.join(__dirname, '..', 'standalone.js')
  const child = spawn(process.execPath, [executable, '--port', '0', '--dir', dir], {
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stdout = ''
  let stderr = ''

  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })

  t.after(async () => {
    if (child.exitCode === null) child.kill('SIGTERM')
    if (child.exitCode === null) await once(child, 'exit')
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  const match = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`CLI 启动超时\nstdout: ${stdout}\nstderr: ${stderr}`))
    }, 3000)
    const interval = setInterval(() => {
      const found = stdout.match(/ws:\/\/127\.0\.0\.1:(\d+)/)
      if (!found) return
      clearTimeout(timeout)
      clearInterval(interval)
      resolve(found)
    }, 10)
    child.once('exit', (code) => {
      clearTimeout(timeout)
      clearInterval(interval)
      reject(new Error(`CLI 提前退出 (${code})：${stderr}`))
    })
  })

  const socket = await connect(`ws://127.0.0.1:${match[1]}`)
  assert.equal((await hello(socket, 'frontend')).ok, true)
  socket.close()
  assert.match(stdout, /设计桥已启动/)
})

test('hello 注册 plugin 和 frontend 并返回确认', async (t) => {
  const { bridge } = await createBridge(t)
  const plugin = await connect(bridge.url)
  const frontend = await connect(bridge.url)

  assert.deepEqual(await hello(plugin, 'plugin'), {
    type: 'hello:ack',
    ok: true,
    role: 'plugin',
    protocolVersion: PROTOCOL_VERSION
  })
  assert.equal((await hello(frontend, 'frontend')).ok, true)
  assert.deepEqual(bridge.clientCounts, {
    total: 2,
    plugin: 1,
    frontend: 1,
    unregistered: 0
  })
})

test('不兼容或非法 hello 不会注册角色', async (t) => {
  const { bridge } = await createBridge(t)
  const socket = await connect(bridge.url)

  assert.equal((await hello(socket, 'plugin', '2.0')).ok, false)
  assert.deepEqual(bridge.clientCounts, {
    total: 1,
    plugin: 0,
    frontend: 0,
    unregistered: 1
  })

  const errorPromise = nextJson(socket, (message) => message.type === 'design:error')
  socket.send(JSON.stringify({ type: 'design:config', payload: sampleConfig() }))
  assert.equal((await errorPromise).code, 'hello_required')
})

test('plugin 配置会完整写入 current.json', async (t) => {
  const { bridge } = await createBridge(t)
  const plugin = await registeredClient(bridge.url, 'plugin')
  const config = sampleConfig()
  const acknowledgement = nextJson(plugin, (message) => message.type === 'design:ack')

  plugin.send(JSON.stringify({ type: 'design:config', payload: config }))
  assert.equal((await acknowledgement).ok, true)

  const stored = JSON.parse(await fs.readFile(bridge.file, 'utf8'))
  assert.deepEqual(stored, config)
})

test('连续配置按接收顺序原子替换且不残留临时文件', async (t) => {
  const { bridge, dir } = await createBridge(t)
  const plugin = await registeredClient(bridge.url, 'plugin')

  for (const title of ['第一次', '第二次']) {
    const config = sampleConfig()
    config.instances[0].props.title = title
    const acknowledgement = nextJson(plugin, (message) => message.type === 'design:ack')
    plugin.send(JSON.stringify({ type: 'design:config', payload: config }))
    assert.equal((await acknowledgement).ok, true)
  }

  const stored = JSON.parse(await fs.readFile(bridge.file, 'utf8'))
  assert.equal(stored.instances[0].props.title, '第二次')
  assert.deepEqual(await fs.readdir(dir), ['current.json'])
})

test('合法配置以同一 envelope 广播给所有 frontend', async (t) => {
  const { bridge } = await createBridge(t)
  const plugin = await registeredClient(bridge.url, 'plugin')
  const frontendOne = await registeredClient(bridge.url, 'frontend')
  const frontendTwo = await registeredClient(bridge.url, 'frontend')
  const envelope = { type: 'design:config', payload: sampleConfig(), traceId: 'trace-1' }
  const oneMessage = nextJson(frontendOne)
  const twoMessage = nextJson(frontendTwo)
  const acknowledgement = nextJson(plugin, (message) => message.type === 'design:ack')

  plugin.send(JSON.stringify(envelope))

  assert.deepEqual(await oneMessage, envelope)
  assert.deepEqual(await twoMessage, envelope)
  assert.equal((await acknowledgement).frontendCount, 2)
})

test('成功 ack 返回转发数和绝对落盘路径', async (t) => {
  const { bridge } = await createBridge(t)
  const plugin = await registeredClient(bridge.url, 'plugin')
  await registeredClient(bridge.url, 'frontend')
  const acknowledgement = nextJson(plugin, (message) => message.type === 'design:ack')

  plugin.send(JSON.stringify({ type: 'design:config', payload: sampleConfig() }))
  const message = await acknowledgement

  assert.equal(message.ok, true)
  assert.equal(message.frontendCount, 1)
  assert.equal(message.file, bridge.file)
  assert.equal(path.isAbsolute(message.file), true)
})

test('非法 schema 返回失败 ack 且不落盘、不广播', async (t) => {
  const { bridge } = await createBridge(t)
  const plugin = await registeredClient(bridge.url, 'plugin')
  const frontend = await registeredClient(bridge.url, 'frontend')
  const acknowledgement = nextJson(plugin, (message) => message.type === 'design:ack')
  const noBroadcast = expectNoMessage(frontend)

  plugin.send(
    JSON.stringify({
      type: 'design:config',
      payload: sampleConfig({ schemaVersion: '2.0.0' })
    })
  )

  const message = await acknowledgement
  assert.equal(message.ok, false)
  assert.match(message.error, /配置校验未通过/)
  assert.equal(message.message, message.error)
  await noBroadcast
  await assert.rejects(fs.access(bridge.file), /ENOENT/)
})

test('未 hello 和角色越权的消息会被拒绝', async (t) => {
  const { bridge } = await createBridge(t)
  const anonymous = await connect(bridge.url)
  const frontend = await registeredClient(bridge.url, 'frontend')
  const plugin = await registeredClient(bridge.url, 'plugin')

  let response = nextJson(anonymous, (message) => message.type === 'design:error')
  anonymous.send(JSON.stringify({ type: 'design:command', command: 'refresh' }))
  const anonymousError = await response
  assert.equal(anonymousError.code, 'hello_required')
  assert.equal(anonymousError.message, anonymousError.error)

  response = nextJson(frontend, (message) => message.type === 'design:error')
  frontend.send(JSON.stringify({ type: 'design:config', payload: sampleConfig() }))
  assert.equal((await response).code, 'forbidden')

  response = nextJson(plugin, (message) => message.type === 'design:error')
  plugin.send(JSON.stringify({ type: 'design:command', command: 'refresh' }))
  assert.equal((await response).code, 'forbidden')
})

test('frontend command 原样反向转发给 plugin', async (t) => {
  const { bridge } = await createBridge(t)
  const pluginOne = await registeredClient(bridge.url, 'plugin')
  const pluginTwo = await registeredClient(bridge.url, 'plugin')
  const frontend = await registeredClient(bridge.url, 'frontend')
  const command = {
    type: 'design:command',
    command: 'scaffoldProperties',
    payload: { component: 'Drawer' },
    requestId: 'request-1'
  }
  const oneMessage = nextJson(pluginOne)
  const twoMessage = nextJson(pluginTwo)

  frontend.send(JSON.stringify(command))

  assert.deepEqual(await oneMessage, command)
  assert.deepEqual(await twoMessage, command)
})

test('畸形 JSON 返回错误后连接仍可继续使用', async (t) => {
  const { bridge } = await createBridge(t)
  const socket = await connect(bridge.url)
  const errorMessage = nextJson(socket, (message) => message.type === 'design:error')

  socket.send('{not-json')
  assert.equal((await errorMessage).code, 'invalid_json')
  assert.equal((await hello(socket, 'plugin')).ok, true)
  assert.equal(bridge.clientCounts.plugin, 1)
})

test('超限消息被关闭且 stop 清理其余 socket 并可重复调用', async (t) => {
  const { bridge } = await createBridge(t)
  const oversized = await connect(bridge.url)
  const oversizedClosed = once(oversized, 'close')

  oversized.send(Buffer.alloc(MAX_MESSAGE_BYTES + 1, 0x61))
  const [closeCode] = await oversizedClosed
  assert.equal(closeCode, 1009)

  const plugin = await registeredClient(bridge.url, 'plugin')
  const pluginClosed = once(plugin, 'close')
  await stop(bridge)
  const [stopCode] = await pluginClosed
  assert.equal(stopCode, 1001)
  assert.deepEqual(bridge.clientCounts, {
    total: 0,
    plugin: 0,
    frontend: 0,
    unregistered: 0
  })
  await stop(bridge)
})
