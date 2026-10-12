# LightCode（中文说明）

LightCode 让编码 Agent 在工具输出上少花 Token，同时不向模型隐瞒证据。它以插件形式接入现有 Agent（pi、Codex、DeepSeek Harness），本身不是另一个 Agent。

> **状态：0.1 开发中。** 这一版提供 pi 和 Codex 上的 **Token Economy**，以及适用于任何 Agent 的 `lc run`。可恢复压缩（LightShadow）和委派记账计划在 0.2、0.3。尚未发布到 npm。

## Token Economy 做什么

Agent 运行 `pytest`、`cargo test`、`git diff`、`grep -rn`、`tsc`、`find`、依赖安装等约 80 类常见命令时，LightCode 把模型要读的输出替换成确定性的**投影**：通过的测试行只计数不逐条列出，进度条和重复行折叠，过大的搜索结果和 diff hunk 用预览加明确的省略计数表示。

不变的规则：

- **严格变小才使用**：投影的 UTF-8 字节数和 Token 都必须更小，否则交付原文。
- **证据保留**：失败详情、诊断、警告、未知行、汇总和退出状态都保留；无法完整识别的输出原样通过；失败的命令绝不会被概括成 "ok"。
- **确定性、首次可见即定型**：同一输入总是得到同样的字节，已交付的结果不会再被重算，前缀缓存保持有效。
- **原文保留**：pi 在自己的会话文件里保留原文；所有宿主上 LightCode 都会把原文私下存一份（`~/.lightcode`，仅本人可读，默认保留 14 天），并保存投影到原文的源映射。
- **出错即放行**：LightCode 自身出任何错，都交付原文。

## 宿主

| 宿主 | 接入方式 | Economy |
|---|---|---|
| **pi** 1.x | 进程内扩展；通过 `context_edit` 交付投影，pi 会话保留原文 | 应用 |
| **Codex** 0.162+ | 插件的 `PreToolUse` 钩子把可识别的命令改写为 `lc run -c '<命令>'`；模型历史里仍是原命令 | 应用 |
| **任何 Agent / 终端** | 直接调用 `lc run -c '<命令>'` | 应用 |
| DeepSeek Harness 0.2.x | 适配器尚未发布 | — |

`lc doctor` 会列出每个宿主支持什么以及原因（能力协商：每个机制按宿主能力以 `apply` / `observe` / `off` 运行，配置只能降级不能强开）。

## 常用命令

```
lc run -c 'cargo test'      用你的 shell 执行，输出精简结果；退出码和信号原样透传
lc report                   节省统计、各过滤器贡献、最常见的未覆盖命令
lc doctor                   配置与各宿主的能力协商结果
lc filters                  所有过滤器及其保留的内容
lc show <sha256>            查看保存的原文
lc gc [--days N]            清理过期原文
```

关闭：`LIGHTCODE_DISABLE=1` 或 `LIGHTCODE_ECONOMY=off`；只记录不改动：`LIGHTCODE_ECONOMY=observe`。配置文件为 `~/.lightcode/config.json`，格式见英文 README。

## 隐私

所有数据只在本机。保存的原文可能包含命令打印出的任何内容（包括密钥），文件仅本人可读，并按保留期删除。LightCode 不发起任何网络请求。

架构说明见 [../architecture.md](../architecture.md)（英文）。
