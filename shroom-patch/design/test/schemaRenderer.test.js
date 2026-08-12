import test from 'node:test'
import assert from 'node:assert/strict'

import {
  listDesignInstances,
  resetDesignBindingWarnings,
  selectDesignInstance,
  selectDesignProps,
} from '../SchemaRenderer.js'

const config = {
  schemaVersion: '1.0.0',
  exportedAt: '2026-08-10T08:00:00.000Z',
  instances: [
    { id: 'drawer-b', name: 'B', component: 'Drawer', slot: 'detail', props: { title: 'B' } },
    { id: 'select-a', name: 'A', component: 'Select', props: { disabled: true } },
    { id: 'drawer-a', name: 'A', component: 'Drawer', slot: 'equip', props: { title: 'A' } },
  ],
}

/** Captures the deduplicated binding warnings produced by one selection. */
function withWarnings(run) {
  resetDesignBindingWarnings()
  const messages = []
  const original = console.warn
  console.warn = (message) => messages.push(String(message))
  try {
    const result = run()
    return { result, messages }
  } finally {
    console.warn = original
    resetDesignBindingWarnings()
  }
}

test('同组件多个实例按 id 稳定选择，不依赖数组顺序', () => {
  const { result } = withWarnings(() => [
    selectDesignInstance(config, 'Drawer').id,
    selectDesignInstance({ ...config, instances: [...config.instances].reverse() }, 'Drawer').id,
  ])
  assert.deepEqual(result, ['drawer-a', 'drawer-a'])
})

test('未指定 slot 且存在多个实例时告警，不再静默绑定', () => {
  const { messages } = withWarnings(() => selectDesignInstance(config, 'Drawer'))
  assert.equal(messages.length, 1)
  assert.match(messages[0], /2 个 Drawer 实例/)
  assert.match(messages[0], /slot/)
})

test('只有一个实例时不告警', () => {
  const { result, messages } = withWarnings(() => selectDesignInstance(config, 'Select'))
  assert.equal(result.id, 'select-a')
  assert.deepEqual(messages, [])
})

test('同一告警只输出一次，避免每次渲染刷屏', () => {
  const { messages } = withWarnings(() => {
    selectDesignInstance(config, 'Drawer')
    selectDesignInstance(config, 'Drawer')
    selectDesignInstance(config, 'Drawer')
  })
  assert.equal(messages.length, 1)
})

test('slot 精确命中实例，且改图层名不影响绑定', () => {
  const renamed = {
    ...config,
    instances: config.instances.map((instance) =>
      instance.id === 'drawer-b' ? { ...instance, name: '重命名后的抽屉' } : instance,
    ),
  }

  const { result, messages } = withWarnings(() => [
    selectDesignInstance(config, 'Drawer', { slot: 'detail' }).id,
    selectDesignInstance(renamed, 'Drawer', { slot: 'detail' }).id,
  ])
  assert.deepEqual(result, ['drawer-b', 'drawer-b'])
  assert.deepEqual(messages, [])
})

test('slot 无人认领时回退到代码默认值并告警', () => {
  const { result, messages } = withWarnings(() =>
    selectDesignProps(config, 'Drawer', { title: '本地标题' }, { slot: '不存在的槽位' }),
  )
  assert.deepEqual(result, { title: '本地标题' })
  assert.equal(messages.length, 1)
  assert.match(messages[0], /不存在的槽位/)
})

test('复制实例导致槽位冲突时告警并稳定取第一个', () => {
  const duplicated = {
    ...config,
    instances: [
      ...config.instances,
      { id: 'drawer-c', name: 'C', component: 'Drawer', slot: 'equip', props: { title: 'C' } },
    ],
  }

  const { result, messages } = withWarnings(() =>
    selectDesignInstance(duplicated, 'Drawer', { slot: 'equip' }),
  )
  assert.equal(result.id, 'drawer-a')
  assert.equal(messages.length, 1)
  assert.match(messages[0], /被 2 个 Drawer 实例占用/)
})

test('instanceId 优先于 slot，且列出实例保持稳定顺序', () => {
  const { result } = withWarnings(() =>
    selectDesignInstance(config, 'Drawer', { slot: 'equip', instanceId: 'drawer-b' }),
  )
  assert.equal(result.id, 'drawer-b')
  assert.deepEqual(
    listDesignInstances(config, 'Drawer').map((instance) => instance.id),
    ['drawer-a', 'drawer-b'],
  )
})

test('支持 instanceId 精确选择并合并代码默认值', () => {
  assert.deepEqual(selectDesignProps(config, 'Drawer', { direction: 'right' }, 'drawer-b'), {
    direction: 'right',
    title: 'B',
  })
})

test('找不到实例时完整保留代码默认值', () => {
  assert.deepEqual(selectDesignProps(config, 'IconAndText', { text: '本地文字' }), {
    text: '本地文字',
  })
})
