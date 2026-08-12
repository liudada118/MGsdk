# Shroom 设计桥

这是一套可本地运行的设计配置链路：MasterGo 桌面插件读取选中组件的属性，经 WebSocket 设计桥校验并保存，再实时推送给 Shroom React 前端。服务停掉或插件离线时，前端继续使用代码中的默认值，不影响正常页面。

## 目录

```text
.
├─ design-system/
│  └─ components.json      组件清单：整条链路的唯一真相
├─ plugin/                 MasterGo 插件、映射引擎与构建脚本
├─ server/                 本地 WebSocket 设计桥与独立启动器
├─ shroom-patch/design/    可复制到 Shroom 前端的消费层
├─ exports/                手动复制给 Shroom 的独立配置输出目录
├─ scripts/                导出校验与 registry 生成
├─ docs/
│  ├─ manifest.md          组件清单字段说明
│  ├─ contracts.example.json
│  ├─ current.example.json
│  ├─ design-config.schema.json
│  └─ protocol.md
└─ package.json            统一测试、生成和构建入口
```

要求 Node.js 18 或更高版本，以及 MasterGo 桌面客户端（网页版不能加载开发插件）。

## 从零跑通

安装并验证：

```bash
npm run install:all
npm test
npm run build
```

启动独立导出模式：

```bash
npm run export:bridge
```

终端看到 `已监听 ws://127.0.0.1:7311` 后保持运行。在 MasterGo 桌面客户端里**打开一个设计文件**（主页没有插件菜单），在画布上右键选择“插件 → 开发者模式 → 创建/添加插件”，导入 `plugin/dist/manifest.json`。

插件面板会自动连接默认地址，并列出这个文件订阅的**团队库组件**（带预览图）。日常流程就三步：

1. 在“组件库”里搜到组件，**拖到画布**或点卡片插入实例
2. 在右侧属性面板改值
3. 点“**导出并推送**”，或勾上“画布变化时自动推送”让它跟着改动走

成功后会生成 `exports/current.json`，**不会自动修改 Shroom 工程**。

卡片上的角标表示这个组件在不在组件清单里：

- **已映射** —— 清单里有，导出后代码直接生效
- **未映射** —— 点卡片右上角的 `≡`，插件会读出它在 MasterGo 里的真实属性名并生成一段清单片段，粘进 `design-system/components.json` 再 `npm run build` 即可

团队库组件**不需要**编辑权限：契约由组件清单推导，插件不往库组件上写任何东西。

如果某个组件团队库里没有，展开面板底部的“自研组件”：“生成空白骨架”会建出主组件、属性和枚举组件集（内部是占位矩形，替换视觉不影响绑定）；设计师已经画好的话，选中主组件点“写入属性与契约”。

可以在另一个终端检查导出结果：

```bash
npm run export:check
```

## 手动把配置放进 Shroom

1. 将 `exports/current.json` 复制到目标工程，例如 `shroom/client/src/design/current.json`。
2. 将本项目的 `shroom-patch/design/` 代码复制到同一个 `design/` 目录；如果目标目录已有这些文件，只复制 `current.json` 即可。
3. 在 Shroom 应用入口加载静态配置：

```javascript
import designConfig from './design/current.json'
import { applyStaticDesignConfig } from './design'

applyStaticDesignConfig(designConfig)
```

静态配置模式不需要启动设计桥，也不需要调用 `connect()`。以后重新导出时，只替换 Shroom 工程里的 `current.json`。

## 接入 Shroom 前端

将 `shroom-patch/design/` 复制到 Shroom 的 `client/src/design/`，并确认目标应用已有 `react` 和 `zustand`：

```javascript
import { useDesignStore } from './design/designStore'
import DesignBridgeIndicator from './design/DesignBridgeIndicator'

useDesignStore.getState().connect()
```

上面是实时同步模式；如果你只想手动复制 JSON，请使用前一节的 `applyStaticDesignConfig`，不要调用 `connect()`。

在根组件 JSX 中加入开发态指示器：

```jsx
<DesignBridgeIndicator />
```

让具体组件消费设计配置：

```javascript
import { useDesignProps } from '../design/SchemaRenderer'

function EquipPanel() {
  const drawerProps = useDesignProps('Drawer', {
    title: '设备状态',
    direction: 'right'
  }, { slot: 'equipPanel.drawer' })

  return <Drawer {...drawerProps}>...</Drawer>
}
```

设计侧未提供的属性会由第二个参数兜底；收到非法类型或枚举值时，注册表也会回退到安全默认值并输出开发警告。

## 槽位：把画布实例绑定到代码调用点

一个组件在设计稿里通常不止一个实例。`slot` 是实例和调用点之间的稳定标识，让"设计师改哪个、代码里变哪个"是确定的。

