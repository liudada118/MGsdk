# Shroom 设计桥前端消费层

本目录可以整体复制到 `shroom/client/src/design/`。它负责连接本机设计桥、消费 MasterGo 导出的配置、校验设计侧 props，并在开发环境显示连接状态。设计桥不可用时，业务组件继续使用代码默认值。

## 接入

目标项目需要 React 16.8+ 与 Zustand 4.5+。在应用入口连接一次：

```js
import { useDesignStore } from './design/designStore'
import DesignBridgeIndicator from './design/DesignBridgeIndicator'

useDesignStore.getState().connect()

// 根组件 JSX 中
// <DesignBridgeIndicator />
```

默认连接 `ws://127.0.0.1:7311`。也可显式传地址：

```js
useDesignStore.getState().connect('ws://127.0.0.1:7411')
```

### 静态配置（手动复制 JSON）

如果暂时不启动设计桥服务，可把生成的 `current.json` 手动复制到 `client/src/design/current.json`，再在应用入口直接导入并应用：

```js
import config from './design/current.json'
import { applyStaticDesignConfig } from './design'

const applied = applyStaticDesignConfig(config)
if (!applied) {
  console.warn('设计配置格式无效，继续使用代码默认值')
}
```

静态模式不会创建 WebSocket，也不需要调用 `useDesignStore.getState().connect()`。配置仍会经过相同的 `schemaVersion` 与 `instances` 基础校验；返回 `true` 表示已经写入全局 Store，返回 `false` 表示配置非法且原配置保持不变。

连接建立后客户端发送：

```json
{ "type": "hello", "role": "frontend", "protocolVersion": "1.0" }
```

Store 消费 `{ "type": "design:config", "payload": { ... } }`，同时兼容服务端直接发送配置 payload 的旧形态。断线后每 3 秒重连；`disconnect()` 会取消重连。SSR 或没有 `WebSocket` 的环境只会进入 `unavailable` 状态，不会抛错。

连接打开后可向插件发送白名单反向命令；断连、非法命令或非 JSON 对象 payload 均返回 `false`，不会抛错：

```js
const sent = useDesignStore
  .getState()
  .sendCommand('select-instance', { instanceId: 'drawer-device-status' })
```

## 在组件中消费

```jsx
import { useDesignProps } from '../design/SchemaRenderer'

function EquipPanel() {
  const drawerProps = useDesignProps('Drawer', {
    title: '设备状态',
    direction: 'right',
  })

  return <Drawer {...drawerProps}>...</Drawer>
}
```

同一配置里存在多个同名组件时，默认按实例 `id` 稳定选择，不受数组顺序影响。业务代码应在需要指定实例时传 `instanceId`：

```js
const props = useDesignProps('Drawer', defaults, { instanceId: 'drawer-device-status' })
// 字符串简写也支持：useDesignProps('Drawer', defaults, 'drawer-device-status')
```

也可以使用无 UI 约束的渲染包装器：

```jsx
<SchemaRenderer component="Drawer" defaults={defaults} instanceId="drawer-device-status">
  {(props) => <Drawer {...props} />}
</SchemaRenderer>
```

## 注册组件与校验

`registry.js` 已注册 `Drawer`、`IconAndText`、`Select`。设计侧值只有通过对应 `propsSchema` 才会覆盖代码默认值；非法值回退到代码默认值（其次是注册默认值）并输出 `[designBridge]` warning，未知属性默认忽略。

```js
import { registerDesignComponent } from './design/registry'

const undo = registerDesignComponent('Badge', {
  import: '@/components/Badge/Badge',
  version: '1.0.0',
  defaultProps: { count: 0, tone: 'neutral' },
  propsSchema: {
    count: (value) => Number.isInteger(value) && value >= 0,
    tone: { type: 'enum', values: ['neutral', 'success', 'danger'] },
  },
})

// 热更新或插件卸载时可撤销这次注册
undo()
```

Schema 支持 `string`、`boolean`、`number`、`integer`、`array`、`object`、枚举描述符以及自定义校验函数。若组件确实需要透传未声明属性，可在注册项中显式设置 `allowUnknownProps: true`。

## 状态指示器

`DesignBridgeIndicator` 在 `NODE_ENV !== 'production'` 或本机开发域名下显示，点击后展示中文连接状态、文件、页面与最近同步时间。特殊构建环境可设置 `globalThis.__SHROOM_DESIGN_BRIDGE_DEV__ = true/false`，也可通过 `<DesignBridgeIndicator enabled />` 显式控制。

## 测试

```bash
cd shroom-design-bridge/shroom-patch/design
npm install
npm test
```

Node 测试覆盖握手消息、新旧配置消息、反向命令、自动重连/主动断开、SSR 安全降级、注册表回退校验，以及多实例稳定选择。
