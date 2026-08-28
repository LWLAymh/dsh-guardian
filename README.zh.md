# dsh-guardian

[English](README.md)

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web 插件，为浏览器界面补上两个安全/可见性能力：

1. **文件修改栏** —— 当 agent 通过 `write`、`edit`、`str_replace_editor` 修改文件时，工具行显示为 `文件名 +N行 -M行 [显示 diff]`，点击按钮在行内展开实际 diff。
2. **危险命令审批** —— `bash` / `pwsh` 执行命令前，如果命令命中破坏性模式（`rm`、`Remove-Item`、`format`、`git reset --hard`、`git push --force`、`curl|sh` 等），先走 DSH 审批 seam，由 Web UI 弹出批准/拒绝提示，通过后才会执行。

## 功能

### 1. 文件修改栏

| 工具 | 行为 |
|---|---|
| `write` | 显示创建/更新后的文件、增删行数和 `显示 diff` 按钮。 |
| `edit` | 运行中先按调用参数展示意图改动；结果返回后以真实 before/after 生成的 hunk 为准。 |
| `str_replace_editor` | 保留调用期的 diff 卡片，结果返回后仍可展开（原版只在运行中展示）。 |

行数通过逐行 diff 计算。超长 hunk 的摘要行数会退化为近似值；展开后的 diff 始终是准确的。

### 2. 危险命令审批

宿主侧监听 `tools/pre-execute`，检查 `bash` / `pwsh` 的命令字符串。命中危险模式时返回 `ask` 决策并附带可读原因，DSH 工具注册表会经 `ctx.approval` 走审批 seam，**在任何内容执行之前**弹出标准 Web 审批提示。

**提前相信一切** —— 在 Web 界面的 Permissions 选择器里切到 `Full access`（`danger-full-access` 沙箱模式）即可。此模式下 `dsh-guardian` 不再拦截危险命令，与 DSH 既有的“完全访问”语义一致。

审批按 fail-closed 处理：拒绝、取消或无审批通道时，命令不会执行。

### 危险模式

| 模式 | 含义 |
|---|---|
| `rm` | 删除文件或目录 |
| `rmdir` / `rd` | 删除目录 |
| `Remove-Item` | PowerShell 文件/目录删除 |
| `del` | Windows 文件删除 |
| `format` / `mkfs` / `diskpart` / `dd of=` | 磁盘/卷破坏性操作 |
| `git clean` / `git reset --hard` / `git push --force` | 破坏性 Git 操作 |
| `shutdown` / `reboot` / `halt` / `poweroff` / `Restart-Computer` / `Stop-Computer` | 关机/重启 |
| `Clear-Content` | PowerShell 清空内容 |
| `curl\|sh` / `wget\|sh` | 远程脚本直接进 shell |

模式是简单的正则匹配，因此只是提到 `rm` 的无害命令（例如 `echo "rm -rf"`）也可能触发审批。这是刻意为之：拿不准就先问。想跳过提示就切到 `Full access`。

## 安装

安装到 web profile：

```sh
# 从本地目录安装
dsh plugin --profile web add file:./dsh-guardian

# 或从 GitHub 仓库安装
dsh plugin --profile web add git+https://github.com/<你的用户名>/dsh-guardian.git

# 或发布到 npm 后
dsh plugin --profile web add dsh-guardian
```

然后重启 web profile：

```sh
dsh --profile web
```

插件不会热加载进已经运行的 Web 进程。

卸载：

```sh
dsh plugin --profile web remove dsh-guardian
```

## 工作原理

```
dsh-guardian/
├── lib/
│   ├── index.js      # 宿主侧：tools/pre-execute 危险命令闸门
│   └── client.js     # Web 客户端：文件修改 toolview
├── cordis.patch.yml  # bundle patch，插入宿主行
├── dsh.plugin.json   # 插件元数据
├── scripts/          # 本地冒烟测试
│   ├── smoke-host.mjs
│   └── smoke-client.cjs
├── package.json
└── README.md / README.zh.md
```

- **宿主侧** —— 注册 `tools/pre-execute` 监听器。从 waterfall 返回 `{ kind: "ask", reason }` 会短路内置工具管线到 `serviceAsk`，进而调用 `ctx.approval.request(...)`。现有的 `dsh-host-apiproxy` 审批应答者会在浏览器里弹出提示。当会话沙箱模式为 `danger-full-access` 时，监听器改为调用 `next()` 放行。
- **客户端** —— 为 `write`、`edit`、`str_replace_editor` 注册 keyed `tool.call.toolview` 条目，并设置负的 shadowing priority，从而在 slot 竞争中胜过内置文件修改行。组件读取与内置 diff 卡片相同的 `callView` / `resultView` diff 载荷，渲染紧凑的 `+N / -M [显示 diff]` 栏和可折叠的 `DiffBlock`。

## 开发

冒烟测试无需运行 DSH：

```sh
node scripts/smoke-host.mjs
node scripts/smoke-client.cjs
```

修改源码后，重新安装本地包并重启 web profile：

```sh
dsh plugin --profile web add file:./dsh-guardian
dsh --profile web
```

## 发布

### GitHub

```sh
cd dsh-guardian
git init
git add .
git commit -m "dsh-guardian: file-change diff bar + dangerous-command approval"
git branch -M main
git remote add origin https://github.com/<你的用户名>/dsh-guardian.git
git push -u origin main
```

然后在 GitHub 仓库设置里添加仓库 Topic **`dsh-plugin`**，这样 DSH 的插件搜索（`find_dsh_plugin`）才能检索到它。

如果还要发布到 npm，先在 `package.json` 里补上真实的 `"repository"` 字段：

```sh
npm publish
```

### npm

发布后，用户可以这样安装：

```sh
dsh plugin --profile web add dsh-guardian
```

## 已知限制

- 危险模式是启发式正则，刻意偏向保守，可能误报。
- 超大 diff 的行数统计为近似值。
- 本插件面向 Web profile；headless/TUI 没有审批 UI 和 toolview 界面，只有宿主侧闸门有意义。
- 审批策略语义沿用 DSH：在自定义的 `workspace-write` + `never` 组合下，`ask` 决策会被自动拒绝而不是弹窗。

## 许可证

MIT
