import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getDesignComponent,
  listDesignComponents,
  registerDesignComponent,
  resolveDesignProps,
  validateDesignProps,
} from '../registry.js'
import { generatedComponents } from '../generated/components.js'

test('组件清单里的每个组件都已预注册', () => {
  const names = Object.keys(generatedComponents)
  assert.ok(names.length >= 3, '生成的注册表不应为空')
  for (const name of names) {
    assert.ok(getDesignComponent(name), `${name} 应已注册`)
  }
  assert.deepEqual(
    listDesignComponents().map((definition) => definition.name).sort(),
    [...names].sort(),
  )
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
