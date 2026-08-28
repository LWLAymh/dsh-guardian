# dsh-guardian

[中文](README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web plugin that adds two safety/visibility features to the browser UI:

1. **File-change bar** — when the agent modifies a file through `write`, `edit`, or `str_replace_editor`, the tool row renders as `file +N lines -M lines [show diff]`. Clicking the button expands the real diff inline.
2. **Dangerous-command approval** — before `bash` / `pwsh` executes a command that matches a destructive pattern (`rm`, `Remove-Item`, `format`, `git reset --hard`, `git push --force`, `curl|sh`, …), the execution is routed through the DSH approval seam and the Web UI asks the user to approve or reject it.

## Features

### 1. File-change bar

| Tool | Behavior |
|---|---|
| `write` | Shows the created/updated file with added/removed line counts and a `show diff` toggle. |
| `edit` | While running, shows the intended change from the call arguments; once settled, shows the applied hunks from the real before/after result. |
| `str_replace_editor` | Shows the call-time diff card and keeps it visible after the result (the stock UI only shows it while running). |

Line counts are computed with a line-level diff over the per-hunk diff payloads. For very large hunks the summary falls back to an approximate count; the expanded diff is always the authoritative one.

### 2. Dangerous-command approval

The host half listens on `tools/pre-execute` and inspects `bash` / `pwsh` command strings. When a command matches a dangerous pattern, the plugin returns an `ask` decision with a human-readable reason. The DSH tool registry then resolves that decision through `ctx.approval`, so the standard Web approval prompt is shown **before anything executes**.

**Trust everything in advance** — switch the session to the `Full access` permission preset in the Web UI (`danger-full-access` sandbox mode). `dsh-guardian` then lets dangerous commands through without prompting, matching DSH's existing "full access" semantics.

Fail-closed: if the user rejects, cancels, or no approval channel is available, the command does not run.

### Dangerous patterns

| Pattern | Meaning |
|---|---|
| `rm` | deletes files or directories |
| `rmdir` / `rd` | removes directories |
| `Remove-Item` | PowerShell file/directory deletion |
| `del` | Windows file deletion |
| `format` / `mkfs` / `diskpart` / `dd of=` | destructive disk/volume operations |
| `git clean` / `git reset --hard` / `git push --force` | destructive Git operations |
| `shutdown` / `reboot` / `halt` / `poweroff` / `Restart-Computer` / `Stop-Computer` | shutdown/reboot |
| `Clear-Content` | PowerShell content erasure |
| `curl\|sh` / `wget\|sh` | executes a remote script through the shell |

Patterns are simple regular expressions, so harmless commands that merely mention `rm` (for example `echo "rm -rf"`) may also prompt. This is intentional: when in doubt, ask. Use the `Full access` preset to skip prompts.

## Installation

Install into your web profile:

```sh
# from a local checkout
dsh plugin --profile web add file:./dsh-guardian

# or from a GitHub repository
dsh plugin --profile web add git+https://github.com/<your-name>/dsh-guardian.git

# or, once published to npm
dsh plugin --profile web add dsh-guardian
```

Then restart the web profile:

```sh
dsh --profile web
```

The plugin does not hot-reload into an already-running Web process.

Uninstall:

```sh
dsh plugin --profile web remove dsh-guardian
```

## How it works

```
dsh-guardian/
├── lib/
│   ├── index.js      # host half: tools/pre-execute dangerous-command gate
│   └── client.js     # web client half: file-change toolview
├── cordis.patch.yml  # bundle patch inserting the host row
├── dsh.plugin.json   # plugin metadata
├── scripts/          # local smoke tests
│   ├── smoke-host.mjs
│   └── smoke-client.cjs
├── package.json
└── README.md / README.zh.md
```

- **Host half** — registers a `tools/pre-execute` listener. Returning `{ kind: "ask", reason }` from the waterfall short-circuits the built-in tool pipeline into `serviceAsk`, which calls `ctx.approval.request(...)`. The existing `dsh-host-apiproxy` approval answerer then shows the prompt in the browser. When the session's sandbox mode is `danger-full-access`, the listener delegates to `next()` instead of asking.
- **Client half** — registers a keyed `tool.call.toolview` entry for `write`, `edit`, and `str_replace_editor` with a negative shadowing priority so it wins the slot over the stock file-mutation row. The component reads the same `callView` / `resultView` diff payloads the built-in diff card consumes and renders the compact `+N / -M [show diff]` bar with a collapsible `DiffBlock`.

## Development

Smoke tests do not require a running DSH instance:

```sh
node scripts/smoke-host.mjs
node scripts/smoke-client.cjs
```

After changing source files, reinstall the local package into the profile and restart the web profile:

```sh
dsh plugin --profile web add file:./dsh-guardian
dsh --profile web
```

## Publishing

### GitHub

```sh
cd dsh-guardian
git init
git add .
git commit -m "dsh-guardian: file-change diff bar + dangerous-command approval"
git branch -M main
git remote add origin https://github.com/<your-name>/dsh-guardian.git
git push -u origin main
```

Then add the repository topic **`dsh-plugin`** in the GitHub repo settings so DSH plugin search (`find_dsh_plugin`) can discover it.

If you publish to npm, fill in the real `"repository"` field in `package.json` first:

```sh
npm publish
```

### npm

After publishing, users can install with:

```sh
dsh plugin --profile web add dsh-guardian
```

## Limitations

- Dangerous-pattern matching is regex-based and deliberately conservative; false positives are possible.
- Line counts are approximate for very large diffs.
- The plugin is Web-profile oriented; headless/TUI profiles have no approval UI or toolview surface, so only the host-side gate is relevant there.
- Approval policy semantics are inherited from DSH: in a custom `workspace-write` + `never` approval-policy combination, `ask` decisions are rejected instead of prompting.

## License

MIT
