# 独立配置导出目录

运行下面的命令并保持终端开启：

```bash
npm run export:bridge
```

在 MasterGo 插件中点击“导出并推送”后，这里会生成 `current.json`。它只是独立配置文件，不会自动修改任何 Shroom 工程。

验证配置：

```bash
npm run export:check
```

验证通过后，将 `current.json` 手动复制到目标 Shroom 工程，例如 `client/src/design/current.json`。

