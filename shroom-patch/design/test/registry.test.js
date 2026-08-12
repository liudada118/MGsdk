import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getDesignComponent,
  registerDesignComponent,
  resolveDesignProps,
  validateDesignProps,
} from '../registry.js'

test('预注册 Drawer、IconAndText 和 Select', () => {
  assert.ok(getDesignComponent('Drawer'))
  assert.ok(getDesignComponent('IconAndText'))
  assert.ok(getDesignComponent('Select'))
})

test('非法设计值回退到代码默认值并发出 warning', () => {
  const warnings = []
  const previousWarn = console.warn
  console.warn = (message) => warnings.push(message)

  try {
    const props = resolveDesignProps(
      'Drawer',
      { title: '设备状态', direction: 'diagonal', show: 'yes', unknown: true },
      { direction: 'left', show: true, close: false },
    )

    assert.deepEqual(props, {
      direction: 'left',
      show: true,
      close: false,
      title: '设备状态',
    })
    assert.equal(warnings.length, 3)
    assert.match(warnings[0], /propsSchema/)
  } finally {
    console.warn = previousWarn
  }
})

test('注册 API 支持自定义校验并可撤销', () => {
  const undo = registerDesignComponent('Badge', {
    defaultProps: { count: 0 },
    propsSchema: { count: (value) => Number.isInteger(value) && value >= 0 },
  })

  assert.deepEqual(validateDesignProps('Badge', { count: 3 }), { count: 3 })
  undo()
  assert.equal(getDesignComponent('Badge'), null)
})
