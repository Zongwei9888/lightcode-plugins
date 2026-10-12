import assert from 'node:assert/strict'

console.log('■ assertion fixture')
for (let i = 0; i < 40; i++) {
  assert.equal(i * 2, i + i)
  console.log(`  ✓ passing assertion ${i}`)
}
try {
  assert.equal(1, 2)
} catch {
  console.log('  ✗ necessary failure detail: expected 2, got 1')
  console.error('stderr diagnostic must survive')
  console.log('测试完成：40 通过，1 失败')
  console.log('\n失败清单：\n  ✗ necessary failure detail: expected 2, got 1')
  process.exitCode = 1
}
