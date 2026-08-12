import React from 'react'
import { useDesignStore } from './designStore.js'
import { resolveDesignProps } from './registry.js'

const reportedBindings = new Set()

function warnOnce(key, message) {
  if (reportedBindings.has(key)) return
  reportedBindings.add(key)
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(`[designBridge] ${message}`)
  }
}

/** Test helper: forgets which binding warnings were already printed. */
export function resetDesignBindingWarnings() {
  reportedBindings.clear()
}

function normalizeOptions(options) {
  if (typeof options === 'string') return { instanceId: options }
  return options && typeof options === 'object' ? options : {}
}

function normalizeSlot(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function stableInstanceKey(instance) {
  return [instance?.id || '', instance?.name || '', instance?.component || ''].join('\u0000')
}

function sortStable(instances) {
  return [...instances].sort((left, right) =>
    stableInstanceKey(left).localeCompare(stableInstanceKey(right), 'en'),
  )
}

function describe(instances) {
  return instances.map((instance) => `“${instance.name || instance.id || '未命名'}”`).join('、')
}

/** Lists every instance of one component, in the same stable order used for selection. */
export function listDesignInstances(config, componentName) {
  if (!config || !Array.isArray(config.instances) || typeof componentName !== 'string') return []
  return sortStable(
    config.instances.filter((instance) => instance && instance.component === componentName),
  )
}

/**
 * Resolves one call site to one canvas instance.
 *
 * `slot` is the only binding that survives layer renames and reordering, so it
 * is the supported way to consume a component that appears more than once.
 * "First by id" stays as the fallback for single-instance components, but it
 * now warns instead of silently binding to an arbitrary instance.
 */
export function selectDesignInstance(config, componentName, options = {}) {
  if (!config || !Array.isArray(config.instances) || typeof componentName !== 'string') {
    return null
  }

  const normalizedOptions = normalizeOptions(options)
  const requestedId = normalizedOptions.instanceId ?? normalizedOptions.id
  const requestedSlot = normalizeSlot(normalizedOptions.slot)
  const matches = config.instances.filter(
    (instance) => instance && instance.component === componentName,
  )

  if (requestedId !== undefined && requestedId !== null) {
    return matches.find((instance) => String(instance.id) === String(requestedId)) || null
  }

  if (requestedSlot !== null) {
    const slotMatches = matches.filter((instance) => instance.slot === requestedSlot)

    if (slotMatches.length === 0) {
      warnOnce(
        `missing:${componentName}:${requestedSlot}`,
        `设计配置里没有绑定到槽位“${requestedSlot}”的 ${componentName} 实例，已保留代码默认值。` +
          '请在 MasterGo 插件面板选中该实例并绑定这个槽位。',
      )
      return null
    }

    if (slotMatches.length > 1) {
      warnOnce(
        `conflict:${componentName}:${requestedSlot}`,
        `槽位“${requestedSlot}”被 ${slotMatches.length} 个 ${componentName} 实例占用` +
          `（${describe(sortStable(slotMatches))}），已按 id 取第一个。` +
          '复制实例会把槽位一起复制，请在画布上重新绑定。',
      )
    }

    return sortStable(slotMatches)[0]
  }

  if (matches.length === 0) return null
  if (matches.length === 1) return matches[0]

  const sorted = sortStable(matches)
  warnOnce(
    `ambiguous:${componentName}`,
    `设计配置里有 ${matches.length} 个 ${componentName} 实例（${describe(sorted)}），` +
      '而调用点没有指定 slot，只能按 id 绑定到第一个。设计师改动其他实例不会生效——' +
      `请给每个实例绑定槽位，并改用 useDesignProps('${componentName}', defaults, { slot: '...' })。`,
  )
  return sorted[0]
}

export function selectDesignProps(config, componentName, codeDefaults = {}, options = {}) {
  const instance = selectDesignInstance(config, componentName, options)
  if (!instance) return { ...(codeDefaults && typeof codeDefaults === 'object' ? codeDefaults : {}) }
  return resolveDesignProps(componentName, instance.props, codeDefaults)
}

/**
 * Reads a registered component from the live design configuration and merges
 * validated design values over code-side defaults.
 */
export function useDesignProps(componentName, codeDefaults = {}, options = {}) {
  const config = useDesignStore((state) => state.config)
  const normalizedOptions = normalizeOptions(options)
  const instanceId = normalizedOptions.instanceId ?? normalizedOptions.id
  const slot = normalizedOptions.slot

  return React.useMemo(
    () => selectDesignProps(config, componentName, codeDefaults, { instanceId, slot }),
    [config, componentName, codeDefaults, instanceId, slot],
  )
}

/**
 * Optional render-prop wrapper for teams that prefer declarative consumption.
 * It also accepts `as={Component}` or a single React element child.
 */
export function SchemaRenderer({
  component,
  defaults = {},
  instanceId,
  slot,
  options,
  render,
  as: RenderComponent,
  children,
}) {
  const designProps = useDesignProps(component, defaults, {
    ...normalizeOptions(options),
    ...(slot !== undefined ? { slot } : {}),
    ...(instanceId !== undefined ? { instanceId } : {}),
  })

  if (typeof render === 'function') return render(designProps)
  if (typeof children === 'function') return children(designProps)
  if (RenderComponent) return React.createElement(RenderComponent, designProps, children)
  if (React.isValidElement(children)) return React.cloneElement(children, designProps)
  return null
}

export default SchemaRenderer
