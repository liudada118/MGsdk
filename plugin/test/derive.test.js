'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const derive = require('../src/derive')

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'design-system', 'components.json'), 'utf8')
)

const tests = []
function test(name, run) {
  tests.push({ name, run })
}

function manifestWith(props, componentOverrides = {}) {
  return {
    schemaVersion: '1.0.0',
    components: {
      Widget: Object.assign({ import: '@/Widget', version: '1.0.0', props }, componentOverrides)
    }
  }
}

function errorsOf(value) {
  return derive.validateManifest(value).errors.join('\n')
}

test('仓库里的组件清单本身是合法的', () => {
  const validation = derive.validateManifest(manifest)
  assert.deepEqual(validation.errors, [])
  assert.equal(validation.valid, true)
})

test('组件按名字排序列出', () => {
  assert.deepEqual(derive.listComponents(manifest), [
    'AsyncState',
    'ChartPanel',
    'DraggablePanel',
    'Drawer',
    'MetricValue',
    'Select',
    'SettingControlRow',
    'ToolbarAction'
  ])
})

test('契约由清单推导：propMap、valueMap、numberProps、jsonProps', () => {
  const contract = derive.deriveContract(manifest, 'Drawer')
  assert.equal(contract.component, 'Drawer')
  assert.equal(contract.import, 'shroom-backend-sdk/UI/shroomui')
  assert.equal(contract.propMap['标题'], 'title')
  assert.equal(contract.propMap['显示外侧开关'], 'asideClose')
  // Drawer 只支持左右展开，没有顶部/底部
  assert.deepEqual(contract.valueMap.direction, { 左侧: 'left', 右侧: 'right' })
  assert.deepEqual(contract.numberProps, ['zindex'])
  assert.deepEqual(contract.jsonProps, [])
  assert.deepEqual(derive.deriveContract(manifest, 'Select').jsonProps, ['options'])
  assert.deepEqual(
    derive.deriveContract(manifest, 'SettingControlRow').numberProps,
    ['min', 'max', 'step', 'precision']
  )
})

test('画布属性跳过可变属性，并按 canvasDefault 生成默认值', () => {
  const properties = derive.deriveCanvasProperties(manifest, 'Drawer')
  assert.deepEqual(properties.map((property) => property.name), [
    '标题',
    '显示',
    '显示外侧开关',
    '层级'
  ])
  assert.deepEqual(properties[0], { prop: 'title', name: '标题', type: 'TEXT', defaultValue: '串口设置' })
  assert.deepEqual(properties[1], { prop: 'show', name: '显示', type: 'BOOLEAN', defaultValue: true })
  // 数字默认值必须转成字符串，MasterGo 的 TEXT 属性不接受数字
  assert.deepEqual(properties[3], { prop: 'zindex', name: '层级', type: 'TEXT', defaultValue: '1000' })
})

test('可变属性单独列出，带上需要手动配置的可变值', () => {
  assert.deepEqual(derive.deriveVariantProps(manifest, 'Drawer'), [
    { prop: 'direction', name: '展开方向', values: ['左侧', '右侧'] }
  ])
  assert.deepEqual(derive.deriveVariantProps(manifest, 'AsyncState'), [
    { prop: 'status', name: '状态', values: ['加载中', '空数据', '错误'] }
  ])
  assert.deepEqual(derive.deriveVariantProps(manifest, 'Select'), [])
})

test('registry 条目由清单推导，enum 转成代码值枚举', () => {
  const entry = derive.deriveRegistryEntry(manifest, 'Drawer')
  assert.equal(entry.defaultProps.title, '')
  assert.equal(entry.defaultProps.zindex, 1000)
  assert.equal(entry.propsSchema.zindex, 'number')
  assert.deepEqual(entry.propsSchema.direction, { type: 'enum', values: ['left', 'right'] })
  assert.deepEqual(derive.deriveRegistryEntry(manifest, 'Select').propsSchema.options, 'array')
  assert.deepEqual(
    derive.deriveRegistryEntry(manifest, 'AsyncState').propsSchema.status,
    { type: 'enum', values: ['loading', 'empty', 'error'] }
  )
})

