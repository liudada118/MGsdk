#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { validateConfig } = require('../server/designBridge')

function instanceLabel(instance) {
  return `“${instance.name || instance.id || '未命名'}”`
}

/**
 * Schema validity is not enough: a config where one call site could match more
 * than one instance restores the wrong design silently. Surface it before the
 * JSON is copied into the app.
 */
function collectBindingIssues(instances) {
  const bySlot = new Map()
  const byComponent = new Map()
  const issues = []

  for (const instance of instances) {
    const component = instance.component || 'UnknownComponent'
    if (!byComponent.has(component)) byComponent.set(component, [])
    byComponent.get(component).push(instance)

    if (typeof instance.slot !== 'string' || !instance.slot) continue
    if (!bySlot.has(instance.slot)) bySlot.set(instance.slot, [])
    bySlot.get(instance.slot).push(instance)
  }

  for (const [slot, owners] of bySlot) {
    if (owners.length < 2) continue
    issues.push(
      `槽位“${slot}”被 ${owners.length} 个实例占用（${owners.map(instanceLabel).join('、')}），前端只会命中其中一个`
    )
  }

  for (const [component, group] of byComponent) {
    if (group.length < 2) continue
    const unbound = group.filter((instance) => !instance.slot)
    if (!unbound.length) continue
    issues.push(
      `组件 ${component} 有 ${group.length} 个实例，其中 ${unbound.length} 个未绑定槽位（${unbound
        .map(instanceLabel)
        .join('、')}），未绑定的实例改动可能不生效`
    )
  }

  return issues
}

function checkExport(filename = path.join('exports', 'current.json')) {
  const resolved = path.resolve(filename)
  let config

  try {
    config = JSON.parse(fs.readFileSync(resolved, 'utf8'))
  } catch (error) {
    throw new Error(`无法读取导出配置 ${resolved}：${error.message}`)
  }

  const validation = validateConfig(config)
  if (!validation.valid) {
    throw new Error(`导出配置校验失败：${validation.errors.join('；')}`)
  }

  const components = [...new Set(config.instances.map((instance) => instance.component).filter(Boolean))]
  const slots = config.instances
    .map((instance) => instance.slot)
    .filter((slot) => typeof slot === 'string' && slot)

  return {
    file: resolved,
    instanceCount: config.instances.length,
    components,
    slots,
    bindingIssues: collectBindingIssues(config.instances)
  }
}

if (require.main === module) {
  try {
    const result = checkExport(process.argv[2])
    console.log(`[designBridge] 配置有效：${result.instanceCount} 个实例`)
    console.log(`[designBridge] 组件：${result.components.join('、') || '无'}`)
    console.log(`[designBridge] 已绑定槽位：${result.slots.join('、') || '无'}`)
    for (const issue of result.bindingIssues) {
      console.warn(`[designBridge] 绑定警告：${issue}`)
    }
    console.log(`[designBridge] 可复制文件：${result.file}`)
  } catch (error) {
    console.error(`[designBridge] ${error.message}`)
    process.exitCode = 1
  }
}

module.exports = { checkExport, collectBindingIssues }

