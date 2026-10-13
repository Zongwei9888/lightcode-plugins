# LightCode for pi

[中文](#中文说明)

A [pi](https://pi.dev) package that makes the agent spend fewer tokens on
`bash` output without hiding evidence from it. When the agent runs `pytest`,
`cargo test`, `git diff`, `grep -rn`, `tsc`, `find`, a package install or one
of ~80 other recognized commands, the model reads a smaller, deterministic
**projection**: passing tests are counted instead of listed, progress bars and
repeated rows are folded, oversized search results and diff hunks are previewed
with explicit omission counts. Failures, diagnostics, warnings, unknown lines
and the exit status are always kept.

- **pi's session keeps the original.** The projection reaches the model
  through pi's `context_edit` entries; the session file and the TUI still show
  the full output.
- **Strictly smaller or nothing**: a projection is used only if it is smaller
  in bytes and saves tokens; otherwise the original passes through.
- LightCode also keeps a private copy of each projected original
  (`~/.lightcode`, user-only permissions, 14 days) with a source map.
- **Fail-open**: any LightCode error delivers the original output.
- **No network access.**

Requires pi **1.1 or newer** (tested with 1.1.0 and 1.2.0) and Node.js 22.

## Install

```sh
pi install npm:@lightcode/pi
```

Add `-l` to install it for the current project only. To try it for one run
without installing: `pi -e npm:@lightcode/pi`.

## Use

Nothing to do: from the next `bash` call on, recognized output is filtered.

- The status bar shows the tokens saved in the session (`LightCode −5.8k tok`).
- `/lightcode` shows the session's savings and what pi lets LightCode do.
- `pi --lightcode observe` (or `off`) lowers the mode for one run: `observe`
  records what would change without changing anything.
- `pi config` lists the package; switching its extension off unloads
  LightCode completely.

LightCode also normalizes a few commands before they run so their output is
recognizable and colour-free: plain `rg`/`grep` searches gain `-n -H`,
`git diff` gains `--no-color`, `pytest` gains `--color=no`. The assistant
message in pi's session keeps the command as the model wrote it, and
LightCode's journal records every rewrite.

Configuration (`~/.lightcode/config.json`, a project's
`.lightcode/config.json`, `LIGHTCODE_ECONOMY`, `LIGHTCODE_DISABLE=1`) is shared
with the other LightCode hosts; see the
[main README](https://github.com/Zongwei9888/lightcode#configuration).

## What it changes, exactly

- Only pi's `bash` tool, and only the model's own calls; calls nested inside
  another tool (such as a codemode script) are left alone.
- Output pi already truncated (over 2000 lines or 50 KB), commands that timed
  out or were aborted, and anything not recognized pass through unchanged.
- pi merges stdout and stderr and appends `Command exited with code N` on
  failure; that footer is always kept.

## Remove

```sh
pi remove npm:@lightcode/pi
```

Saved originals expire on their own; delete `~/.lightcode` to remove them at
once.

---

## 中文说明

LightCode 的 pi 扩展包：在模型读取之前精简可识别的 `bash` 输出（测试、构建、
diff、搜索、安装等约 80 类命令），失败信息、诊断、警告和退出码一律保留。投影通过
pi 的 `context_edit` 交付，**pi 自己的会话文件、TUI 和导出仍是完整原文**。精简结果
必须在字节和 token 上都严格变小才会使用；LightCode 出任何错都交付原文；不联网。

需要 pi **1.1 及以上**（已在 1.1.0 和 1.2.0 上测试）。

- 安装：`pi install npm:@lightcode/pi`（加 `-l` 只装到当前项目）
- 状态栏显示本会话省下的 token；`/lightcode` 查看明细
- `pi --lightcode observe` 本次运行只记录不改动；`pi config` 里可以关闭扩展
- 卸载：`pi remove npm:@lightcode/pi`
