(function attachShroomMapping(root, factory) {
  var api = factory()
  root.ShroomMapping = api
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createShroomMapping() {
  'use strict'

  var owns = Object.prototype.hasOwnProperty

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }

  function nonEmptyString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : ''
  }

  function parseContract(value) {
    if (isObject(value)) return value
    if (typeof value !== 'string' || !value.trim()) return null

    try {
      var parsed = JSON.parse(value)
      return isObject(parsed) ? parsed : null
    } catch (_error) {
      return null
    }
  }

  function normalizeEntries(input, includePrimitiveValues) {
    if (Array.isArray(input)) {
      return input
        .filter(function keepEntry(entry) {
          return isObject(entry)
        })
        .map(function copyEntry(entry) {
          return Object.assign({}, entry)
        })
    }

    if (!isObject(input)) return []

    return Object.keys(input).map(function normalizeObjectEntry(key) {
      var entry = input[key]
      if (isObject(entry)) {
        var copied = Object.assign({}, entry)
        if (!nonEmptyString(copied.name)) copied.name = key
        if (!nonEmptyString(copied.id) && key !== copied.name) copied.id = key
        return copied
      }

      return includePrimitiveValues
        ? { name: key, value: entry }
        : { name: key }
    })
  }

  function normalizeProperties(input) {
    return normalizeEntries(input, true).map(function normalizeProperty(property) {
      var normalized = Object.assign({}, property)
      normalized.name = nonEmptyString(property.name) || nonEmptyString(property.id)
      normalized.id = nonEmptyString(property.id)
      return normalized
    })
  }

  function normalizeDefinitions(input) {
    return normalizeEntries(input, false).map(function normalizeDefinition(definition) {
      var normalized = Object.assign({}, definition)
      normalized.name = nonEmptyString(definition.name)
      normalized.id = nonEmptyString(definition.id)
      normalized.alias = nonEmptyString(definition.alias)
      return normalized
    })
  }

  function createAliasLookup(definitions) {
    var byId = Object.create(null)
    var byName = Object.create(null)

    normalizeDefinitions(definitions).forEach(function indexDefinition(definition) {
      if (!definition.alias) return
      if (definition.id && !owns.call(byId, definition.id)) byId[definition.id] = definition.alias
      if (definition.name && !owns.call(byName, definition.name)) byName[definition.name] = definition.alias
    })

    return { byId: byId, byName: byName }
  }

  function asNameSet(value) {
    var result = Object.create(null)
    if (!Array.isArray(value)) return result
    value.forEach(function addName(name) {
      var normalized = nonEmptyString(name)
      if (normalized) result[normalized] = true
    })
    return result
  }

  function convertValue(rawValue, propName, contract, warnings) {
    var value = rawValue
    var valueMap = isObject(contract.valueMap) ? contract.valueMap : {}
    var enumMap = isObject(valueMap[propName]) ? valueMap[propName] : null

    if (enumMap && owns.call(enumMap, String(value))) {
      value = enumMap[String(value)]
    }

    var numberProps = asNameSet(contract.numberProps)
    if (numberProps[propName]) {
      if (typeof value === 'number' && Number.isFinite(value)) return value
      if (typeof value === 'string' && value.trim()) {
        var numeric = Number(value)
        if (Number.isFinite(numeric)) return numeric
      }
      warnings.push('属性“' + propName + '”无法转换为有限数字，已保留原值')
      return value
    }

    var jsonProps = asNameSet(contract.jsonProps)
    if (jsonProps[propName]) {
      if (typeof value !== 'string') return value
      try {
        return JSON.parse(value)
      } catch (_error) {
        warnings.push('属性“' + propName + '”不是有效 JSON，已保留原值')
        return value
      }
    }

    return value
  }

  function mapProperties(properties, definitions, contractValue) {
    var contract = parseContract(contractValue) || {}
    var propMap = isObject(contract.propMap) ? contract.propMap : {}
    var aliases = createAliasLookup(definitions)
    var props = {}
    var unmapped = {}
    var warnings = []

    normalizeProperties(properties).forEach(function mapProperty(property) {
      var sourceName = nonEmptyString(property.name) || nonEmptyString(property.id) || '未命名属性'
      var alias = property.id && aliases.byId[property.id]
        ? aliases.byId[property.id]
        : aliases.byName[sourceName]
      var targetName = nonEmptyString(alias) || nonEmptyString(propMap[sourceName])

      if (!targetName) {
        unmapped[sourceName] = property.value
        return
      }

      if (owns.call(props, targetName)) {
        warnings.push('多个画布属性映射到“' + targetName + '”，后出现的值已覆盖前值')
      }
      props[targetName] = convertValue(property.value, targetName, contract, warnings)
    })

    return { props: props, unmapped: unmapped, warnings: warnings }
  }

  return {
    parseContract: parseContract,
    normalizeProperties: normalizeProperties,
    normalizeDefinitions: normalizeDefinitions,
    createAliasLookup: createAliasLookup,
    mapProperties: mapProperties
  }
})
