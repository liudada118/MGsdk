'use strict'

const assert = require('node:assert/strict')
const mapping = require('../src/mapping')

const tests = []
function test(name, run) {
  tests.push({ name, run })
}

test('propMap 将画布名映射为代码 prop', () => {
  const result = mapping.mapProperties([{ name: '标题', value: '设备状态' }], [], { propMap: { 标题: 'title' } })
  assert.deepEqual(result.props, { title: '设备状态' })
})

test('alias 优先于 contract propMap', () => {
  const result = mapping.mapProperties(
    [{ name: '标题', value: 'A' }],
    [{ name: '标题', alias: 'heading' }],
    { propMap: { 标题: 'title' } }
  )
  assert.deepEqual(result.props, { heading: 'A' })
})

test('属性 id 可匹配定义 alias', () => {
  const result = mapping.mapProperties(
    [{ id: 'property:1', name: '旧标题', value: 'A' }],
    [{ id: 'property:1', name: '新标题', alias: 'title' }],
    {}
  )
  assert.deepEqual(result.props, { title: 'A' })
})

test('兼容对象形式的旧 componentPropertyDefinitions', () => {
  const result = mapping.mapProperties(
    [{ name: '显示', value: true }],
    { 显示: { type: 'BOOLEAN', alias: 'show' } },
    {}
  )
  assert.deepEqual(result.props, { show: true })
})

test('未映射属性完整保留在 unmapped', () => {
  const result = mapping.mapProperties([{ name: '未知', value: '原值' }], [], {})
  assert.deepEqual(result.unmapped, { 未知: '原值' })
})

test('valueMap 转换枚举值', () => {
  const result = mapping.mapProperties(
    [{ name: '方向', value: '右侧' }],
    [],
    { propMap: { 方向: 'direction' }, valueMap: { direction: { 右侧: 'right' } } }
  )
  assert.deepEqual(result.props, { direction: 'right' })
})

test('valueMap 没有命中时保留原值', () => {
  const result = mapping.mapProperties(
    [{ name: '方向', value: '居中' }],
    [],
    { propMap: { 方向: 'direction' }, valueMap: { direction: { 右侧: 'right' } } }
  )
  assert.deepEqual(result.props, { direction: '居中' })
})

test('numberProps 将数字文本转为数字', () => {
  const result = mapping.mapProperties(
    [{ name: '层级', value: '1200' }],
    [],
    { propMap: { 层级: 'zindex' }, numberProps: ['zindex'] }
  )
  assert.equal(result.props.zindex, 1200)
})

test('numberProps 正确保留零', () => {
  const result = mapping.mapProperties(
    [{ name: '层级', value: '0' }],
    [],
    { propMap: { 层级: 'zindex' }, numberProps: ['zindex'] }
  )
  assert.equal(result.props.zindex, 0)
})

test('numberProps 遇到非法数字时保留并警告', () => {
  const result = mapping.mapProperties(
    [{ name: '层级', value: '最高' }],
    [],
    { propMap: { 层级: 'zindex' }, numberProps: ['zindex'] }
  )
  assert.equal(result.props.zindex, '最高')
  assert.equal(result.warnings.length, 1)
})

test('jsonProps 解析对象', () => {
  const result = mapping.mapProperties(
    [{ name: '配置', value: '{"size":2}' }],
    [],
    { propMap: { 配置: 'config' }, jsonProps: ['config'] }
  )
  assert.deepEqual(result.props.config, { size: 2 })
})

test('jsonProps 解析数组', () => {
  const result = mapping.mapProperties(
    [{ name: '选项', value: '["A","B"]' }],
    [],
    { propMap: { 选项: 'options' }, jsonProps: ['options'] }
  )
  assert.deepEqual(result.props.options, ['A', 'B'])
})

test('jsonProps 遇到非法 JSON 时保留并警告', () => {
  const result = mapping.mapProperties(
    [{ name: '选项', value: '[A]' }],
    [],
    { propMap: { 选项: 'options' }, jsonProps: ['options'] }
  )
  assert.equal(result.props.options, '[A]')
  assert.equal(result.warnings.length, 1)
})

test('布尔值不被字符串化', () => {
  const result = mapping.mapProperties([{ name: '显示', value: false }], [], { propMap: { 显示: 'show' } })
  assert.equal(result.props.show, false)
})

test('兼容对象形式的实例 componentProperties', () => {
  const result = mapping.mapProperties({ 标题: { type: 'TEXT', value: 'A' } }, [], { propMap: { 标题: 'title' } })
  assert.deepEqual(result.props, { title: 'A' })
})

test('parseContract 安全解析 JSON 且拒绝数组', () => {
  assert.deepEqual(mapping.parseContract('{"component":"Drawer"}'), { component: 'Drawer' })
  assert.equal(mapping.parseContract('[1,2]'), null)
  assert.equal(mapping.parseContract('{bad'), null)
})

test('空输入返回稳定的空映射结果', () => {
  assert.deepEqual(mapping.mapProperties(null, null, null), { props: {}, unmapped: {}, warnings: [] })
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