**导出时没有槽位的实例会自动分配一个**（`drawer.1`、`drawer.2`…）并写回画布，所以正常流程下你什么都不用做。想换成有意义的名字时，选中实例在插件面板的"槽位绑定"里填（如 `equipPanel.drawer`）并点"绑定"。

槽位写在实例的 `sharedPluginData` 中，改图层名不会失效；不想开面板时，也可以把图层名写成 `Drawer/设备状态#equipPanel.drawer`，插件会取 `#` 后面的部分。槽位名只能包含字母、数字和 `.` `_` `:` `-`，不超过 64 个字符。

代码侧用 `{ slot }` 精确消费：

```javascript
const equipDrawer = useDesignProps('Drawer', defaults, { slot: 'equipPanel.drawer' })
const alertDrawer = useDesignProps('Drawer', defaults, { slot: 'alertPanel.drawer' })
```

不指定 `slot` 时，只有该组件恰好只有一个实例才是明确的。出现下面几种情况会有明确提示，不会静默绑到错误的实例：

| 情况 | 提示位置 | 行为 |
| :--- | :--- | :--- |
| 多个实例、调用点没写 `slot` | 浏览器控制台 | 按 id 取第一个，并告警 |
| `slot` 在配置里没有对应实例 | 浏览器控制台 | 保留代码默认值 |
| 两个实例抢同一个 `slot`（复制实例会连槽位一起复制） | 插件日志（error）+ 浏览器控制台 | 按 id 取第一个，并告警 |

`npm run export:check` 也会在复制 JSON 之前把这些绑定问题打印出来。

## 接入你自己的组件

代码是唯一真相：在 `design-system/components.json` 里描述一次，MasterGo 的组件属性、`shroom/contract` 和前端 registry 全部由它推导，不用三处手工维护。字段说明见 [docs/manifest.md](docs/manifest.md)。

**1. 在清单里加一段**，key 用代码里真实的 prop 名：

```json
"Button": {
  "import": "@/components/Button/Button",
  "version": "1.0.0",
  "props": {
    "text":     { "label": "文字",   "type": "string",  "default": "确定" },
    "disabled": { "label": "禁用",   "type": "boolean", "default": false },
    "size":     { "label": "尺寸",   "type": "enum",
                  "values": { "小": "sm", "中": "md", "大": "lg" }, "default": "md" }
  }
}
```

**2. 生成并打包**

```bash
npm run build     # 先生成前端 registry，再把清单内联进插件
```

**3. MasterGo 里重新导入** `plugin/dist/manifest.json`。

**4. 面板下拉里选 `Button` → 点「在画布生成该组件」。**
因为有 `size` 枚举，会生成一个含 3 个可变组合（`尺寸=小/中/大`）的组件集，「文字」「禁用」作为组件属性挂上去，契约一并写好。
如果设计师已经画好 Button 了，改成选中它的主组件点「写入属性与契约」—— 这种情况下枚举需要你自己在组件集里配，日志会说明。

**5. 从「资源 → 组件」拖出实例 → 导出并推送**（槽位会自动分配），然后代码里：

```javascript
const buttonProps = useDesignProps('Button', { text: '确定' }, { slot: 'toolbar.submit' })
```

清单写错时，`generate`、`build` 和插件面板三处都会拒绝并列出具体问题（缺 `default`、`label` 重复、枚举默认值不在 `values` 里等），不会写出半成品契约。

## 集成到现有 Node 服务

也可以不单独运行 `standalone.js`，直接在现有服务入口中启动：

```javascript
const path = require('node:path')

if (process.env.NODE_ENV !== 'production') {
  require('./designBridge').start({
    port: 7311,
    dir: path.join(__dirname, '../design')
  })
}
```

默认仅绑定 `127.0.0.1`。若端口需要调整，服务端、插件面板和前端连接地址必须保持一致。

## 契约规则

契约（`shroom/contract`）由组件清单生成并写进主组件的 `sharedPluginData`，正常情况下你不需要手写。导出时插件按以下顺序把画布属性转换为代码 props：

1. 主组件属性定义上的 `alias`；
2. 主组件 `sharedPluginData` 中 `shroom/contract` 的 `propMap`；
3. 无法映射的值保留在 `unmapped`，并在插件日志中明确提示。

`valueMap` 用于枚举翻译，`numberProps` 把文本转为有限数字，`jsonProps` 解析数组或对象 —— 这三项分别由清单里的 `enum`、`number`、`array`/`object` 推出。生成结果的样子见 `docs/contracts.example.json`，消息格式见 `docs/protocol.md`。

契约决定"画布属性叫什么名字对应代码里哪个 prop"，槽位决定"画布上哪个实例对应代码里哪个调用点"，两者互不替代。
