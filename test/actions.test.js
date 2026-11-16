// Runs the registry actions (Rovo agent and MCP tools) against in-memory storage and a
// scripted chain.
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const A = '0x' + 'a'.repeat(40);
const B = '0x' + 'b'.repeat(40);
const TREASURY = '0x' + '1'.repeat(40);
const TOKEN = '0x' + '2'.repeat(40);

const store = new Map();
const kvs = {
  get: async (key) => (store.has(key) ? structuredClone(store.get(key)) : undefined),
  set: async (key, value, options) => {
    if (options?.keyPolicy === 'FAIL_IF_EXISTS' && store.has(key)) {
      throw Object.assign(new Error('exists'), { responseDetails: { status: 409 } });
    }
    store.set(key, structuredClone(value));
  },
  delete: async (key) => void store.delete(key),
};
const listByPrefix = async (prefix) =>
  [...store].filter(([key]) => key.startsWith(prefix)).map(([, value]) => structuredClone(value));

const chain = { state: {} };
mock.module('../src/storage/kv.js', { namedExports: { kvs, listByPrefix } });
mock.module('../src/services/reader.js', {
  namedExports: {
    isAddress: (value) => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value),
    keccakText: (value) => value,
    readContract: async (chainKey, address) => ({
      chain: chainKey,
      address,
      kind: 'proxy',
      hasCode: true,
      blockNumber: 500,
      readAt: new Date().toISOString(),
      ...chain.state,
    }),
  },
});
mock.module('../src/services/history.js', { namedExports: { findChangeTransaction: async () => null } });
mock.module('../src/services/issues.js', {
  namedExports: {
    createDriftIssue: async () => ({ id: '30001', key: 'SECRET-7' }),
    closeDriftIssue: async () => ({ commented: true, closed: true }),
  },
});

const registry = await import('../src/services/registry.js');
const drift = await import('../src/services/drift.js');
const { saveSettings } = await import('../src/storage/settings.js');
const actions = await import('../src/actions/index.js');

beforeEach(async () => {
  store.clear();
  chain.state = { implementation: A, admin: A, beacon: null, owner: A, codeHash: '0x01' };
  await registry.registerContract({ chain: 'ethereum', address: TREASURY, name: 'Treasury' });
  await registry.registerContract({ chain: 'base', address: TOKEN, name: 'Token' });
});

test('list-contracts returns every contract with totals', async () => {
  const result = await actions.listContractsAction({});
  assert.equal(result.ok, true);
  assert.equal(result.registry.total, 2);
  assert.deepEqual(result.contracts.map((c) => c.name), ['Token', 'Treasury']);
  assert.equal(result.contracts[1].status, 'in sync');
});

test('list-contracts narrows by chain and by status, and rejects unknown values', async () => {
  assert.deepEqual((await actions.listContractsAction({ chain: 'Base' })).contracts.map((c) => c.name), ['Token']);
  assert.equal((await actions.listContractsAction({ status: 'drift' })).contracts.length, 0);
  assert.equal((await actions.listContractsAction({ chain: 'solana' })).ok, false);
  assert.equal((await actions.listContractsAction({ status: 'broken' })).ok, false);
});

test('contract-status finds a contract by name or address', async () => {
  const byName = await actions.contractStatusAction({ contract: 'treasury' });
  assert.equal(byName.ok, true);
  assert.equal(byName.contract.address, TREASURY);
  assert.ok(byName.recordVersusChain.every((row) => row.matches));
  const byAddress = await actions.contractStatusAction({ contract: TOKEN.toUpperCase().replace('0X', '0x') });
  assert.equal(byAddress.contract.name, 'Token');
});

test('contract-status asks which one when several match, and says when none do', async () => {
  await registry.registerContract({ chain: 'base', address: TREASURY, name: 'Treasury' });
  const ambiguous = await actions.contractStatusAction({ contract: 'Treasury' });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.candidates.length, 2);
  assert.equal((await actions.contractStatusAction({ contract: 'Treasury', chain: 'base' })).contract.chain, 'Base');
  assert.equal((await actions.contractStatusAction({ contract: 'Vault' })).ok, false);
  assert.equal((await actions.contractStatusAction({})).ok, false);
});

test('contract-status shows an open change without naming its issue', async () => {
  await saveSettings({ driftProject: { id: '1', key: 'SECRET', name: 'Secret' }, issueType: { id: '2', name: 'Task' } });
  chain.state.owner = B;
  await drift.checkAndRecord(`ethereum:${TREASURY}`);
  const result = await actions.contractStatusAction({ contract: 'Treasury' });
  assert.equal(result.contract.status, 'drift');
  assert.equal(result.openChanges.length, 1);
  assert.equal(result.openChanges[0].jiraIssueRaised, true);
  assert.equal(result.linkedIssueCount, 1);
  assert.ok(!JSON.stringify(result).includes('SECRET-7'), 'issue key must not appear');
  assert.ok(!JSON.stringify(result).includes('30001'), 'issue id must not appear');
});

test('recent-changes lists changes in the window, newest first, without issue keys', async () => {
  await saveSettings({ driftProject: { id: '1', key: 'SECRET', name: 'Secret' }, issueType: { id: '2', name: 'Task' } });
  chain.state.owner = B;
  await drift.checkAndRecord(`ethereum:${TREASURY}`);
  const result = await actions.recentChangesAction({ days: 3 });
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(result.unreconciled, 1);
  assert.equal(result.changes[0].contract, 'Treasury');
  assert.equal(result.changes[0].newValue, B);
  assert.ok(!JSON.stringify(result).includes('SECRET-7'));
  assert.equal((await actions.recentChangesAction({ contract: 'Token' })).count, 0);
});

test('recent-changes ignores changes older than the window', async () => {
  chain.state.owner = B;
  await drift.checkAndRecord(`ethereum:${TREASURY}`);
  for (const [key, value] of store) {
    if (key.startsWith('change:')) store.set(key, { ...value, detectedAt: '2020-01-01T00:00:00.000Z' });
  }
  assert.equal((await actions.recentChangesAction({ days: 30 })).count, 0);
});

test('recent-changes validates days and defaults to a week', async () => {
  assert.equal((await actions.recentChangesAction({})).days, 7);
  assert.equal((await actions.recentChangesAction({ days: '2' })).days, 2);
  assert.equal((await actions.recentChangesAction({ days: 9999 })).days, 365);
  assert.equal((await actions.recentChangesAction({ days: -1 })).ok, false);
  assert.equal((await actions.recentChangesAction({ days: 'soon' })).ok, false);
});
