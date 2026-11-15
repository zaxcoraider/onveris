import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../src/services/decide.js';

const A = '0x' + 'a'.repeat(40);
const B = '0x' + 'b'.repeat(40);
const C = '0x' + 'c'.repeat(40);
const diff = (field, recorded, onChain) => ({ field, label: field, recorded, onChain });
const open = (field, newValue) => ({ id: `c-${field}`, field, newValue, status: 'unreconciled' });
const plan = (field, expectedValue = null) => ({ id: `p-${field}`, field, expectedValue, status: 'open' });

test('nothing differs and nothing is open: nothing to do', () => {
  assert.deepEqual(decide([], [], []), { create: [], update: [], keep: [], clear: [] });
});

test('a new difference with no plan is created as unplanned', () => {
  const result = decide([diff('implementation', A, B)], [], []);
  assert.equal(result.create.length, 1);
  assert.equal(result.create[0].planned, null);
});

test('a new difference is matched to a plan for the same field', () => {
  const result = decide([diff('implementation', A, B)], [], [plan('owner'), plan('implementation')]);
  assert.equal(result.create[0].planned.id, 'p-implementation');
});

test('a plan with an expected value only matches that value', () => {
  assert.equal(decide([diff('owner', A, B)], [], [plan('owner', C)]).create[0].planned, null);
  assert.equal(decide([diff('owner', A, B)], [], [plan('owner', B)]).create[0].planned.id, 'p-owner');
});

test('a difference that is already open is kept, not created again', () => {
  const result = decide([diff('owner', A, B)], [open('owner', B)], [plan('owner')]);
  assert.equal(result.create.length, 0);
  assert.equal(result.keep.length, 1);
});

test('an open change whose chain value moved again is updated', () => {
  const result = decide([diff('owner', A, C)], [open('owner', B)], []);
  assert.deepEqual(result.update, [{ change: open('owner', B), newValue: C }]);
});

test('an open change whose field matches the record again is cleared', () => {
  const result = decide([diff('admin', A, B)], [open('owner', B)], []);
  assert.equal(result.clear[0].field, 'owner');
  assert.equal(result.create[0].difference.field, 'admin');
});
