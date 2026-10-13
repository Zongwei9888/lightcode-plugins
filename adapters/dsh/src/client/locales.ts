/** Copy for LightCode's settings on the Plugins page. */
export const en = {
  summary: 'Shrinks recognized bash output before the model reads it.',
  mode: 'Mode',
  modeLabel: 'LightCode mode',
  apply: 'Apply',
  observe: 'Observe',
  off: 'Off',
  applyHint: 'The model reads a smaller, deterministic version of recognized output (test runs, builds, diffs, searches). The original stays on this machine.',
  observeHint: 'Nothing changes for the model. LightCode only records what it would have saved.',
  offHint: 'LightCode leaves every tool result alone.',
  savings: 'Type /lightcode in a session to see what it saved there.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  unavailable: 'LightCode is not running, so it cannot be configured right now.',
  readOnly: 'This deployment stores settings read-only.',
  saveFailed: 'The deployment did not accept this value.',
  save: 'Save',
  saving: 'Saving…',
}

export type Copy = typeof en

export const zh: Copy = {
  summary: '在模型读取之前精简可识别的 bash 输出。',
  mode: '模式',
  modeLabel: 'LightCode 模式',
  apply: '精简',
  observe: '只记录',
  off: '关闭',
  applyHint: '模型读到的是可识别输出（测试、构建、diff、搜索）的精简版，结果确定可复现；原文保存在本机。',
  observeHint: '模型看到的内容不变，LightCode 只记录本可以省下多少。',
  offHint: 'LightCode 不处理任何工具结果。',
  savings: '在会话里输入 /lightcode 可以查看本会话省下的 token。',
  overridden: '已覆盖',
  reset: '恢复默认',
  unavailable: 'LightCode 当前未运行，暂时无法配置。',
  readOnly: '本部署的设置为只读。',
  saveFailed: '本部署没有接受这个值。',
  save: '保存',
  saving: '保存中…',
}
