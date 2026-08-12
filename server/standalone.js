#!/usr/bin/env node
'use strict'

const path = require('node:path')
const { DEFAULT_PORT, start, stop } = require('./designBridge')

function usage() {
  return [
    '用法: node standalone.js [--port 7311] [--dir ./design]',
    '',
    '选项:',
    '  --port <端口>  WebSocket 端口，默认 7311',
    '  --dir <目录>   current.json 输出目录，默认 ./design',
    '  -h, --help     显示帮助'
  ].join('\n')
}

function readOption(argv, index, name) {
  const argument = argv[index]
  const prefix = `${name}=`
  if (argument.startsWith(prefix)) {
    return { value: argument.slice(prefix.length), nextIndex: index }
  }

  if (argument === name) {
    if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) {
      throw new Error(`${name} 缺少参数`)
    }
    return { value: argv[index + 1], nextIndex: index + 1 }
  }

  return null
}

function parseArgs(argv) {
  const options = {
    port: DEFAULT_PORT,
    dir: path.resolve(process.cwd(), 'design'),
    help: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]

    if (argument === '--help' || argument === '-h') {
      options.help = true
      continue
    }

    const portOption = readOption(argv, index, '--port')
    if (portOption) {
      if (!/^\d+$/.test(portOption.value)) {
        throw new Error('--port 必须是 0 到 65535 之间的整数')
      }
      options.port = Number(portOption.value)
      if (options.port > 65535) {
        throw new Error('--port 必须是 0 到 65535 之间的整数')
      }
      index = portOption.nextIndex
      continue
    }

    const dirOption = readOption(argv, index, '--dir')
    if (dirOption) {
      if (!dirOption.value) throw new Error('--dir 不能为空')
      options.dir = path.resolve(dirOption.value)
      index = dirOption.nextIndex
      continue
    }

    throw new Error(`未知参数：${argument}`)
  }

  return options
}

function printGuide(bridge) {
  console.log('')
  console.log('设计桥已启动，接下来：')
  console.log(`  1. 在 MasterGo 插件里把服务地址填为 ${bridge.url}`)
  console.log('  2. 选中组件实例后点「导出并推送」')
  console.log(`  3. 配置会写入 ${bridge.file}`)
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(usage())
    return null
  }

  const bridge = await start(options)
  printGuide(bridge)

  let stopping = false
  const shutdown = async () => {
    if (stopping) return
    stopping = true
    await stop(bridge)
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  return bridge
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[designBridge] 启动失败：${error.message}`)
    process.exitCode = 1
  })
}

module.exports = { main, parseArgs, printGuide, usage }
