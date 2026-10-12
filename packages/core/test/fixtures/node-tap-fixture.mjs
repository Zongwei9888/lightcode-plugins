// Deliberately failing child-process fixture; not a test of the user's project.
import test from 'node:test'
import assert from 'node:assert/strict'
for (let i = 0; i < 8; i++) test(`passing case ${i}`, () => assert.equal(i, i))
test('intentional diagnostic fixture', () => assert.equal('actual', 'expected', 'retain this failure evidence'))
