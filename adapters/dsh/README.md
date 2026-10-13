# LightCode for DeepSeek Harness

[中文](#中文说明)

A DeepSeek Harness (DSH) plugin that makes the agent spend fewer tokens on
`bash` output without hiding evidence from it. When the agent runs `pytest`,
`cargo test`, `git diff`, `grep -rn`, `tsc`, `find`, a package install or one
of ~80 other recognized commands, the model reads a smaller, deterministic
**projection**: passing tests are counted instead of listed, progress bars and
repeated rows are folded, oversized search results and diff hunks are previewed
with explicit omission counts. Failures, diagnostics, warnings, unknown lines
and the exit status are always kept.

- **Strictly smaller or nothing**: a projection is used only if it is smaller
  in bytes and saves tokens; otherwise the original passes through.
- **The original is kept** on this machine (`~/.lightcode`, user-only
  permissions, 14 days) with a source map from projection to original.
- **Fail-open**: any LightCode error delivers the original output.
- **No network access.**

Requires DeepSeek Harness **0.2.x** (tested with 0.2.0-rc.2 and
0.2.1-alpha.2 — the Web UI and CLI on macOS and Linux, and the Desktop app on
macOS, both the signed 0.2.0-rc.2 release and a 0.2.1-alpha.2 build; Windows
is not tested yet) and the Node.js versions DeepSeek Harness
itself supports (22.19+ or 24+). `dsh plugin` needs pnpm 11 or later.

## Install

**From the Web UI or Desktop app**: open **Plugins** in the sidebar, choose
**Add plugin**, enter `@lightcode/dsh` and **Install**, then **Enable now**.

**From a terminal**:

```sh
dsh plugin --profile web add @lightcode/dsh
```

Use the profile you run (`web` for `dsh web`, `headless` for
`dsh headless`, …). The Desktop app manages its own profile: install from its
**Plugins** page (it brings its own pnpm), or quit it and run its bundled
`dsh plugin --profile desktop add @lightcode/dsh`. A downloaded tarball or a checkout works the same way:
`dsh plugin --profile web add ./lightcode-dsh-0.1.0.tgz` or
`dsh plugin --profile web add /absolute/path/to/lightcode/adapters/dsh`
(after `pnpm install && pnpm build` in the checkout).

## Use

Nothing to do: recognized output is filtered from the next tool call on. In a
session, type `/lightcode` to see what it saved there.

On the plugin's page in **Plugins**, **Mode** switches between:

| Mode | Effect |
|---|---|
| **Apply** (default) | the model reads the projection |
| **Observe** | the model reads the original; LightCode records what it would have saved |
| **Off** | LightCode does nothing |

The change applies to the next tool result; no restart. The same setting can
be written in the profile's `cordis.patch.yml`:

```yaml
- id: lightcode
  config:
    mode: observe
```

LightCode's own configuration (`~/.lightcode/config.json`, a project's
`.lightcode/config.json`, `LIGHTCODE_ECONOMY`, `LIGHTCODE_DISABLE=1`) can lower
this setting further but never raise it; see the
[main README](https://github.com/Zongwei9888/lightcode-plugins#configuration).

## What it changes, exactly

- DSH's own `grep` and `glob` results, when the model called them directly and
  DSH delivered them complete: each match row loses its `Line ` prefix and
  consecutive paths are grouped under their directory; every match, line
  number and path stays. A search DSH capped or saved to a file is left alone.
- Only the model's own `bash` calls that finished in the foreground. Background
  jobs, `run_code` sub-calls, other tools, failed tool calls and results
  another plugin already rewrote are left alone.
- The projection replaces one output stream (stdout, or a Cargo report on
  stderr) inside the result text; the `[stderr]` section, `[exit code: N]` and
  every other marker stay byte-for-byte.
- Output DSH already cut to its tail (64 KB per stream by default), and runs
  that timed out, were killed or hit the sandbox, pass through unchanged.
- LightCode runs before DSH's spill policy: a large recognized output is
  projected first and the model reads the projection. If even the projection
  would be over DSH's inline budget (12,500 tokens by default), LightCode
  passes the original, so DSH's spill file keeps the complete text. If you
  raise `spill-policy`'s `maxInlineTokens`, raise `inlineLimitChars` on the
  `lightcode` entry to about four times that.
- With `tools.mode: ptc` every `bash` call is a `run_code` sub-call whose
  value goes to the program, so LightCode leaves it alone.
- Subagents started with the built-in `subagent` and `subagent_fork` tools run
  in the same process, and their `bash` output is filtered the same way.
  `/lightcode` in the parent session adds what its subagents saved.
  Out-of-process subagents (Codex, Claude Code, ACP, a separate Harness)
  run their own tools outside this plugin.
- The session log and the tool card show the text the model read. The
  original is kept in `$LIGHTCODE_HOME` (default `~/.lightcode`; when that is
  not writable, `$TMPDIR/lightcode-<uid>`); with the
  [`lc` command](https://www.npmjs.com/package/@lightcode/cli),
  `lc report --host dsh` summarizes savings and `lc show <sha256>` prints an
  original.
- Edits to LightCode's own configuration files apply to the next tool call.

## Remove

**Plugins** → LightCode → uninstall, or
`dsh plugin --profile web remove @lightcode/dsh`. Saved originals expire on
their own; delete `~/.lightcode` to remove them at once.

---

## 中文说明

LightCode 是 DeepSeek Harness（DSH）的插件，在模型读取之前精简可识别的 `bash`
输出（测试、构建、diff、搜索、安装等约 80 类命令），原文保留，失败信息、诊断、
警告和退出码一律保留。精简结果必须在字节和 token 上都严格变小才会使用，否则原样
交付；LightCode 出任何错都交付原文；不联网。

需要 DSH **0.2.x**（已在 0.2.0-rc.2 和 0.2.1-alpha.2 上测试：Web 界面和命令行覆盖 macOS 与 Linux，桌面版覆盖 macOS，包括官方签名的 0.2.0-rc.2 安装包和 0.2.1-alpha.2 源码构建；Windows 尚未测试）；`dsh plugin` 需要 pnpm 11 及以上。

**安装**：侧边栏 **插件** → **添加插件** → 输入 `@lightcode/dsh` → **安装** →
**立即启用**；或在终端执行 `dsh plugin --profile web add @lightcode/dsh`。

**使用**：装好即生效。在会话里输入 `/lightcode` 查看本会话省下的 token。DSH 自带的 `grep`、`glob` 工具的完整结果做无损排版（去掉每行的 `Line ` 前缀、同一目录的路径归到一起）。用内置 `subagent`、`subagent_fork` 工具启动的子 agent 同样生效，父会话的 `/lightcode` 会把子 agent 省下的一起算上。在
**插件** 页的 LightCode 详情里可以切换 **模式**：精简（默认）/ 只记录 / 关闭，
保存后下一次工具调用即生效，无需重启。

**卸载**：**插件** → LightCode → 卸载，或
`dsh plugin --profile web remove @lightcode/dsh`。
