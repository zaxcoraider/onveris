import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDifferences } from '../src/services/registry.js';

const A = '0x' + 'a'.repeat(40);
const B = '0x' + 'b'.repeat(40);
const base = { implementation: A, admin: A, beacon: null, owner: A, codeHash: '0x01' };

test('identical states have no differences', () => {
  assert.deepEqual(findDifferences(base, { ...base }), []);
});

test('a changed implementation is reported with both values', () => {
  assert.deepEqual(findDifferences(base, { ...base, implementation: B }), [
    { field: 'implementation', label: 'Implementation', recorded: A, onChain: B },
  ]);
});

test('every changed field is reported', () => {
  const fields = findDifferences(base, { ...base, admin: B, owner: B, codeHash: '0x02' }).map((d) => d.field);
  assert.deepEqual(fields, ['admin', 'owner', 'codeHash']);
});

test('a missing value and null are the same thing', () => {
  const { beacon, ...withoutBeacon } = base;
  assert.deepEqual(findDifferences(base, withoutBeacon), []);
  assert.deepEqual(findDifferences(withoutBeacon, base), []);
});

test('a value that appears or disappears is a difference', () => {
  assert.equal(findDifferences(base, { ...base, owner: null })[0].onChain, null);
  assert.equal(findDifferences({ ...base, owner: null }, base)[0].recorded, null);
});
