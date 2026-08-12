(function runShroomPlugin() {
  'use strict'

  var Mapping = globalThis.ShroomMapping
  var Derive = globalThis.ShroomDerive
  var Manifest = globalThis.ShroomManifest
  var autoPush = false
  var exporting = false
  var quietUntil = 0
  var AUTO_PUSH_DELAY = 300
  var AUTO_PUSH_COOLDOWN = 600
  var selectionTimer = null
  var CONTRACT_NAMESPACE = 'shroom'
  var CONTRACT_KEY = 'contract'
  var SLOT_KEY = 'slot'
  // Slots are the stable binding key between one canvas instance and one call
  // site in the code. They must survive layer renames, so they live in
  // sharedPluginData; the `#slot` name suffix is a fallback for designers who
  // do not want to open the plugin panel.
  var SLOT_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/
  var SLOT_NAME_SUFFIX = /#([A-Za-z0-9_.:-]{1,64})\s*$/

  function post(message) {
    try {
      mg.ui.postMessage(message)
    } catch (_error) {
      // The panel may already be closed.
    }
  }

  function log(level, message) {
    post({ type: 'log', level: level || 'info', message: String(message) })
  }

  function safely(getter, fallback) {
    try {
      var value = getter()
      return value === undefined || value === null ? fallback : value
    } catch (_error) {
      return fallback
    }
  }

  function currentPage() {
    return safely(function readCurrentPage() {
      return mg.document.currentPage
    }, null)
  }

  function selection() {
    var page = currentPage()
    var selected = page && page.selection
    return Array.isArray(selected) ? selected : []
  }

  function isType(node, type) {
    return Boolean(node && String(node.type || '').toUpperCase() === type)
  }

  function nonEmptyString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : ''
  }

  function normalizeSlot(value) {
    var slot = nonEmptyString(value)
    return SLOT_PATTERN.test(slot) ? slot : ''
  }

  /** Reads the stable binding key of one instance: plugin data first, then a `#slot` name suffix. */
  function readSlot(instance, quiet) {
    if (!instance) return ''

    var stored = ''
    if (typeof instance.getSharedPluginData === 'function') {
      stored = nonEmptyString(safely(function getStoredSlot() {
        return instance.getSharedPluginData(CONTRACT_NAMESPACE, SLOT_KEY)
      }, ''))
    }
    if (stored) {
      var normalized = normalizeSlot(stored)
      if (normalized) return normalized
      if (!quiet) {
        log('warn', '实例“' + (instance.name || instance.id) + '”的槽位“' + stored + '”不是合法名称，已忽略')
      }
    }

    var matched = SLOT_NAME_SUFFIX.exec(nonEmptyString(instance.name))
    return matched ? matched[1] : ''
  }

  function componentSources(mainComponent) {
    if (!mainComponent) return []
    var sources = [mainComponent]
    var parent = safely(function getParent() { return mainComponent.parent }, null)
    if (isType(parent, 'COMPONENT_SET')) sources.push(parent)
    return sources
  }

  async function getMainComponent(instance) {
    var component = safely(function readMainComponent() { return instance.mainComponent }, null)
    if (component) return component
    if (typeof instance.getMainComponentAsync === 'function') {
      try {
        return await instance.getMainComponentAsync()
      } catch (_error) {
        return null
      }
    }
    return null
  }

  function readContract(sources) {
    for (var i = 0; i < sources.length; i += 1) {
      var source = sources[i]
      if (!source || typeof source.getSharedPluginData !== 'function') continue
      var raw = safely(function getContract() {
        return source.getSharedPluginData(CONTRACT_NAMESPACE, CONTRACT_KEY)
      }, '')
      if (!raw) continue
      var parsed = Mapping.parseContract(raw)
      if (parsed) return parsed
      log('warn', '组件“' + (source.name || source.id || '未命名') + '”的 shroom/contract 不是有效 JSON，已忽略')
    }
    return {}
  }

  function readDefinitions(sources) {
    var definitions = []
    sources.forEach(function collectSourceDefinitions(source) {
      // Newer MasterGo versions expose componentPropertyValues. Keep the old
      // componentPropertyDefinitions path for files/plugins created earlier.
      definitions = definitions.concat(Mapping.normalizeDefinitions(
        safely(function getValues() { return source.componentPropertyValues }, null)
      ))
      definitions = definitions.concat(Mapping.normalizeDefinitions(
        safely(function getDefinitions() { return source.componentPropertyDefinitions }, null)
      ))
    })
    return definitions
  }

  function componentName(instance, mainComponent, contract) {
    if (typeof contract.component === 'string' && contract.component.trim()) {
      return contract.component.trim()
    }

    // Variant members are named "方向=左侧"; the component name lives on the set.
    var parent = mainComponent
      ? safely(function getParent() { return mainComponent.parent }, null)
      : null
    if (isType(parent, 'COMPONENT_SET') && nonEmptyString(parent.name)) {
      return nonEmptyString(parent.name).split('/')[0]
    }

    var component = mainComponent && typeof mainComponent.name === 'string'
      ? mainComponent.name.trim()
      : ''
    if (component && component.indexOf('=') === -1) return component.split('/')[0]
    var instanceName = typeof instance.name === 'string' ? instance.name.trim() : ''
    return instanceName ? instanceName.split('/')[0] : 'UnknownComponent'
  }

  function knowsComponent(name) {
    if (!Derive || !Manifest) return false
    return Derive.listComponents(Manifest).indexOf(nonEmptyString(name)) !== -1
  }

  /**
   * The contract is derived from the code-side manifest, so it works for team
   * library components the plugin cannot write to. A contract stored on the
   * canvas still wins, which keeps hand-tuned components and older files working.
   */
  function resolveContract(instance, mainComponent, sources) {
    var canvasContract = readContract(sources)
    var name = componentName(instance, mainComponent, canvasContract)
    if (Object.keys(canvasContract).length) return canvasContract

    if (!Derive || !Manifest) return {}
    try {
      return Derive.deriveContract(Manifest, name)
    } catch (_error) {
      // Not in the manifest — mapping falls back to alias, and unmapped
      // properties are reported so the name mismatch is visible.
      return {}
    }
  }

  async function exportInstance(instance) {
    var mainComponent = await getMainComponent(instance)
    var sources = componentSources(mainComponent)
    var contract = resolveContract(instance, mainComponent, sources)
    var definitions = readDefinitions(sources)
    var rawProperties = safely(function readProperties() { return instance.componentProperties }, [])
    var mapped = Mapping.mapProperties(rawProperties, definitions, contract)
    var record = {
      id: String(instance.id || ''),
      name: String(instance.name || ''),
      component: componentName(instance, mainComponent, contract),
      import: typeof contract.import === 'string' ? contract.import : '',
      version: typeof contract.version === 'string' ? contract.version : '',
      props: mapped.props
    }

    var slot = readSlot(instance)
    if (slot) record.slot = slot

    var unmappedNames = Object.keys(mapped.unmapped)
    if (unmappedNames.length) {
      record.unmapped = mapped.unmapped
      log('warn', '实例“' + (record.name || record.id) + '”有 ' + unmappedNames.length
        + ' 个属性未映射：' + unmappedNames.join('、'))
      if (!knowsComponent(record.component)) {
        log('warn', '组件 ' + record.component
          + ' 不在组件清单里。选中这个实例点「生成清单片段」，把输出粘进 design-system/components.json 即可')
      }
    }
    mapped.warnings.forEach(function reportMappingWarning(message) {
      log('warn', '实例“' + (record.name || record.id) + '”：' + message)
    })
    return record
  }

  function recordLabel(record) {
    return '“' + (record.name || record.id || '未命名') + '”'
  }

  /** Slots already used anywhere on the page, so auto-assigned ones stay unique across exports. */
  function slotsInUse() {
    var taken = Object.create(null)
    var page = currentPage()
    if (!page || typeof page.findAll !== 'function') return taken

    var nodes = safely(function findInstances() {
      return page.findAll(function isInstanceNode(node) { return isType(node, 'INSTANCE') })
    }, [])
    if (!Array.isArray(nodes)) return taken

    nodes.forEach(function addSlot(node) {
      var slot = readSlot(node, true)
      if (slot) taken[slot] = true
    })
    return taken
  }

  function slotPrefix(component) {
    var name = nonEmptyString(component) || 'component'
    return name.charAt(0).toLowerCase() + name.slice(1)
  }

  /**
   * Every exported instance needs a stable binding key, and making the designer
   * type one for each is the step people skip. Assign the missing ones and write
   * them back to the canvas so the next export keeps the same binding.
   */
  async function assignMissingSlots(instances, records) {
    var taken = slotsInUse()
    records.forEach(function markTaken(record) {
      if (record.slot) taken[record.slot] = true
    })

    for (var i = 0; i < records.length; i += 1) {
      var record = records[i]
      var instance = instances[i]
      if (record.slot || !instance || typeof instance.setSharedPluginData !== 'function') continue

      var prefix = slotPrefix(record.component)
      var index = 1
      while (taken[prefix + '.' + index]) index += 1
      var slot = prefix + '.' + index

      try {
        await Promise.resolve(instance.setSharedPluginData(CONTRACT_NAMESPACE, SLOT_KEY, slot))
      } catch (_error) {
        log('warn', '实例' + recordLabel(record) + '无法写入槽位，导出的配置里它仍未绑定')
        continue
      }

      taken[slot] = true
      record.slot = slot
      log('info', '实例' + recordLabel(record) + '未绑定槽位，已自动分配“' + slot + '”')
    }
  }

  /**
   * A design config is only reproducible when every call site resolves to
   * exactly one instance. Ambiguity used to fail silently on the frontend, so
   * report it at export time while the designer still has the canvas open.
   */
  function reportBindingIssues(records) {
    var bySlot = Object.create(null)
    var byComponent = Object.create(null)
    var issues = []

    records.forEach(function indexRecord(record) {
      var component = record.component || 'UnknownComponent'
      if (!byComponent[component]) byComponent[component] = []
      byComponent[component].push(record)
      if (!record.slot) return
      if (!bySlot[record.slot]) bySlot[record.slot] = []
      bySlot[record.slot].push(record)
    })

    Object.keys(bySlot).forEach(function checkSlotConflict(slot) {
      var owners = bySlot[slot]
      if (owners.length < 2) return
      issues.push({
        level: 'error',
        message: '槽位“' + slot + '”被 ' + owners.length + ' 个实例占用（'
          + owners.map(recordLabel).join('、')
          + '），前端只会命中其中一个。复制实例会把槽位一起复制，请重新绑定。'
      })
    })

    Object.keys(byComponent).forEach(function checkComponentAmbiguity(component) {
      var group = byComponent[component]
      if (group.length < 2) return
      var unbound = group.filter(function withoutSlot(record) { return !record.slot })
      if (!unbound.length) return
      issues.push({
        level: 'warn',
        message: '组件 ' + component + ' 导出了 ' + group.length + ' 个实例，其中 ' + unbound.length
          + ' 个未绑定槽位（' + unbound.map(recordLabel).join('、')
          + '）。未绑定时前端只能按 id 取一个，改动其他实例不会生效——请逐个绑定槽位，并用 useDesignProps(component, defaults, { slot }) 消费。'
      })
    })

    issues.forEach(function reportIssue(issue) {
      log(issue.level, issue.message)
    })
    return issues
  }

  function sourceMetadata() {
    var page = currentPage()
    var documentNode = safely(function getDocument() { return mg.document }, null)
    var fileId = safely(function getDocumentId() { return mg.documentId }, '')
    if (!fileId && documentNode) fileId = safely(function getRootId() { return documentNode.id }, '')
    var fileName = safely(function getDocumentName() { return documentNode.name }, '')
      || safely(function getFileName() { return mg.fileName }, '')
      || 'MasterGo 文件'

    return {
      file: { id: String(fileId || ''), name: String(fileName) },
      page: {
        id: page ? String(page.id || '') : '',
        name: page ? String(page.name || '未命名页面') : '未命名页面'
      }
    }
  }

  async function exportSelection(reason) {
    var instances = selection().filter(function keepInstances(node) {
      return isType(node, 'INSTANCE')
    })
    if (!instances.length) {
      var message = '请先选中至少一个组件实例，再导出'
      if (reason === 'layoutchange') return
      log('error', message)
      post({ type: 'export:error', message: message })
      return
    }

    exporting = true
    try {
      var records = await Promise.all(instances.map(exportInstance))
      await assignMissingSlots(instances, records)
      reportBindingIssues(records)
      var metadata = sourceMetadata()
      var payload = {
        schemaVersion: '1.0.0',
        file: metadata.file,
        page: metadata.page,
        exportedAt: new Date().toISOString(),
        instances: records
      }
      post({ type: 'export:ready', payload: payload, reason: reason || 'manual' })
      log('success', '已导出 ' + records.length + ' 个组件实例')
    } catch (error) {
      var detail = error && error.message ? error.message : String(error)
      log('error', '导出失败：' + detail)
      post({ type: 'export:error', message: detail })
    } finally {
      exporting = false
      // Writing slots back to the canvas fires layoutchange; ignore our own echo.
      quietUntil = Date.now() + AUTO_PUSH_COOLDOWN
    }
  }

  function publishSelection() {
    var selected = selection()
    var instances = selected.filter(function keepInstances(node) { return isType(node, 'INSTANCE') })
    var single = instances.length === 1 ? instances[0] : null
    post({
      type: 'selection:changed',
      count: selected.length,
      instanceCount: instances.length,
      names: selected.slice(0, 4).map(function nodeName(node) { return String(node.name || node.id || '未命名') }),
      slot: single ? readSlot(single) : '',
      slotEditable: Boolean(single)
    })
  }

  /** Writes (or clears, when slot is empty) the stable binding key of the selected instance. */
  async function bindSlot(rawSlot) {
    try {
      var instances = selection().filter(function keepInstances(node) { return isType(node, 'INSTANCE') })
      if (instances.length !== 1) {
        throw new Error('请只选中一个组件实例，再绑定槽位')
      }

      var target = instances[0]
      if (typeof target.setSharedPluginData !== 'function') {
        throw new Error('当前节点不支持 sharedPluginData')
      }

      var requested = nonEmptyString(rawSlot)
      var slot = normalizeSlot(requested)
      if (requested && !slot) {
        throw new Error('槽位名只能包含字母、数字和 . _ : -，且不超过 64 个字符')
      }

      await Promise.resolve(target.setSharedPluginData(CONTRACT_NAMESPACE, SLOT_KEY, slot))

      var summary = slot
        ? '已把实例“' + (target.name || target.id) + '”绑定到槽位“' + slot + '”'
        : '已解除实例“' + (target.name || target.id) + '”的槽位绑定'
      log('success', summary)
      if (slot) log('info', '前端可用 useDesignProps(component, defaults, { slot: \'' + slot + '\' }) 消费')
      post({ type: 'slot:result', ok: true, slot: slot, message: summary })
      if (typeof mg.notify === 'function') mg.notify(summary)
      publishSelection()
    } catch (error) {
      var detail = error && error.message ? error.message : String(error)
      log('error', '绑定槽位失败：' + detail)
      post({ type: 'slot:result', ok: false, message: detail })
    }
  }

  /**
   * MasterGo has no `documentchange` event, so `layoutchange` is the closest
   * signal that the designer edited something. Debounce it and skip the window
   * right after our own export, which writes slots back to the canvas.
   */
  function scheduleAutoPush(reason) {
    if (!autoPush || exporting) return
    if (Date.now() < quietUntil) return
    if (selectionTimer) {
      clearTimeout(selectionTimer)
      selectionTimer = null
    }
    var hasInstance = selection().some(function containsInstance(node) { return isType(node, 'INSTANCE') })
    if (!hasInstance) return
    selectionTimer = setTimeout(function pushChangedSelection() {
      selectionTimer = null
      exportSelection(reason)
    }, AUTO_PUSH_DELAY)
  }

  function onSelectionChange() {
    publishSelection()
    scheduleAutoPush('selectionchange')
  }

  function onLayoutChange() {
    scheduleAutoPush('layoutchange')
  }

  function scaffoldTarget() {
    var selected = selection()
    if (selected.length !== 1 || (!isType(selected[0], 'COMPONENT') && !isType(selected[0], 'COMPONENT_SET'))) {
      throw new Error('请只选中一个主组件（或组件集）')
    }
    var target = selected[0]
    var parent = safely(function getParent() { return target.parent }, null)
    if (isType(target, 'COMPONENT') && isType(parent, 'COMPONENT_SET')) return parent
    return target
  }

  function existingDefinitionNames(target) {
    var names = Object.create(null)
    var current = Mapping.normalizeDefinitions(
      safely(function getValues() { return target.componentPropertyValues }, null)
    ).concat(Mapping.normalizeDefinitions(
      safely(function getDefinitions() { return target.componentPropertyDefinitions }, null)
    ))
    current.forEach(function addName(definition) {
      if (definition.name) names[definition.name] = true
    })
    return names
  }

  function assertManifestReady(componentName) {
    if (!Derive || !Manifest) {
      throw new Error('组件清单未打包进插件，请重新执行 npm run build')
    }
    if (!componentName) {
      throw new Error('请先选择要配置的组件')
    }
  }

  /** Writes the manifest-derived canvas properties and contract onto one main component. */
  async function applyManifest(target, componentName) {
    var properties = Derive.deriveCanvasProperties(Manifest, componentName)
    var contract = Derive.deriveContract(Manifest, componentName)

    if (typeof target.addComponentProperty !== 'function') {
      throw new Error('当前节点或 MasterGo 版本不支持 addComponentProperty')
    }
    if (typeof target.setSharedPluginData !== 'function') {
      throw new Error('当前节点不支持 sharedPluginData')
    }

    var existing = existingDefinitionNames(target)
    var created = 0
    var skipped = 0
    for (var i = 0; i < properties.length; i += 1) {
      var definition = properties[i]
      if (existing[definition.name]) {
        skipped += 1
        continue
      }
      await Promise.resolve(target.addComponentProperty(
        definition.name,
        definition.type,
        definition.defaultValue
      ))
      existing[definition.name] = true
      created += 1
    }

    await Promise.resolve(target.setSharedPluginData(
      CONTRACT_NAMESPACE,
      CONTRACT_KEY,
      JSON.stringify(contract)
    ))

    return { created: created, skipped: skipped }
  }

  function reportVariants(componentName, handled) {
    Derive.deriveVariantProps(Manifest, componentName).forEach(function reportVariant(variant) {
      if (handled) {
        log('info', '“' + variant.name + '”已生成为组件集的可变属性'
          + (variant.values.length ? '（' + variant.values.join('、') + '）' : ''))
        return
      }
      log('info', '“' + variant.name + '”是可变属性，需要在组件集里手动配置'
        + (variant.values.length ? '（可变值：' + variant.values.join('、') + '）' : '')
        + '；契约里已预留 ' + variant.prop + ' 映射')
    })
  }

  /**
   * Writes properties and contract onto a main component the designer already
   * drew. Nothing about a specific component is hardcoded here: adding a
   * component means editing design-system/components.json.
   */
  async function scaffoldComponent(rawComponentName) {
    var componentName = nonEmptyString(rawComponentName)
    try {
      assertManifestReady(componentName)

      var target = scaffoldTarget()
      var result = await applyManifest(target, componentName)
      var created = result.created
      var skipped = result.skipped

      var summary = componentName + ' 配置完成：新建 ' + created + ' 个属性，跳过 '
        + skipped + ' 个已有属性，并写入 shroom/contract'
      log('success', summary)
      reportVariants(componentName, false)
      post({
        type: 'scaffold:result',
        ok: true,
        component: componentName,
        created: created,
        skipped: skipped,
        message: summary
      })
      if (typeof mg.notify === 'function') mg.notify(componentName + ' 属性与契约已配置')
    } catch (error) {
      var detail = error && error.message ? error.message : String(error)
      log('error', (componentName || '组件') + ' 配置失败：' + detail)
      post({ type: 'scaffold:result', ok: false, component: componentName, message: detail })
    }
  }

  var MAX_VARIANTS = 24
  var PLACEHOLDER_SIZE = { width: 320, height: 200 }

  /** Cartesian product of every variant-backed prop, named the way MasterGo expects. */
  function variantCombinations(variants) {
    if (!variants.length) return []

    var combos = [[]]
    variants.forEach(function expand(variant) {
      var next = []
      combos.forEach(function pair(combo) {
        variant.values.forEach(function addValue(value) {
          next.push(combo.concat([variant.name + '=' + value]))
        })
      })
      combos = next
    })

    if (combos.length > MAX_VARIANTS) {
      throw new Error('可变值组合有 ' + combos.length + ' 种，超过 ' + MAX_VARIANTS
        + ' 个上限；请减少枚举属性或改用 TEXT 属性')
    }
    return combos.map(function toName(parts) { return parts.join(', ') })
  }

  function createPlaceholder(label) {
    var rectangle = mg.createRectangle()
    rectangle.name = label
    if (typeof rectangle.resize === 'function') {
      safely(function sizePlaceholder() {
        return rectangle.resize(PLACEHOLDER_SIZE.width, PLACEHOLDER_SIZE.height)
      }, null)
    }
    return rectangle
  }

  function place(node, x, y) {
    safely(function position() {
      node.x = x
      node.y = y
      return true
    }, null)
  }

  function viewportOrigin() {
    var center = safely(function readCenter() { return mg.viewport.center }, null)
    if (center && typeof center.x === 'number' && typeof center.y === 'number') {
      return { x: Math.round(center.x), y: Math.round(center.y) }
    }
    return { x: 0, y: 0 }
  }

  /**
   * Builds the main component itself so the designer has something to drag out
   * of the assets panel. The visuals are a placeholder — code cannot know what
   * the component looks like — but the name, properties and contract are right,
   * so replacing the placeholder keeps every binding intact.
   */
  async function createComponentNode(componentName, origin) {
    if (typeof mg.createComponent !== 'function' || typeof mg.createRectangle !== 'function') {
      throw new Error('当前 MasterGo 版本不支持 createComponent/createRectangle')
    }

    var variants = Derive.deriveVariantProps(Manifest, componentName)
    var names = variantCombinations(variants)

    if (!names.length) {
      var single = mg.createComponent([createPlaceholder(componentName + ' 占位视觉')])
      single.name = componentName
      place(single, origin.x, origin.y)
      return { node: single, variantCount: 0 }
    }

    if (typeof mg.combineAsVariants !== 'function') {
      throw new Error('当前 MasterGo 版本不支持 combineAsVariants，无法生成枚举组件集')
    }

    var members = names.map(function buildMember(name, index) {
      var member = mg.createComponent([createPlaceholder(componentName + ' 占位视觉')])
      member.name = name
      place(member, origin.x + index * (PLACEHOLDER_SIZE.width + 40), origin.y)
      return member
    })

    var set = mg.combineAsVariants(members, currentPage())
    set.name = componentName
    place(set, origin.x, origin.y)
    return { node: set, variantCount: members.length }
  }

  async function generateComponent(rawComponentName) {
    var componentName = nonEmptyString(rawComponentName)
    try {
      assertManifestReady(componentName)
      // Fail before touching the canvas if the manifest entry is unusable.
      Derive.deriveContract(Manifest, componentName)

      var origin = viewportOrigin()
      var built = await createComponentNode(componentName, origin)
      var result = await applyManifest(built.node, componentName)

      var page = currentPage()
      if (page) page.selection = [built.node]
      if (mg.viewport && typeof mg.viewport.scrollAndZoomIntoView === 'function') {
        mg.viewport.scrollAndZoomIntoView([built.node])
      }
      if (typeof mg.commitUndo === 'function') mg.commitUndo()

      var summary = '已在画布生成 ' + componentName
        + (built.variantCount ? '（组件集，' + built.variantCount + ' 个可变组合）' : '')
        + '，并写入 ' + result.created + ' 个属性和 shroom/contract'
      log('success', summary)
      reportVariants(componentName, built.variantCount > 0)
      log('info', '里面是占位矩形，替换成真实视觉即可，属性和契约不会丢；现在可以从「资源 → 组件」把它拖到画布上使用')
      post({
        type: 'generate:result',
        ok: true,
        component: componentName,
        variantCount: built.variantCount,
        message: summary
      })
      if (typeof mg.notify === 'function') mg.notify(componentName + ' 已生成')
      publishSelection()
    } catch (error) {
      var detail = error && error.message ? error.message : String(error)
      log('error', (componentName || '组件') + ' 生成失败：' + detail)
      post({ type: 'generate:result', ok: false, component: componentName, message: detail })
    }
  }

  var libraryIndex = Object.create(null)

  function componentCard(entry, libraryName) {
    return {
      ukey: String(entry.ukey || ''),
      name: String(entry.name || '未命名组件'),
      library: libraryName,
      cover: String(entry.cover || ''),
      width: Number(entry.width) || 0,
      height: Number(entry.height) || 0,
      type: String(entry.type || 'COMPONENT'),
      mapped: knowsComponent(String(entry.name || '').split('/')[0]),
      propertyCount: Array.isArray(entry.properties) ? entry.properties.length : 0
    }
  }

  /**
   * Team library components already look right and already exist, so browsing
   * and dragging them beats generating placeholder skeletons. `cover` is a
   * ready-made preview image, so the panel needs no rendering of its own.
   */
  async function publishLibrary() {
    if (typeof mg.getTeamLibraryAsync !== 'function') {
      log('error', '当前 MasterGo 版本不支持 getTeamLibraryAsync，无法浏览团队库')
      post({ type: 'library:components', libraries: [], components: [] })
      return
    }

    try {
      var libraries = await mg.getTeamLibraryAsync()
      var names = []
      var cards = []
      libraryIndex = Object.create(null)

      ;(Array.isArray(libraries) ? libraries : []).forEach(function readLibrary(library) {
        var libraryName = String((library && library.name) || '未命名库')
        names.push(libraryName)
        var list = library && Array.isArray(library.componentList) ? library.componentList : []
        list.forEach(function readComponent(entry) {
          if (!entry || !entry.ukey) return
          // Variant members share one card: the set is what the designer drags.
          if (entry.componentSetUkey) return
          var card = componentCard(entry, libraryName)
          libraryIndex[card.ukey] = entry
          cards.push(card)
        })
      })

      post({ type: 'library:components', libraries: names, components: cards })
      log('success', '已载入 ' + names.length + ' 个团队库，共 ' + cards.length + ' 个组件')
    } catch (error) {
      var detail = error && error.message ? error.message : String(error)
      log('error', '读取团队库失败：' + detail)
      post({ type: 'library:components', libraries: [], components: [] })
    }
  }

  function containerAt(x, y) {
    if (typeof mg.getNodeByPosition !== 'function') return null
    var node = safely(function findNode() { return mg.getNodeByPosition({ x: x, y: y }) }, null)
    var containers = ['BOOLEAN_OPERATION', 'FRAME', 'COMPONENT', 'GROUP', 'PAGE']
    while (node) {
      if (containers.indexOf(String(node.type || '').toUpperCase()) !== -1) return node
      node = safely(function getParent() { return node.parent }, null)
    }
    return null
  }

  /** Imports a library component and drops an instance onto the canvas. */
  async function insertLibraryComponent(ukey, position) {
    try {
      if (!nonEmptyString(ukey)) throw new Error('缺少组件 ukey')
      if (typeof mg.importComponentByKeyAsync !== 'function') {
        throw new Error('当前 MasterGo 版本不支持 importComponentByKeyAsync')
      }

      var component = await mg.importComponentByKeyAsync(ukey)
      if (!component || typeof component.createInstance !== 'function') {
        throw new Error('导入的组件不支持 createInstance')
      }

      var instance = component.createInstance()
      var origin = position && typeof position.x === 'number'
        ? { x: Math.round(position.x), y: Math.round(position.y) }
        : viewportOrigin()
      place(instance, origin.x, origin.y)

      var container = position ? containerAt(origin.x, origin.y) : null
      if (container && typeof container.appendChild === 'function' && container !== instance.parent) {
        safely(function reparent() { return container.appendChild(instance) }, null)
      }

      var page = currentPage()
      if (page) page.selection = [instance]
      if (typeof mg.commitUndo === 'function') mg.commitUndo()

      var label = nonEmptyString(instance.name) || nonEmptyString(component.name) || '组件'
      log('success', '已插入实例“' + label + '”')
      post({ type: 'library:inserted', ok: true, ukey: ukey, name: label })
      publishSelection()
    } catch (error) {
      var detail = error && error.message ? error.message : String(error)
      log('error', '插入组件失败：' + detail)
      post({ type: 'library:inserted', ok: false, ukey: ukey, message: detail })
    }
  }

  function propKeyFrom(label, used) {
    var ascii = nonEmptyString(label).replace(/[^A-Za-z0-9]+/g, ' ').trim()
    var key = ''
    if (ascii) {
      var parts = ascii.split(' ')
      key = parts[0].charAt(0).toLowerCase() + parts[0].slice(1)
      for (var i = 1; i < parts.length; i += 1) {
        key += parts[i].charAt(0).toUpperCase() + parts[i].slice(1)
      }
      if (!/^[A-Za-z_$]/.test(key)) key = ''
    }
    if (!key) key = 'prop'
    var candidate = key
    var suffix = 2
    while (used[candidate]) {
      candidate = key + suffix
      suffix += 1
    }
    used[candidate] = true
    return candidate
  }

  /** Turns one component's real MasterGo properties into a manifest entry to paste. */
  function manifestSnippetFrom(name, properties) {
    var used = Object.create(null)
    var props = {}

    ;(Array.isArray(properties) ? properties : []).forEach(function convert(property) {
      var label = nonEmptyString(property && property.name)
      if (!label) return

      var key = propKeyFrom(nonEmptyString(property.alias) || label, used)
      var type = String(property.type || 'TEXT').toUpperCase()

      if (type === 'VARIANT') {
        var values = {}
        ;(Array.isArray(property.variantOptions) ? property.variantOptions : []).forEach(
          function addOption(option, index) {
            var alias = Array.isArray(property.variantOptionsAlias)
              ? nonEmptyString(property.variantOptionsAlias[index])
              : ''
            values[String(option)] = alias || String(option)
          }
        )
        var codes = Object.keys(values).map(function readCode(option) { return values[option] })
        props[key] = {
          label: label,
          type: 'enum',
          values: values,
          'default': codes.length ? codes[0] : ''
        }
        return
      }

      if (type === 'BOOLEAN') {
        props[key] = { label: label, type: 'boolean', 'default': property.defaultValue === true }
        return
      }

      props[key] = { label: label, type: 'string', 'default': String(property.defaultValue || '') }
    })

    var entry = {}
    entry[name] = {
      import: '@/components/' + name + '/' + name,
      version: '1.0.0',
      props: props
    }
    return entry
  }

  function propertiesOfSelectedInstance(instance, mainComponent) {
    var sources = componentSources(mainComponent)
    var definitions = readDefinitions(sources)
    if (definitions.length) return definitions

    // Library components expose their definitions through getTeamLibraryAsync.
    var raw = Mapping.normalizeProperties(
      safely(function readProperties() { return instance.componentProperties }, [])
    )
    return raw.map(function asDefinition(property) {
      return {
        name: property.name,
        type: typeof property.value === 'boolean' ? 'BOOLEAN' : 'TEXT',
        defaultValue: property.value
      }
    })
  }

  /**
   * Reads the real property names off the selected instance (or a library card)
   * and emits a manifest entry, so mapping an existing component is paste-only.
   */
  async function buildManifestSnippet(ukey) {
    try {
      var name = ''
      var properties = []

      if (nonEmptyString(ukey)) {
        var entry = libraryIndex[ukey]
        if (!entry) throw new Error('组件不在已载入的团队库里，请先刷新组件库')
        name = String(entry.name || '').split('/')[0]
        properties = Array.isArray(entry.properties) ? entry.properties : []
        if (!properties.length) {
          log('warn', '这个库没有随发布带出属性定义（老版本库），改为拖一个实例到画布后再生成')
        }
      } else {
        var instances = selection().filter(function keepInstances(node) {
          return isType(node, 'INSTANCE')
        })
        if (instances.length !== 1) throw new Error('请只选中一个实例，或在组件库里点某个组件的「生成清单片段」')
        var instance = instances[0]
        var mainComponent = await getMainComponent(instance)
        name = componentName(instance, mainComponent, {})
        properties = propertiesOfSelectedInstance(instance, mainComponent)
      }

      if (!nonEmptyString(name)) throw new Error('无法确定组件名')
      var snippet = manifestSnippetFrom(name, properties)
      var text = JSON.stringify(snippet, null, 2)

      log('success', '已生成 ' + name + ' 的清单片段，粘贴到 design-system/components.json 的 components 里')
      post({ type: 'snippet:result', ok: true, component: name, snippet: text })
    } catch (error) {
      var detail = error && error.message ? error.message : String(error)
      log('error', '生成清单片段失败：' + detail)
      post({ type: 'snippet:result', ok: false, message: detail })
    }
  }

  function onDrop(event) {
    var metadata = event && event.dropMetadata
    if (!metadata || metadata.source !== 'shroom-library' || !metadata.ukey) return
    insertLibraryComponent(metadata.ukey, {
      x: Number(event.absoluteX) || 0,
      y: Number(event.absoluteY) || 0
    })
  }

  function publishManifest() {
    if (!Derive || !Manifest) {
      log('error', '组件清单未打包进插件，请重新执行 npm run build')
      post({ type: 'manifest:components', components: [] })
      return
    }

    var validation = Derive.validateManifest(Manifest)
    if (!validation.valid) {
      validation.errors.forEach(function reportManifestError(message) {
        log('error', '组件清单：' + message)
      })
      post({ type: 'manifest:components', components: [] })
      return
    }

    var components = Derive.listComponents(Manifest)
    post({ type: 'manifest:components', components: components })
    log('info', '组件清单已载入：' + components.join('、'))
  }

  async function selectInstance(instanceId) {
    if (!instanceId || typeof instanceId !== 'string') return
    var node = null
    try {
      if (typeof mg.getNodeByIdAsync === 'function') node = await mg.getNodeByIdAsync(instanceId)
      else if (typeof mg.getNodeById === 'function') node = mg.getNodeById(instanceId)
    } catch (_error) {
      node = null
    }
    if (!node || !isType(node, 'INSTANCE')) {
      log('warn', '反向命令指定的实例不存在：' + instanceId)
      return
    }
    var page = currentPage()
    if (page) page.selection = [node]
    if (mg.viewport && typeof mg.viewport.scrollAndZoomIntoView === 'function') {
      mg.viewport.scrollAndZoomIntoView([node])
    }
    log('info', '已按前端命令定位实例“' + (node.name || instanceId) + '”')
  }

  function handleDesignCommand(message) {
    if (message.command === 'select-instance') {
      var payload = message.payload && typeof message.payload === 'object' ? message.payload : {}
      selectInstance(payload.instanceId)
      return
    }
    log('warn', '已忽略未知反向命令：' + String(message.command || ''))
  }

  mg.showUI(__html__, { width: 440, height: 760 })
  mg.ui.onmessage = function onUiMessage(message) {
    if (!message || typeof message !== 'object') return
    if (message.type === 'exportSelection') exportSelection('manual')
    else if (message.type === 'setAutoPush') {
      autoPush = Boolean(message.enabled)
      if (!autoPush && selectionTimer) {
        clearTimeout(selectionTimer)
        selectionTimer = null
      }
    }
    else if (message.type === 'scaffoldProperties') scaffoldComponent(message.component)
    else if (message.type === 'generateComponent') generateComponent(message.component)
    else if (message.type === 'bindSlot') bindSlot(message.slot)
    else if (message.type === 'designCommand') handleDesignCommand(message)
    else if (message.type === 'requestSelection') publishSelection()
    else if (message.type === 'requestManifest') publishManifest()
    else if (message.type === 'requestLibrary') publishLibrary()
    else if (message.type === 'insertComponent') insertLibraryComponent(message.ukey, null)
    else if (message.type === 'buildSnippet') buildManifestSnippet(message.ukey)
  }

  if (typeof mg.on === 'function') {
    mg.on('selectionchange', onSelectionChange)
    mg.on('layoutchange', onLayoutChange)
    mg.on('drop', onDrop)
  }
  publishSelection()
  publishManifest()
  publishLibrary()
})()
