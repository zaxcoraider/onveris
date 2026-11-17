import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

let contracts = [];
let sent = [];
let answer = (objects) => ({ success: true, results: { accepted: objects.map((o) => ({ entityId: o.id })), rejected: [] } });

mock.module('@forge/teamwork-graph', {
  namedExports: {
    graph: {
      setObjects: async ({ objects }) => {
        sent.push(objects.length);
        return answer(objects);
      },
    },
  },
});
mock.module('../src/services/registry.js', { namedExports: { getRegistry: async () => ({ contracts }) } });
mock.module('../src/storage/status.js', { namedExports: { recordConnectorEvent: async () => {} } });

const { onConnectionChangeHandler, MAX_OBJECTS_PER_REQUEST } = await import('../src/connector/index.js');

const contract = (n) => ({
  id: `c${n}`,
  name: `Contract ${n}`,
  chainName: 'Ethereum',
  address: '0x' + String(n).padStart(40, '0'),
  kind: 'plain',
  status: 'in_sync',
  observed: {},
  explorerUrl: 'https://etherscan.io',
  createdAt: '2026-11-17T00:00:00Z',
});

test('a registry larger than one request is sent in batches of at most 100', async () => {
  contracts = Array.from({ length: 250 }, (_, n) => contract(n));
  sent = [];
  const result = await onConnectionChangeHandler({ action: 'CREATED', connectionId: 'x' });
  assert.deepEqual(result, { success: true });
  assert.equal(MAX_OBJECTS_PER_REQUEST, 100);
  assert.deepEqual(sent, [100, 100, 50]);
});

test('a rejected batch stops the sending and reports failure', async () => {
  contracts = Array.from({ length: 150 }, (_, n) => contract(n));
  sent = [];
  const original = answer;
  answer = () => ({ success: true, results: { accepted: [], rejected: [{ key: { entityId: 'c0' }, errors: [] }] } });
  mock.method(console, 'error', () => {});
  try {
    const result = await onConnectionChangeHandler({ action: 'CREATED', connectionId: 'x' });
    assert.equal(result.success, false);
    assert.deepEqual(sent, [100]);
  } finally {
    answer = original;
    console.error.mock.restore();
  }
});

test('an empty registry sends nothing', async () => {
  contracts = [];
  sent = [];
  assert.deepEqual(await onConnectionChangeHandler({ action: 'CREATED', connectionId: 'x' }), { success: true });
  assert.deepEqual(sent, []);
});
