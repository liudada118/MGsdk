'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const pluginRoot = path.resolve(__dirname, '..')
const bundlePath = path.join(pluginRoot, 'dist', 'main.js')
const uiBundlePath = path.join(pluginRoot, 'dist', 'index.html')

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function run() {
  assert.ok(fs.existsSync(bundlePath), '运行时冒烟测试前必须生成 dist/main.js')
  assert.ok(fs.existsSync(uiBundlePath), '运行时冒烟测试前必须生成 dist/index.html')

  const builtUi = fs.readFileSync(uiBundlePath, 'utf8')
  assert.match(builtUi, /配置已导出到：['"]?\s*\+\s*destination/)
  assert.match(builtUi, /typeof message\.file === ['"]string['"]/)
  assert.match(builtUi, /appendLog\(['"]error['"], message\.message \|\| ['"]服务端未接受配置['"]\)/)
  assert.match(builtUi, /postToMain\(['"]bindSlot['"], \{ slot: elements\.slot\.value\.trim\(\) \}\)/)
  assert.match(builtUi, /message\.type === ['"]manifest:components['"]/)

  const builtBundle = fs.readFileSync(bundlePath, 'utf8')
  assert.match(builtBundle, /globalThis\.ShroomManifest = \{/)

  const uiMessages = []
  const eventHandlers = {}
  const addedProperties = []
  const sharedPluginData = new Map()
  let shownUi = null

  const allInstances = []
  const page = {
    id: 'page-1',
    name: '设备状态',
    selection: [],
    findAll(predicate) {
      return allInstances.filter(predicate)
    }
  }

  // 生成组件用到的画布节点工厂
  const createdNodes = []
  let nodeSequence = 0
  function createNode(type, extra) {
    nodeSequence += 1
    const ownPluginData = new Map()
    const node = Object.assign(
      {
        id: `${type.toLowerCase()}-${nodeSequence}`,
        name: '',
        type,
        x: 0,
        y: 0,
        children: [],
        componentPropertyValues: [],
        componentPropertyDefinitions: [],
        resize(width, height) {
          this.width = width
          this.height = height
        },
        getSharedPluginData(namespace, key) {
          return ownPluginData.get(`${namespace}/${key}`) || ''
        },
        setSharedPluginData(namespace, key, value) {
          ownPluginData.set(`${namespace}/${key}`, value)
        },
        addComponentProperty(name, type_, defaultValue) {
          this.componentPropertyValues.push({ name, type: type_, defaultValue })
          return `property-${this.componentPropertyValues.length}`
        }
      },
      extra || {}
    )
    createdNodes.push(node)
    return node
  }

  const mainComponent = {
    id: 'component-1',
    name: 'Drawer',
    type: 'COMPONENT',
    parent: { id: 'page-1', type: 'PAGE' },
    componentPropertyValues: [
      { id: 'property-title', name: '标题', type: 'TEXT', alias: 'title', defaultValue: '默认标题' }
    ],
    componentPropertyDefinitions: [],
    getSharedPluginData(namespace, key) {
      return sharedPluginData.get(`${namespace}/${key}`) || ''
    },
    setSharedPluginData(namespace, key, value) {
      sharedPluginData.set(`${namespace}/${key}`, value)
    },
    addComponentProperty(name, type, defaultValue) {
      addedProperties.push({ name, type, defaultValue })
      this.componentPropertyValues.push({ name, type, defaultValue })
      return `property-${addedProperties.length}`
    }
  }

  function createInstance(id, name) {
    const ownPluginData = new Map()
    return {
      id,
      name,
      type: 'INSTANCE',
      mainComponent,
      componentProperties: [
        { id: 'property-title', name: '标题', type: 'TEXT', value: '实时标题' },
        { id: 'property-visible', name: '显示', type: 'BOOLEAN', value: true }
      ],
      getSharedPluginData(namespace, key) {
        return ownPluginData.get(`${namespace}/${key}`) || ''
      },
      setSharedPluginData(namespace, key, value) {
        ownPluginData.set(`${namespace}/${key}`, value)
      }
    }
  }

  const instance = createInstance('instance-1', 'Drawer/设备状态')
  const secondInstance = createInstance('instance-2', 'Drawer/告警详情')
  allInstances.push(instance, secondInstance)

  sharedPluginData.set('shroom/contract', JSON.stringify({
    component: 'Drawer',
    import: '@/components/Drawer/Drawer',
    version: '1.0.0',
    propMap: { 显示: 'show', 标题: 'legacyTitle' },
    valueMap: {},
    numberProps: [],
    jsonProps: []
  }))

  const mg = {
    documentId: 'file-1',
    document: {
      id: 'document-1',
      name: '座椅控制台',
      currentPage: page
    },
    ui: {
      onmessage: null,
      postMessage(message) {
        uiMessages.push(message)
      }
    },
    viewport: {
      center: { x: 100, y: 50 },
      scrollAndZoomIntoView() {}
    },
    createRectangle() {
      return createNode('RECTANGLE')
    },
    createComponent(children) {
      return createNode('COMPONENT', { children: children || [] })
    },
    combineAsVariants(members, parent) {
      return createNode('COMPONENT_SET', { children: members, parent })
    },
    commitUndo() {},
    async getTeamLibraryAsync() {
      return [
        {
          name: 'Ant Design For AI',
          id: 'lib-1',
          componentList: [
            {
              id: 'lib-drawer',
              name: 'Drawer',
              ukey: 'ukey-drawer',
              type: 'COMPONENT_SET',
              cover: 'https://example.invalid/drawer.png',
              width: 320,
              height: 200,
              componentSetUkey: '',
              properties: [
                { name: '标题', type: 'TEXT', defaultValue: '标题' },
                { name: 'Open', type: 'BOOLEAN', defaultValue: true },
                {
                  name: 'Placement',
                  type: 'VARIANT',
                  defaultValue: 'right',
                  variantOptions: ['left', 'right']
                }
              ]
            },
            {
              id: 'lib-drawer-variant',
              name: 'Placement=left',
              ukey: 'ukey-drawer-left',
              type: 'COMPONENT',
              cover: '',
              width: 320,
              height: 200,
              componentSetUkey: 'ukey-drawer'
            }
          ],
          style: {}
        }
      ]
    },
    async importComponentByKeyAsync(ukey) {
      if (ukey !== 'ukey-drawer') throw new Error(`未知 ukey：${ukey}`)
      return {
        id: 'imported-1',
        name: 'Drawer',
        type: 'COMPONENT_SET',
        createInstance() {
          return createNode('INSTANCE', { name: 'Drawer', mainComponent })
        }
      }
    },
    getNodeByPosition() {
      return page
    },
    showUI(html, options) {
      shownUi = { html, options }
    },
    on(event, handler) {
      eventHandlers[event] = handler
    },
    notify() {},
    getNodeById(id) {
      return [instance, secondInstance].find((node) => node.id === id) || null
    }
  }

  const context = vm.createContext({
    mg,
    __html__: '<main>mock ui</main>',
    console,
    Date,
    JSON,
    Math,
    Number,
    Object,
    Array,
    String,
    Boolean,
    Promise,
    setTimeout,
    clearTimeout
  })

  const bundle = fs.readFileSync(bundlePath, 'utf8')
  vm.runInContext(bundle, context, { filename: bundlePath, timeout: 1000 })

  assert.equal(shownUi.html, '<main>mock ui</main>')
  assert.equal(shownUi.options.width, 440)
  assert.equal(shownUi.options.height, 760)
  assert.equal(typeof mg.ui.onmessage, 'function')
  assert.equal(typeof eventHandlers.selectionchange, 'function')
  assert.equal(uiMessages[0].type, 'selection:changed')

  // 组件清单被内联进 bundle，面板的组件下拉靠它填充
  const publishedManifest = uiMessages.find((message) => message.type === 'manifest:components')
  assert.ok(publishedManifest, '插件初始化后应广播组件清单')
  assert.deepEqual(publishedManifest.components, ['Drawer', 'IconAndText', 'Select'])

  page.selection = [instance]
  eventHandlers.selectionchange(['instance-1'])
  mg.ui.onmessage({ type: 'exportSelection' })
  await flushAsyncWork()

  const exported = uiMessages.find((message) => message.type === 'export:ready')
  assert.ok(exported, '执行导出消息后应生成 export:ready')
  assert.equal(exported.payload.schemaVersion, '1.0.0')
  assert.equal(exported.payload.file.id, 'file-1')
  assert.equal(exported.payload.page.id, 'page-1')
  assert.equal(exported.payload.instances.length, 1)
  assert.equal(exported.payload.instances[0].props.title, '实时标题')
  assert.equal(exported.payload.instances[0].props.show, true)
  assert.deepEqual(Object.keys(exported.payload.instances[0].props).sort(), ['show', 'title'])
  // 未绑定的实例在导出时自动拿到槽位，并写回画布，下次导出保持一致
  assert.equal(exported.payload.instances[0].slot, 'drawer.1')
  assert.equal(instance.getSharedPluginData('shroom', 'slot'), 'drawer.1')

  // 槽位绑定：写入 sharedPluginData，并在选区广播里回显
  mg.ui.onmessage({ type: 'bindSlot', slot: 'equipPanel.drawer' })
  await flushAsyncWork()

  const bound = uiMessages.find((message) => message.type === 'slot:result')
  assert.ok(bound && bound.ok, '绑定槽位后应返回成功的 slot:result')
  assert.equal(bound.slot, 'equipPanel.drawer')
  assert.equal(instance.getSharedPluginData('shroom', 'slot'), 'equipPanel.drawer')
  const rebroadcast = uiMessages.filter((message) => message.type === 'selection:changed').pop()
  assert.equal(rebroadcast.slot, 'equipPanel.drawer')
  assert.equal(rebroadcast.slotEditable, true)

  // 非法槽位名必须被拒绝，而不是写进画布
  mg.ui.onmessage({ type: 'bindSlot', slot: '带空格 的槽位' })
  await flushAsyncWork()
  const rejected = uiMessages.filter((message) => message.type === 'slot:result').pop()
  assert.equal(rejected.ok, false)
  assert.equal(instance.getSharedPluginData('shroom', 'slot'), 'equipPanel.drawer')

  // 图层名 #suffix 是不开面板时的兜底绑定方式
  secondInstance.name = 'Drawer/告警详情#alertPanel.drawer'
  page.selection = [instance, secondInstance]
  mg.ui.onmessage({ type: 'exportSelection' })
  await flushAsyncWork()

  const multiExport = uiMessages.filter((message) => message.type === 'export:ready').pop()
  assert.deepEqual(
    multiExport.payload.instances.map((record) => record.slot),
    ['equipPanel.drawer', 'alertPanel.drawer']
  )

  // 两个实例抢同一个槽位时必须在导出阶段报错
  uiMessages.length = 0
  secondInstance.setSharedPluginData('shroom', 'slot', 'equipPanel.drawer')
  mg.ui.onmessage({ type: 'exportSelection' })
  await flushAsyncWork()

  const conflict = uiMessages.find(
    (message) => message.type === 'log' && message.level === 'error' && /槽位/.test(message.message)
  )
  assert.ok(conflict, '槽位冲突时应输出 error 日志')
  assert.match(conflict.message, /被 2 个实例占用/)

  // 全部未绑定时自动分配互不冲突的槽位，不再留下歧义
  uiMessages.length = 0
  secondInstance.name = 'Drawer/告警详情'
  secondInstance.setSharedPluginData('shroom', 'slot', '')
  instance.setSharedPluginData('shroom', 'slot', '')
  mg.ui.onmessage({ type: 'exportSelection' })
  await flushAsyncWork()

  const autoAssigned = uiMessages.filter((message) => message.type === 'export:ready').pop()
  assert.deepEqual(
    autoAssigned.payload.instances.map((record) => record.slot),
    ['drawer.1', 'drawer.2']
  )
  const ambiguous = uiMessages.find(
    (message) => message.type === 'log' && message.level === 'warn' && /未绑定槽位/.test(message.message)
  )
  assert.equal(ambiguous, undefined, '自动分配后不应再报绑定不明确')

  page.selection = [mainComponent]
  uiMessages.length = 0
  mg.ui.onmessage({ type: 'scaffoldProperties', component: 'Drawer' })
  await flushAsyncWork()

  const scaffolded = uiMessages.find((message) => message.type === 'scaffold:result')
  assert.ok(scaffolded && scaffolded.ok, '执行脚手架消息后应成功返回 scaffold:result')
  assert.equal(scaffolded.component, 'Drawer')
  // 清单里 Drawer 有 5 个可创建属性，主组件已存在“标题”
  assert.deepEqual(addedProperties.map((property) => property.name), [
    '显示',
    '层级',
    '显示关闭按钮',
    '点击遮罩关闭'
  ])
  assert.equal(scaffolded.created, 4)
  assert.equal(scaffolded.skipped, 1)
  const writtenContract = JSON.parse(sharedPluginData.get('shroom/contract'))
  assert.equal(writtenContract.component, 'Drawer')
  assert.equal(writtenContract.propMap['点击遮罩关闭'], 'asideClose')
  assert.deepEqual(writtenContract.numberProps, ['zindex'])
  assert.equal(writtenContract.valueMap.direction['右侧'], 'right')

  // 可变属性不能由 API 创建，必须留成手动步骤并提示
  const variantHint = uiMessages.find(
    (message) => message.type === 'log' && /“方向”是可变属性/.test(String(message.message))
  )
  assert.ok(variantHint, '可变属性应输出手动配置提示')

  // 清单里没有的组件必须被拒绝，而不是写出一份空契约
  uiMessages.length = 0
  mg.ui.onmessage({ type: 'scaffoldProperties', component: 'NotInManifest' })
  await flushAsyncWork()
  const unknown = uiMessages.find((message) => message.type === 'scaffold:result')
  assert.equal(unknown.ok, false)
  assert.match(unknown.message, /组件清单里没有 NotInManifest/)

  // 在画布生成组件：枚举属性建成组件集，属性和契约写在组件集上
  uiMessages.length = 0
  mg.ui.onmessage({ type: 'generateComponent', component: 'Drawer' })
  await flushAsyncWork()

  const generated = uiMessages.find((message) => message.type === 'generate:result')
  assert.ok(generated && generated.ok, `生成组件应成功，实际：${generated && generated.message}`)
  assert.equal(generated.variantCount, 4, 'Drawer 的“方向”有 4 个可变值')

  const componentSet = createdNodes.find((node) => node.type === 'COMPONENT_SET')
  assert.ok(componentSet, '带枚举属性的组件应生成为组件集')
  assert.equal(componentSet.name, 'Drawer')
  // Array.from：vm 沙箱里创建的数组和宿主数组原型不同，deepEqual 会误报
  assert.deepEqual(
    Array.from(componentSet.children, (member) => member.name),
    ['方向=左侧', '方向=右侧', '方向=顶部', '方向=底部']
  )
  assert.deepEqual(
    Array.from(componentSet.componentPropertyValues, (property) => property.name),
    ['标题', '显示', '层级', '显示关闭按钮', '点击遮罩关闭']
  )
  const generatedContract = JSON.parse(componentSet.getSharedPluginData('shroom', 'contract'))
  assert.equal(generatedContract.component, 'Drawer')
  assert.equal(generatedContract.valueMap.direction['左侧'], 'left')
  assert.equal(page.selection.length, 1)
  assert.equal(page.selection[0], componentSet, '生成后应选中新组件')

  // 没有枚举属性的组件生成为单个组件，不建组件集
  createdNodes.length = 0
  uiMessages.length = 0
  mg.ui.onmessage({ type: 'generateComponent', component: 'Select' })
  await flushAsyncWork()

  const generatedSelect = uiMessages.find((message) => message.type === 'generate:result')
  assert.ok(generatedSelect && generatedSelect.ok)
  assert.equal(generatedSelect.variantCount, 0)
  assert.equal(createdNodes.filter((node) => node.type === 'COMPONENT_SET').length, 0)
  const selectComponent = createdNodes.find((node) => node.type === 'COMPONENT')
  assert.equal(selectComponent.name, 'Select')
  assert.deepEqual(
    JSON.parse(selectComponent.getSharedPluginData('shroom', 'contract')).jsonProps,
    ['options']
  )

  // layoutchange 驱动自动推送；关掉开关时不应触发
  assert.equal(typeof eventHandlers.layoutchange, 'function', '应监听 layoutchange')
  // 导出会把槽位写回画布并触发 layoutchange，插件在冷却窗口内忽略这段自写回声，
  // 这里先把窗口等过去，再验证真实的用户改动能触发推送
  await new Promise((resolve) => setTimeout(resolve, 700))
  page.selection = [instance]
  uiMessages.length = 0
  mg.ui.onmessage({ type: 'setAutoPush', enabled: false })
  eventHandlers.layoutchange()
  await new Promise((resolve) => setTimeout(resolve, 420))
  assert.equal(
    uiMessages.some((message) => message.type === 'export:ready'),
    false,
    '关闭自动推送后 layoutchange 不应导出'
  )

  mg.ui.onmessage({ type: 'setAutoPush', enabled: true })
  eventHandlers.layoutchange()
  await new Promise((resolve) => setTimeout(resolve, 420))
  await flushAsyncWork()
  assert.ok(
    uiMessages.some((message) => message.type === 'export:ready'),
    '开启自动推送后 layoutchange 应触发导出'
  )

  // 团队库：变体成员合并进组件集卡片，清单里有的标记为已映射
  uiMessages.length = 0
  mg.ui.onmessage({ type: 'requestLibrary' })
  await flushAsyncWork()

  const library = uiMessages.find((message) => message.type === 'library:components')
  assert.ok(library, '应广播团队库组件')
  assert.deepEqual(Array.from(library.libraries), ['Ant Design For AI'])
  assert.equal(library.components.length, 1, '变体成员不应单独占一张卡片')
  assert.deepEqual(Object.assign({}, library.components[0]), {
    ukey: 'ukey-drawer',
    name: 'Drawer',
    library: 'Ant Design For AI',
    cover: 'https://example.invalid/drawer.png',
    width: 320,
    height: 200,
    type: 'COMPONENT_SET',
    mapped: true,
    propertyCount: 3
  })

  // 点击卡片：导入库组件并在画布上创建实例
  uiMessages.length = 0
  mg.ui.onmessage({ type: 'insertComponent', ukey: 'ukey-drawer' })
  await flushAsyncWork()

  const inserted = uiMessages.find((message) => message.type === 'library:inserted')
  assert.ok(inserted && inserted.ok, `插入库组件应成功，实际：${inserted && inserted.message}`)
  const insertedNode = createdNodes.filter((node) => node.type === 'INSTANCE').pop()
  assert.equal(page.selection[0], insertedNode, '插入后应选中新实例')

  // 未知 ukey 要报错而不是静默失败
  uiMessages.length = 0
  mg.ui.onmessage({ type: 'insertComponent', ukey: 'ukey-nope' })
  await flushAsyncWork()
  const insertFailed = uiMessages.find((message) => message.type === 'library:inserted')
  assert.equal(insertFailed.ok, false)

  // 从画布拖放：dropMetadata 带 ukey 时按落点插入
  uiMessages.length = 0
  eventHandlers.drop({ x: 10, y: 20, absoluteX: 640, absoluteY: 480, dropMetadata: { source: 'shroom-library', ukey: 'ukey-drawer' } })
  await flushAsyncWork()
  const dropped = createdNodes.filter((node) => node.type === 'INSTANCE').pop()
  assert.equal(dropped.x, 640)
  assert.equal(dropped.y, 480)

  // 别的插件的 drop 事件不能触发插入
  const beforeForeignDrop = createdNodes.length
  eventHandlers.drop({ absoluteX: 0, absoluteY: 0, dropMetadata: { source: '别的插件' } })
  await flushAsyncWork()
  assert.equal(createdNodes.length, beforeForeignDrop, '非本插件的 drop 应被忽略')

  // 清单片段：按库组件的真实属性生成，枚举转成 values
  uiMessages.length = 0
  mg.ui.onmessage({ type: 'buildSnippet', ukey: 'ukey-drawer' })
  await flushAsyncWork()

  const snippetMessage = uiMessages.find((message) => message.type === 'snippet:result')
  assert.ok(snippetMessage && snippetMessage.ok, `生成清单片段应成功，实际：${snippetMessage && snippetMessage.message}`)
  const snippet = JSON.parse(snippetMessage.snippet)
  assert.deepEqual(Object.keys(snippet), ['Drawer'])
  assert.deepEqual(Object.keys(snippet.Drawer.props), ['prop', 'open', 'placement'])
  assert.equal(snippet.Drawer.props.prop.label, '标题', '中文属性名推不出 prop 名，保留 label 让人改')
  assert.deepEqual(snippet.Drawer.props.open, { label: 'Open', type: 'boolean', default: true })
  assert.deepEqual(snippet.Drawer.props.placement, {
    label: 'Placement',
    type: 'enum',
    values: { left: 'left', right: 'right' },
    default: 'left'
  })
  // 生成的片段必须能通过清单校验
  const derive = require('../src/derive')
  const merged = { schemaVersion: '1.0.0', components: snippet }
  assert.deepEqual(derive.validateManifest(merged).errors, [])

  console.log('✓ 构建产物冒烟测试通过（初始化、导出、自动槽位、团队库浏览与插入、拖放、清单片段、生成骨架、自动推送）')
}

run().catch((error) => {
  console.error('✗ dist/main.js MasterGo 运行时冒烟测试失败')
  console.error(error && error.stack ? error.stack : error)
  process.exitCode = 1
})
