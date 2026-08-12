#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const Derive = require('../plugin/src/derive')

const manifestPath = path.join(__dirname, '..', 'design-system', 'components.json')
const outputPath = path.join(__dirname, '..', 'shroom-patch', 'design', 'generated', 'components.js')

function readManifest() {
  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`无法读取组件清单 ${manifestPath}：${error.message}`)
  }

  const validation = Derive.validateManifest(manifest)
  if (!validation.valid) {
    throw new Error(`组件清单不合法：\n  - ${validation.errors.join('\n  - ')}`)
  }
  return manifest
}

function renderRegistry(manifest) {
  const entries = Derive.listComponents(manifest).map((componentName) => {
    const entry = Derive.deriveRegistryEntry(manifest, componentName)
    return `  ${JSON.stringify(componentName)}: ${JSON.stringify(entry, null, 2)
      .split('\n')
      .join('\n  ')},`
  })

  return [
    '// 本文件由 npm run generate 从 design-system/components.json 生成，请不要手工编辑。',
    '// 组件清单是唯一真相：改清单后重新生成，MasterGo 属性、shroom/contract 和这里会保持一致。',
    '',
    'export const generatedComponents = {',
    ...entries,
    '}',
    '',
    'export default generatedComponents',
    ''
  ].join('\n')
}

function generate() {
  const manifest = readManifest()
  const contents = renderRegistry(manifest)
  const previous = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : ''

  return {
    outputPath,
    contents,
    components: Derive.listComponents(manifest),
    changed: previous !== contents
  }
}

function write() {
  const result = generate()
  fs.mkdirSync(path.dirname(result.outputPath), { recursive: true })
  fs.writeFileSync(result.outputPath, result.contents, 'utf8')
  return result
}

if (require.main === module) {
  const check = process.argv.includes('--check')
  try {
    const result = check ? generate() : write()
    if (check && result.changed) {
      console.error('[designBridge] 生成的 registry 与组件清单不一致，请执行 npm run generate 后提交')
      process.exitCode = 1
    } else {
      console.log(
        `[designBridge] ${check ? '已校验' : '已生成'} ${result.components.length} 个组件：${result.components.join('、')}`
      )
    }
  } catch (error) {
    console.error(`[designBridge] ${error.message}`)
    process.exitCode = 1
  }
}

module.exports = { generate, write, renderRegistry, manifestPath, outputPath }
