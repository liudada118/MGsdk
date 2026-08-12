# 组件清单

`design-system/components.json` 是整条链路的唯一真相。改它之后跑一次 `npm run generate && npm run build`，下面三样东西会自动对齐：

| 产物 | 由谁消费 | 生成方式 |
| :--- | :--- | :--- |
| MasterGo 组件属性 | 设计师 | 插件面板「写入属性与契约」按清单创建缺失属性 |
| `shroom/contract` | 插件导出时的映射引擎 | 同上，写进主组件的 `sharedPluginData` |
| `shroom-patch/design/generated/components.js` | 前端 `registry.js` | `npm run generate` |

`npm test` 会跑 `generate --check`：生成物和清单不一致就报错，防止有人手改生成文件后悄悄漂移。

## 结构

```json
{
  "schemaVersion": "1.0.0",
  "components": {
    "组件名（代码里的组件名，必须是合法 JS 标识符）": {
      "import": "@/components/Xxx/Xxx",
      "version": "1.0.0",
      "props": {
        "propName": { "label": "画布上的属性名", "type": "string", "default": "" }
      }
    }
  }
}
```

## prop 字段

| 字段 | 必填 | 说明 |
| :--- | :--- | :--- |
| `label` | 是 | MasterGo 里显示的属性名。同一组件内不能重复，否则两个 prop 会抢同一个画布属性 |
| `type` | 是 | `string` / `boolean` / `number` / `enum` / `array` / `object` |
| `default` | 是 | **代码侧**默认值，链路断开或校验不通过时用它兜底，必须与 `type` 匹配 |
| `values` | enum 必填 | `{ "画布可变值": "代码值" }`，`default` 必须是其中一个代码值 |
| `canvasDefault` | 否 | **画布侧**创建属性时的初始值，默认取 `default`。BOOLEAN 要布尔值，TEXT 要字符串或数字 |
| `canvas` | 否 | 画布属性类型，见下表 |

## type 与画布属性类型的对应

| `type` | 默认 `canvas` | 可选值 | 说明 |
| :--- | :--- | :--- | :--- |
| `boolean` | `BOOLEAN` | `BOOLEAN` / `VARIANT` | |
| `enum` | `VARIANT` | 只能 `VARIANT` | 枚举必须走可变组件，插件建不了，会提示手动配置 |
| 其他 | `TEXT` | `TEXT` / `VARIANT` | `number` 会进 `numberProps`，`array`/`object` 会进 `jsonProps`，导出时自动转换 |

`VARIANT` 属性插件**不会**自动创建 —— MasterGo 的 API 建不了可变属性。写入契约时会在日志里列出需要你在组件集里手动配的属性和可变值，契约里的映射已经预留好了。

## 加一个组件

1. 在 `components.json` 的 `components` 里加一段，props 用**代码里真实的 prop 名**作 key
2. `npm run build`（会先 generate 再打包插件）
3. MasterGo 里重新导入 `plugin/dist/manifest.json`
4. 选中该组件的主组件 → 面板里选组件名 → 「写入属性与契约」
5. 拖实例 → 绑定槽位 → 「导出并推送」

清单不合法时，`generate`、`build` 和插件面板三处都会拒绝并列出具体问题，不会写出半成品契约。
