(function attachShroomDerive(root, factory) {
  var api = factory()
  root.ShroomDerive = api
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createShroomDerive() {
  'use strict'

  var owns = Object.prototype.hasOwnProperty
  var IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/
  var BLOCKED_KEYS = ['__proto__', 'prototype', 'constructor']
  var PROP_TYPES = ['string', 'boolean', 'number', 'enum', 'array', 'object']
  var CANVAS_TYPES = ['TEXT', 'BOOLEAN', 'VARIANT']

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }

  function nonEmptyString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : ''
  }

  function includes(list, value) {
    return list.indexOf(value) !== -1
  }

  /** Canvas property kind is derived from the declared type; `canvas` only narrows it. */
  function defaultCanvasType(type) {
    if (type === 'enum') return 'VARIANT'
    if (type === 'boolean') return 'BOOLEAN'
    return 'TEXT'
  }

  function allowedCanvasTypes(type) {
    if (type === 'enum') return ['VARIANT']
    if (type === 'boolean') return ['BOOLEAN', 'VARIANT']
    return ['TEXT', 'VARIANT']
  }

  function canvasTypeOf(definition) {
    return nonEmptyString(definition.canvas) || defaultCanvasType(definition.type)
  }

  function enumCodes(definition) {
    if (!isObject(definition.values)) return []
    return Object.keys(definition.values).map(function readCode(label) {
      return definition.values[label]
    })
  }

  function matchesType(value, definition) {
    switch (definition.type) {
      case 'string':
        return typeof value === 'string'
      case 'boolean':
        return typeof value === 'boolean'
      case 'number':
        return typeof value === 'number' && Number.isFinite(value)
      case 'enum':
        return includes(enumCodes(definition), value)
      case 'array':
        return Array.isArray(value)
      case 'object':
        return isObject(value)
      default:
        return false
    }
  }

  function validateProp(componentName, propName, definition, errors, seenLabels) {
    var where = componentName + '.' + propName

    if (!IDENTIFIER.test(propName) || includes(BLOCKED_KEYS, propName)) {
      errors.push(where + '：prop 名必须是合法 JS 标识符，且不能是 ' + BLOCKED_KEYS.join('/'))
      return
    }
    if (!isObject(definition)) {
      errors.push(where + '：定义必须是对象')
      return
    }

    var label = nonEmptyString(definition.label)
    if (!label) {
      errors.push(where + '：缺少 label（MasterGo 里显示的属性名）')
    } else if (owns.call(seenLabels, label)) {
      errors.push(where + '：label“' + label + '”和 ' + seenLabels[label] + ' 重复，会让两个 prop 抢同一个画布属性')
    } else {
      seenLabels[label] = where
    }

    if (!includes(PROP_TYPES, definition.type)) {
      errors.push(where + '：type 必须是 ' + PROP_TYPES.join(' / '))
      return
    }

    if (definition.type === 'enum') {
      if (!isObject(definition.values) || !Object.keys(definition.values).length) {
        errors.push(where + '：enum 必须提供非空 values（{ 画布可变值: 代码值 }）')
      } else {
        Object.keys(definition.values).forEach(function checkCode(variantLabel) {
          if (typeof definition.values[variantLabel] !== 'string') {
            errors.push(where + '：values“' + variantLabel + '”的代码值必须是字符串')
          }
        })
      }
    } else if (owns.call(definition, 'values')) {
      errors.push(where + '：只有 enum 才能声明 values')
    }

    if (!owns.call(definition, 'default')) {
      errors.push(where + '：缺少 default（链路断开时的代码默认值）')
    } else if (!matchesType(definition['default'], definition)) {
      errors.push(where + '：default 与 type ' + definition.type + ' 不匹配')
    }

    var canvas = canvasTypeOf(definition)
    if (!includes(CANVAS_TYPES, canvas)) {
      errors.push(where + '：canvas 必须是 ' + CANVAS_TYPES.join(' / '))
    } else if (!includes(allowedCanvasTypes(definition.type), canvas)) {
      errors.push(
        where + '：type ' + definition.type + ' 只能配 canvas '
          + allowedCanvasTypes(definition.type).join(' / ')
      )
    }

    if (owns.call(definition, 'canvasDefault')) {
      if (canvas === 'BOOLEAN' && typeof definition.canvasDefault !== 'boolean') {
        errors.push(where + '：BOOLEAN 画布属性的 canvasDefault 必须是布尔值')
      }
      if (canvas === 'TEXT'
        && typeof definition.canvasDefault !== 'string'
        && typeof definition.canvasDefault !== 'number') {
        errors.push(where + '：TEXT 画布属性的 canvasDefault 必须是字符串或数字')
      }
    }
  }

  function validateManifest(manifest) {
    var errors = []

    if (!isObject(manifest)) {
      return { valid: false, errors: ['组件清单必须是 JSON 对象'] }
    }
    if (!/^1\./.test(String(manifest.schemaVersion))) {
      errors.push('schemaVersion 必须是 1.x')
    }
    if (!isObject(manifest.components) || !Object.keys(manifest.components).length) {
      errors.push('components 必须是非空对象')
      return { valid: false, errors: errors }
    }

    Object.keys(manifest.components).forEach(function checkComponent(componentName) {
      var component = manifest.components[componentName]

      if (!IDENTIFIER.test(componentName)) {
        errors.push(componentName + '：组件名必须是合法 JS 标识符')
      }
      if (!isObject(component)) {
        errors.push(componentName + '：定义必须是对象')
        return
      }
      for (var i = 0; i < ['import', 'version'].length; i += 1) {
        var key = ['import', 'version'][i]
        if (owns.call(component, key) && typeof component[key] !== 'string') {
          errors.push(componentName + '.' + key + ' 必须是字符串')
        }
      }
      if (!isObject(component.props) || !Object.keys(component.props).length) {
        errors.push(componentName + '：props 必须是非空对象')
        return
      }

      var seenLabels = Object.create(null)
      Object.keys(component.props).forEach(function checkProp(propName) {
        validateProp(componentName, propName, component.props[propName], errors, seenLabels)
      })
    })

    return { valid: errors.length === 0, errors: errors }
  }

  function assertValid(manifest) {
    var validation = validateManifest(manifest)
    if (!validation.valid) {
      throw new Error('组件清单不合法：\n  - ' + validation.errors.join('\n  - '))
    }
    return manifest
  }

  function listComponents(manifest) {
    if (!isObject(manifest) || !isObject(manifest.components)) return []
    return Object.keys(manifest.components).sort()
  }

  function readComponent(manifest, componentName) {
    if (!isObject(manifest) || !isObject(manifest.components)) {
      throw new Error('组件清单不可用')
    }
    var component = manifest.components[componentName]
    if (!isObject(component)) {
      throw new Error('组件清单里没有 ' + componentName + '，可选：' + (listComponents(manifest).join('、') || '无'))
    }
    return component
  }

  function eachProp(component, visit) {
    Object.keys(component.props).forEach(function visitProp(propName) {
      visit(propName, component.props[propName])
    })
  }

  /** Builds the `shroom/contract` payload the mapping engine reads back at export time. */
  function deriveContract(manifest, componentName) {
    var component = readComponent(manifest, componentName)
    var contract = {
      component: componentName,
      import: typeof component.import === 'string' ? component.import : '',
      version: typeof component.version === 'string' ? component.version : '',
      propMap: {},
      valueMap: {},
      numberProps: [],
      jsonProps: []
    }

    eachProp(component, function addProp(propName, definition) {
      contract.propMap[nonEmptyString(definition.label)] = propName
      if (definition.type === 'enum') contract.valueMap[propName] = Object.assign({}, definition.values)
      if (definition.type === 'number') contract.numberProps.push(propName)
      if (definition.type === 'array' || definition.type === 'object') contract.jsonProps.push(propName)
    })

    return contract
  }

  /** Canvas properties the plugin can create through addComponentProperty. */
  function deriveCanvasProperties(manifest, componentName) {
    var component = readComponent(manifest, componentName)
    var properties = []

    eachProp(component, function addProperty(propName, definition) {
      var canvas = canvasTypeOf(definition)
      if (canvas === 'VARIANT') return

      var fallback = owns.call(definition, 'canvasDefault')
        ? definition.canvasDefault
        : definition['default']

      properties.push({
        prop: propName,
        name: nonEmptyString(definition.label),
        type: canvas,
        defaultValue: canvas === 'BOOLEAN' ? Boolean(fallback) : String(fallback)
      })
    })

    return properties
  }

  /** Variant-backed props cannot be created by the API; the designer must add them by hand. */
  function deriveVariantProps(manifest, componentName) {
    var component = readComponent(manifest, componentName)
    var variants = []

    eachProp(component, function addVariant(propName, definition) {
      if (canvasTypeOf(definition) !== 'VARIANT') return
      variants.push({
        prop: propName,
        name: nonEmptyString(definition.label),
        values: definition.type === 'enum' ? Object.keys(definition.values) : []
      })
    })

    return variants
  }

  /** Builds the frontend registry entry: code defaults plus the validation schema. */
  function deriveRegistryEntry(manifest, componentName) {
    var component = readComponent(manifest, componentName)
    var entry = {
      import: typeof component.import === 'string' ? component.import : '',
      version: typeof component.version === 'string' ? component.version : '',
      defaultProps: {},
      propsSchema: {}
    }

    eachProp(component, function addSchema(propName, definition) {
      entry.defaultProps[propName] = definition['default']
      entry.propsSchema[propName] = definition.type === 'enum'
        ? { type: 'enum', values: enumCodes(definition) }
        : definition.type
    })

    return entry
  }

  return {
    PROP_TYPES: PROP_TYPES,
    CANVAS_TYPES: CANVAS_TYPES,
    validateManifest: validateManifest,
    assertValid: assertValid,
    listComponents: listComponents,
    deriveContract: deriveContract,
    deriveCanvasProperties: deriveCanvasProperties,
    deriveVariantProps: deriveVariantProps,
    deriveRegistryEntry: deriveRegistryEntry
  }
})
