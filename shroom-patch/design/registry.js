import { generatedComponents } from './generated/components.js'

const registry = new Map()
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const blockedKeys = new Set(['__proto__', 'prototype', 'constructor'])

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function warn(message) {
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(`[designBridge] ${message}`)
  }
}

function isValidBySchema(value, schema) {
  if (typeof schema === 'function') return Boolean(schema(value))
  if (Array.isArray(schema)) return schema.includes(value)
  if (typeof schema === 'string') {
    if (schema === 'array') return Array.isArray(value)
    if (schema === 'object') return isPlainObject(value)
    if (schema === 'number') return typeof value === 'number' && Number.isFinite(value)
    return typeof value === schema
  }
  if (!isPlainObject(schema)) return true

  if (typeof schema.validate === 'function' && !schema.validate(value)) return false

  switch (schema.type) {
    case 'enum':
      return Array.isArray(schema.values) && schema.values.includes(value)
    case 'array':
      return (
        Array.isArray(value) &&
        (!schema.items || value.every((item) => isValidBySchema(item, schema.items)))
      )
    case 'object':
      return isPlainObject(value)
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return Number.isInteger(value)
    case undefined:
      return true
    default:
      return typeof value === schema.type
  }
}

function normalizeDefinition(name, definition) {
  if (!isPlainObject(definition)) {
    throw new TypeError(`组件 ${name} 的注册信息必须是对象`)
  }

  const defaultProps = isPlainObject(definition.defaultProps) ? { ...definition.defaultProps } : {}
  const propsSchema = isPlainObject(definition.propsSchema) ? { ...definition.propsSchema } : {}

  for (const key of blockedKeys) {
    delete defaultProps[key]
    delete propsSchema[key]
  }

  return Object.freeze({
    ...definition,
    name,
    component: name,
    defaultProps: Object.freeze(defaultProps),
    propsSchema: Object.freeze(propsSchema),
    allowUnknownProps: definition.allowUnknownProps === true,
  })
}

/** Registers or replaces one design-consumable component. Returns an undo API. */
export function registerDesignComponent(name, definition) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new TypeError('组件名必须是非空字符串')
  }

  const normalizedName = name.trim()
  const previous = registry.get(normalizedName)
  const normalized = normalizeDefinition(normalizedName, definition)
  registry.set(normalizedName, normalized)

  return () => {
    if (registry.get(normalizedName) !== normalized) return
    if (previous) registry.set(normalizedName, previous)
    else registry.delete(normalizedName)
  }
}

export function unregisterDesignComponent(name) {
  return registry.delete(name)
}

export function getDesignComponent(name) {
  return registry.get(name) || null
}

export function listDesignComponents() {
  return Array.from(registry.values())
}

/**
 * Validates only props arriving over the design bridge. Unknown props are
 * ignored unless the component explicitly opts in with allowUnknownProps.
 */
export function validateDesignProps(componentName, props, fallbackProps = {}) {
  const definition = getDesignComponent(componentName)
  if (!definition) {
    warn(`未注册组件 ${componentName}，已忽略设计侧 props`)
    return {}
  }

  if (!isPlainObject(props)) {
    warn(`${componentName}.props 必须是对象，已回退到代码默认值`)
    return {}
  }

  const fallbacks = isPlainObject(fallbackProps) ? fallbackProps : {}
  const output = {}

  for (const [key, value] of Object.entries(props)) {
    if (blockedKeys.has(key)) {
      warn(`${componentName}.${key} 是不允许的属性，已忽略`)
      continue
    }

    const schema = definition.propsSchema[key]
    if (!schema) {
      if (definition.allowUnknownProps) output[key] = value
      else warn(`${componentName}.${key} 未在 propsSchema 注册，已忽略`)
      continue
    }

    if (isValidBySchema(value, schema)) {
      output[key] = value
      continue
    }

    let fallbackFound = false
    let fallback
    if (hasOwn(fallbacks, key) && isValidBySchema(fallbacks[key], schema)) {
      fallback = fallbacks[key]
      fallbackFound = true
    } else if (
      hasOwn(definition.defaultProps, key) &&
      isValidBySchema(definition.defaultProps[key], schema)
    ) {
      fallback = definition.defaultProps[key]
      fallbackFound = true
    }

    if (fallbackFound) output[key] = fallback
    warn(
      `${componentName}.${key} 的值未通过 propsSchema 校验，` +
        (fallbackFound ? '已回退到默认值' : '已忽略'),
    )
  }

  return output
}

export function resolveDesignProps(componentName, designProps, codeDefaults = {}) {
  const defaults = isPlainObject(codeDefaults) ? { ...codeDefaults } : {}
  if (designProps === null || designProps === undefined) return defaults
  return {
    ...defaults,
    ...validateDesignProps(componentName, designProps, defaults),
  }
}

export const registerComponent = registerDesignComponent
export const unregisterComponent = unregisterDesignComponent
export const componentRegistry = registry

// Registrations come from design-system/components.json via `npm run generate`.
// Add a component there instead of here; hand-written registrations would drift
// from the MasterGo properties and the contract the plugin writes.
for (const [name, definition] of Object.entries(generatedComponents)) {
  registerDesignComponent(name, definition)
}

export default componentRegistry