test('未知组件给出可选组件列表', () => {
  assert.throws(() => derive.deriveContract(manifest, 'Nope'), /Drawer、MetricValue、Select/)
})

test('拒绝非 1.x 清单和空 components', () => {
  assert.match(errorsOf({ schemaVersion: '2.0.0', components: { A: {} } }), /schemaVersion 必须是 1\.x/)
  assert.match(errorsOf({ schemaVersion: '1.0.0', components: {} }), /components 必须是非空对象/)
  assert.equal(derive.validateManifest(null).valid, false)
})

test('拒绝重复 label，避免两个 prop 抢同一个画布属性', () => {
  const errors = errorsOf(manifestWith({
    title: { label: '标题', type: 'string', default: '' },
    heading: { label: '标题', type: 'string', default: '' }
  }))
  assert.match(errors, /label“标题”和 Widget\.title 重复/)
})

test('拒绝非法 prop 名和原型污染键', () => {
  assert.match(errorsOf(manifestWith({ 'my-prop': { label: 'A', type: 'string', default: '' } })), /合法 JS 标识符/)
  assert.match(errorsOf(manifestWith({ constructor: { label: 'A', type: 'string', default: '' } })), /不能是/)
})

test('拒绝缺失或类型不符的 default', () => {
  assert.match(errorsOf(manifestWith({ a: { label: 'A', type: 'string' } })), /缺少 default/)
  assert.match(errorsOf(manifestWith({ a: { label: 'A', type: 'number', default: '1000' } })), /default 与 type number 不匹配/)
  assert.match(errorsOf(manifestWith({ a: { label: 'A', type: 'boolean', default: 1 } })), /default 与 type boolean 不匹配/)
})

test('enum 必须有 values，且 default 必须是其中一个代码值', () => {
  assert.match(errorsOf(manifestWith({ a: { label: 'A', type: 'enum', default: 'x' } })), /必须提供非空 values/)
  assert.match(
    errorsOf(manifestWith({ a: { label: 'A', type: 'enum', values: { 左: 'left' }, default: 'right' } })),
    /default 与 type enum 不匹配/
  )
  assert.equal(
    derive.validateManifest(
      manifestWith({ a: { label: 'A', type: 'enum', values: { 左: 'left' }, default: 'left' } })
    ).valid,
    true
  )
})

test('非 enum 不允许声明 values，enum 不能落在 TEXT 画布属性上', () => {
  assert.match(
    errorsOf(manifestWith({ a: { label: 'A', type: 'string', default: '', values: { 左: 'left' } } })),
    /只有 enum 才能声明 values/
  )
  assert.match(
    errorsOf(manifestWith({
      a: { label: 'A', type: 'enum', values: { 左: 'left' }, default: 'left', canvas: 'TEXT' }
    })),
    /只能配 canvas VARIANT/
  )
})

test('canvasDefault 必须匹配画布属性类型', () => {
  assert.match(
    errorsOf(manifestWith({ a: { label: 'A', type: 'boolean', default: false, canvasDefault: '真' } })),
    /canvasDefault 必须是布尔值/
  )
  assert.match(
    errorsOf(manifestWith({ a: { label: 'A', type: 'string', default: '', canvasDefault: true } })),
    /canvasDefault 必须是字符串或数字/
  )
})

test('assertValid 在清单不合法时抛出并列出全部问题', () => {
  assert.throws(
    () => derive.assertValid(manifestWith({ a: { label: '', type: 'nope' } })),
    /组件清单不合法/
  )
  assert.equal(derive.assertValid(manifest), manifest)
})

let passed = 0
for (const item of tests) {
  try {
    item.run()
    passed += 1
    console.log(`✓ ${item.name}`)
  } catch (error) {
    console.error(`✗ ${item.name}`)
    console.error(error && error.stack ? error.stack : error)
  }
}

const failed = tests.length - passed
console.log(`共 ${tests.length} 项，通过 ${passed}，失败 ${failed}`)
if (failed) process.exitCode = 1
