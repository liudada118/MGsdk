'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const { checkExport, collectBindingIssues } = require('./check-export')

const exampleConfig = path.join(__dirname, '..', 'docs', 'current.example.json')

test('示例导出通过校验并报告已绑定的槽位', () => {
  const result = checkExport(exampleConfig)
  assert.equal(result.instanceCount, 1)
  assert.deepEqual(result.components, ['Drawer'])
  assert.deepEqual(result.slots, ['equipPanel.drawer'])
  assert.deepEqual(result.bindingIssues, [])
})

test('同一槽位被多个实例占用时报告冲突', () => {
  const issues = collectBindingIssues([
    { id: 'a', name: 'A', component: 'Drawer', slot: 'equip' },
    { id: 'b', name: 'B', component: 'Drawer', slot: 'equip' }
  ])
  assert.equal(issues.length, 1)
  assert.match(issues[0], /槽位“equip”被 2 个实例占用/)
})

test('多个实例但存在未绑定槽位时报告绑定不明确', () => {
  const issues = collectBindingIssues([
    { id: 'a', name: 'A', component: 'Drawer', slot: 'equip' },
    { id: 'b', name: 'B', component: 'Drawer' }
  ])
  assert.equal(issues.length, 1)
  assert.match(issues[0], /1 个未绑定槽位/)
})

test('单实例组件不需要绑定槽位', () => {
  const issues = collectBindingIssues([
    { id: 'a', name: 'A', component: 'Drawer' },
    { id: 'b', name: 'B', component: 'Select' }
  ])
  assert.deepEqual(issues, [])
})
