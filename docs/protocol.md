# Shroom 设计桥协议

协议版本为 `1.0`，所有消息都是 UTF-8 JSON。设计桥只监听本机回环地址，不提供远程访问。

## 建立连接

WebSocket 建立后，客户端首先声明角色：

```json
{ "type": "hello", "role": "plugin", "protocolVersion": "1.0" }
```

`role` 只能是 `plugin` 或 `frontend`。同一连接后续不能改变角色。

## 推送设计配置

插件发送：

```json
{
  "type": "design:config",
  "payload": {
    "schemaVersion": "1.0.0",
    "file": { "id": "file-id", "name": "座椅控制台" },
    "page": { "id": "page-id", "name": "设备状态" },
    "exportedAt": "2026-08-10T08:00:00.000Z",
    "instances": [
      {
        "id": "instance-id",
        "name": "Drawer/串口设置",
        "component": "Drawer",
        "slot": "equipPanel.drawer",
        "import": "shroom-backend-sdk/UI/shroomui",
        "version": "1.0.0",
        "props": { "title": "设备状态", "show": true },
        "unmapped": {}
      }
    ]
  }
}
```

服务端只接受 `schemaVersion` 主版本为 1 的配置。验证通过后，`payload` 会原子写入 `current.json`，再以相同的 `design:config` 消息广播给所有前端连接。

`slot` 是可选的稳定绑定键，用来把一个画布实例固定到一个代码调用点，匹配 `^[A-Za-z0-9_.:-]{1,64}$`。它保存在实例的 `sharedPluginData('shroom', 'slot')` 里，改图层名、改数组顺序都不会失效；插件也接受 `#slot` 结尾的图层名作为兜底来源。同一组件出现多个实例时，`slot` 是唯一可靠的绑定方式。

服务端向插件确认：

```json
{
  "type": "design:ack",
  "ok": true,
  "frontendCount": 1,
  "file": "C:/project/design/current.json"
}
```

## 反向命令

前端可向插件发送不含可执行代码的结构化命令：

```json
{
  "type": "design:command",
  "command": "select-instance",
  "payload": { "instanceId": "instance-id" }
}
```

服务端不解释命令，只转发给已声明为 `plugin` 的连接。插件应对命令白名单校验，未知命令必须忽略。

## 契约来源

导出时的 `propMap`/`valueMap` 按以下顺序解析：

1. 主组件 `sharedPluginData` 里的 `shroom/contract`（存在即优先，兼容手工配置的组件）；
2. 组件清单 `design-system/components.json` 中同名组件推导出的契约。

第 2 条让团队库组件无需编辑权限也能映射 —— 插件不往库组件上写任何数据。组件名的解析顺序是：契约里的 `component` → 所属组件集名 → 主组件名 → 实例名。

## 插件面板内部消息

面板与插件主线程之间的消息不经过 WebSocket：

| 类型 | 方向 | 说明 |
| :--- | :--- | :--- |
| `exportSelection` | 面板 → 主线程 | 导出当前选中的实例 |
| `requestLibrary` / `library:components` | 双向 | 读取团队库组件列表（含 `cover` 预览图与是否已映射） |
| `insertComponent` / `library:inserted` | 双向 | 导入库组件并在画布创建实例 |
| `buildSnippet` / `snippet:result` | 双向 | 按组件真实属性生成可粘贴的清单片段 |
| `requestManifest` / `manifest:components` | 双向 | 面板拉取并填充组件下拉 |
| `generateComponent` / `generate:result` | 双向 | 按清单在画布生成主组件（含枚举组件集）与契约 |
| `scaffoldProperties` / `scaffold:result` | 双向 | 给已有主组件写入属性与契约 |
| `bindSlot` | 面板 → 主线程 | 给唯一选中的实例写入 `slot`；`slot` 为空表示解除绑定 |
| `slot:result` | 主线程 → 面板 | 返回绑定结果与生效的槽位名 |
| `selection:changed` | 主线程 → 面板 | 回显选区数量，以及单选实例当前的 `slot` |

## 错误

协议或配置不合法时，服务端返回：

```json
{
  "type": "design:error",
  "code": "INVALID_CONFIG",
  "message": "schemaVersion 必须是 1.x"
}
```

