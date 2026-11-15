import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchEvent, hasEventFor } from '../src/services/history.js';
import { keccakText } from '../src/services/reader.js';

const A = '0x' + 'a'.repeat(40);
const B = '0x' + 'b'.repeat(40);
const pad = (address) => '0x' + '0'.repeat(24) + address.slice(2);
const log = (signature, topics, data, block, tx) => ({
  topics: [keccakText(signature), ...topics],
  data,
  blockNumber: '0x' + block.toString(16),
  transactionHash: tx,
});
const upgraded = (to, block, tx) => log('Upgraded(address)', [pad(to)], '0x', block, tx);

test('finds the upgrade event for the new implementation', () => {
  assert.deepEqual(matchEvent([upgraded(B, 100, '0xt1')], 'implementation', B), { txHash: '0xt1', blockNumber: 100 });
});

test('ignores an upgrade to a different implementation', () => {
  assert.equal(matchEvent([upgraded(A, 100, '0xt1')], 'implementation', B), null);
});

test('takes the latest of several matching events', () => {
  const logs = [upgraded(B, 100, '0xt1'), upgraded(A, 101, '0xt2'), upgraded(B, 102, '0xt3')];
  assert.equal(matchEvent(logs, 'implementation', B).txHash, '0xt3');
});

test('reads the new owner from the second indexed address', () => {
  const logs = [log('OwnershipTransferred(address,address)', [pad(A), pad(B)], '0x', 7, '0xt')];
  assert.equal(matchEvent(logs, 'owner', B).blockNumber, 7);
  assert.equal(matchEvent(logs, 'owner', A), null);
});

test('renounced ownership is announced as the zero address', () => {
  const zero = '0x' + '0'.repeat(40);
  const logs = [log('OwnershipTransferred(address,address)', [pad(A), pad(zero)], '0x', 7, '0xt')];
  assert.equal(matchEvent(logs, 'owner', null).txHash, '0xt');
});

test('reads the new admin from the event data', () => {
  const data = '0x' + pad(A).slice(2) + pad(B).slice(2);
  assert.equal(matchEvent([log('AdminChanged(address,address)', [], data, 9, '0xt')], 'admin', B).txHash, '0xt');
});

test('an event for one field never explains another', () => {
  assert.equal(matchEvent([upgraded(B, 100, '0xt1')], 'owner', B), null);
});

test('the code fingerprint has no event', () => {
  assert.equal(hasEventFor('codeHash'), false);
  assert.equal(matchEvent([upgraded(B, 1, '0xt')], 'codeHash', B), null);
});
