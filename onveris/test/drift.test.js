// Runs the real registry and drift services against in-memory storage, a scripted chain
// and a scripted Jira, so the whole flow is tested without Forge.
import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const A = '0x' + 'a'.repeat(40);
const B = '0x' + 'b'.repeat(40);
const C = '0x' + 'c'.repeat(40);
const ADDRESS = '0x' + '1'.repeat(40);
const ID = `ethereum:${ADDRESS}`;
const ISSUE = { id: '10001', key: 'OPS-1' };

const tick = () => new Promise((resolve) => setImmediate(resolve));

// --- in-memory stand-in for Forge key-value storage
const store = new Map();
const kvs = {
  async get(key) {
    await tick();
    return store.has(key) ? structuredClone(store.get(key)) : undefined;
  },
  async set(key, value, options) {
    await tick();
    if (options?.keyPolicy === 'FAIL_IF_EXISTS' && store.has(key)) {
      throw Object.assign(new Error('exists'), { code: 'KEY_ALREADY_EXISTS', responseDetails: { status: 409 } });
    }
    store.set(key, structuredClone(value));
  },
  async delete(key) {
    await tick();
    store.delete(key);
  },
};
const listByPrefix = async (prefix) => {
  await tick();
  return [...store].filter(([key]) => key.startsWith(prefix)).map(([, value]) => structuredClone(value));
};

// --- scripted chain and Jira
const chain = { state: null, unreachable: false, block: 100 };
const jira = { created: [], closed: [], fail: false, cannotClose: false, closeFails: false };
const unreachableError = () => Object.assign(new Error('Could not reach ethereum'), { name: 'ChainUnreachableError' });

mock.module('../src/storage/kv.js', { namedExports: { kvs, listByPrefix } });
mock.module('../src/services/reader.js', {
  namedExports: {
    isAddress: (value) => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value),
    keccakText: (text) => `topic:${text}`,
    readContract: async (chainKey, address) => {
      await tick();
      if (chain.unreachable) throw unreachableError();
      chain.block += 1;
      return { chain: chainKey, address, kind: 'proxy', hasCode: true, blockNumber: chain.block, readAt: new Date().toISOString(), ...chain.state };
    },
  },
});
mock.module('../src/services/history.js', { namedExports: { findChangeTransaction: async () => null } });
mock.module('../src/services/issues.js', {
  namedExports: {
    closeDriftIssue: async (issue, outcome) => {
      await tick();
      jira.closed.push({ key: issue.key, outcome });
      if (jira.closeFails) throw new Error('should never throw, but must not break reconcile');
      return { commented: true, closed: !jira.cannotClose };
    },
    createDriftIssue: async (settings, change) => {
      await tick();
      if (jira.fail) throw new Error('Jira answered 400');
      const issue = { id: String(20000 + jira.created.length), key: `SEC-${jira.created.length + 1}` };
      jira.created.push({ issue, field: change.field });
      return issue;
    },
  },
});

const registry = await import('../src/services/registry.js');
const drift = await import('../src/services/drift.js');
const { saveSettings } = await import('../src/storage/settings.js');

const chooseProject = () => saveSettings({ driftProject: { id: '1', key: 'SEC', name: 'Security' }, issueType: { id: '2', name: 'Task' } });
const contract = () => store.get(`contract:${ID}`);
const changes = () => drift.changesFor(ID);
const register = () => registry.registerContract({ chain: 'ethereum', address: ADDRESS, name: 'Treasury' }, 'user-1');

beforeEach(() => {
  store.clear();
  Object.assign(chain, { state: { implementation: A, admin: A, beacon: null, owner: A, codeHash: '0x01' }, unreachable: false, block: 100 });
  Object.assign(jira, { created: [], closed: [], fail: false, cannotClose: false, closeFails: false });
});

test('a check that finds nothing different records nothing', async () => {
  await register();
  const checked = await drift.checkAndRecord(ID);
  assert.equal(checked.status, 'in_sync');
  assert.deepEqual(await changes(), []);
  assert.equal(jira.created.length, 0);
});

test('an unannounced change is recorded, raised as an issue and linked', async () => {
  await register();
  await chooseProject();
  chain.state.implementation = B;
  const checked = await drift.checkAndRecord(ID);
  assert.equal(checked.status, 'drift');
  const [change] = await changes();
  assert.equal(change.status, 'unreconciled');
  assert.equal(change.oldValue, A);
  assert.equal(change.newValue, B);
  assert.deepEqual(change.driftIssue, { id: '20000', key: 'SEC-1' });
  assert.deepEqual(contract().linkedIssues.map((link) => link.key), ['SEC-1']);
});

test('checking again does not record or raise the same change twice', async () => {
  await register();
  await chooseProject();
  chain.state.implementation = B;
  await drift.checkAndRecord(ID);
  await drift.checkAndRecord(ID);
  await drift.checkAndRecord(ID);
  assert.equal((await changes()).length, 1);
  assert.equal(jira.created.length, 1);
});

test('two checks at the same moment record one change and raise one issue', async () => {
  await register();
  await chooseProject();
  chain.state.owner = B;
  await Promise.all([drift.checkAndRecord(ID), drift.checkAndRecord(ID), drift.checkAndRecord(ID)]);
  assert.equal((await changes()).length, 1);
  assert.equal(jira.created.length, 1);
  assert.equal([...store.keys()].filter((key) => key.startsWith('lock:')).length, 0);
});

test('an unreachable chain never records a change', async () => {
  await register();
  await chooseProject();
  chain.unreachable = true;
  const checked = await drift.checkAndRecord(ID);
  assert.equal(checked.status, 'unreachable');
  assert.deepEqual(checked.observed, checked.baseline);
  assert.deepEqual(await changes(), []);
  assert.equal(jira.created.length, 0);
});

test('with no project chosen the change is recorded, and the issue is raised once one is', async () => {
  await register();
  chain.state.admin = B;
  await drift.checkAndRecord(ID);
  assert.equal((await changes())[0].driftIssue, null);
  await chooseProject();
  await drift.checkAndRecord(ID);
  assert.equal((await changes())[0].driftIssue.key, 'SEC-1');
  assert.equal(jira.created.length, 1);
});

test('a failed issue is flagged and tried again on the next check', async () => {
  await register();
  await chooseProject();
  jira.fail = true;
  chain.state.owner = B;
  await drift.checkAndRecord(ID);
  assert.equal((await changes())[0].issueFailed, true);
  assert.equal((await changes())[0].driftIssue, null);
  jira.fail = false;
  await drift.checkAndRecord(ID);
  const [change] = await changes();
  assert.equal(change.issueFailed, false);
  assert.equal(change.driftIssue.key, 'SEC-1');
});

test('a change an issue announced is accepted without raising anything', async () => {
  await register();
  await chooseProject();
  await registry.linkIssue(ID, ISSUE, 'user-1');
  await drift.declarePlannedChange(ID, ISSUE, 'implementation', '', 'user-1');
  chain.state.implementation = B;
  const checked = await drift.checkAndRecord(ID);
  assert.equal(checked.status, 'in_sync');
  assert.equal(checked.baseline.implementation, B);
  const [change] = await changes();
  assert.equal(change.status, 'planned');
  assert.deepEqual(change.resolutionIssue, ISSUE);
  assert.equal(jira.created.length, 0);
  assert.equal((await drift.plannedForIssue(ID, ISSUE.id))[0].status, 'matched');
});

test('a planned change with an expected value does not cover a different value', async () => {
  await register();
  await chooseProject();
  await registry.linkIssue(ID, ISSUE, 'user-1');
  await drift.declarePlannedChange(ID, ISSUE, 'implementation', B, 'user-1');
  chain.state.implementation = C;
  const checked = await drift.checkAndRecord(ID);
  assert.equal(checked.status, 'drift');
  assert.equal((await changes())[0].status, 'unreconciled');
  assert.equal(jira.created.length, 1);
});

test('a planned change can only be declared from a linked issue', async () => {
  await register();
  await assert.rejects(drift.declarePlannedChange(ID, ISSUE, 'owner', '', 'user-1'), { name: 'RegistryError' });
});

test('acknowledging updates the record and cannot be done twice', async () => {
  await register();
  chain.state.owner = B;
  await drift.checkAndRecord(ID);
  const [open] = await changes();
  await assert.rejects(drift.acknowledgeChange(open.id, '  ', 'user-2'), { name: 'RegistryError' });
  const resolved = await drift.acknowledgeChange(open.id, 'Agreed in the incident call', 'user-2');
  assert.equal(resolved.status, 'in_sync');
  assert.equal(resolved.baseline.owner, B);
  const [change] = await changes();
  assert.equal(change.status, 'acknowledged');
  assert.equal(change.note, 'Agreed in the incident call');
  await assert.rejects(drift.acknowledgeChange(open.id, 'again', 'user-2'), { name: 'RegistryError' });
  assert.equal((await drift.checkAndRecord(ID)).status, 'in_sync');
  assert.equal((await changes()).length, 1);
});

test('reconciling with an issue links that issue to the contract', async () => {
  await register();
  chain.state.owner = B;
  await drift.checkAndRecord(ID);
  const [open] = await changes();
  const resolved = await drift.reconcileWithIssue(open.id, ISSUE, 'user-2');
  assert.equal(resolved.status, 'in_sync');
  assert.deepEqual(resolved.linkedIssues.map((link) => link.key), ['OPS-1']);
  assert.equal((await changes())[0].status, 'reconciled');
});

test('reconciling one of two changes leaves the contract in drift', async () => {
  await register();
  chain.state.owner = B;
  chain.state.admin = B;
  await drift.checkAndRecord(ID);
  const open = await changes();
  assert.equal(open.length, 2);
  const resolved = await drift.acknowledgeChange(open[0].id, 'known', 'user-2');
  assert.equal(resolved.status, 'drift');
});

test('editing the record creates drift, and editing it back clears the change', async () => {
  await register();
  const edited = await drift.editBaseline(ID, 'owner', C, 'user-3');
  assert.equal(edited.status, 'drift');
  assert.equal((await changes())[0].oldValue, C);
  const restored = await drift.editBaseline(ID, 'owner', A, 'user-3');
  assert.equal(restored.status, 'in_sync');
  assert.equal((await changes())[0].status, 'cleared');
});

test('editing the record rejects a value that is not an address', async () => {
  await register();
  await assert.rejects(drift.editBaseline(ID, 'owner', 'hello', 'user-3'), { name: 'RegistryError' });
  await assert.rejects(drift.editBaseline(ID, 'nonsense', A, 'user-3'), { name: 'RegistryError' });
});

test('a value on the chain that moves again updates the open change', async () => {
  await register();
  await chooseProject();
  chain.state.owner = B;
  await drift.checkAndRecord(ID);
  chain.state.owner = C;
  await drift.checkAndRecord(ID);
  const all = await changes();
  assert.equal(all.length, 1);
  assert.equal(all[0].newValue, C);
  assert.equal(jira.created.length, 1);
});

test('a check that overlaps a reconcile does not undo it', async () => {
  await register();
  chain.state.owner = B;
  await drift.checkAndRecord(ID);
  const [open] = await changes();
  await Promise.all([drift.checkAndRecord(ID), drift.acknowledgeChange(open.id, 'known', 'user-2').catch(() => {})]);
  await drift.checkAndRecord(ID);
  const all = await changes();
  assert.equal(all.length, 1, 'no second change for the same difference');
});

test('removing a contract removes its changes and planned changes', async () => {
  await register();
  await registry.linkIssue(ID, ISSUE, 'user-1');
  await drift.declarePlannedChange(ID, ISSUE, 'admin', '', 'user-1');
  chain.state.owner = B;
  await drift.checkAndRecord(ID);
  await registry.removeContract(ID);
  assert.deepEqual([...store.keys()], []);
});

test('checking everything keeps going when one contract fails', async () => {
  await register();
  store.set('contract:ethereum:broken', { id: 'ethereum:broken', name: 'Broken', chain: 'nowhere', address: 'x', baseline: {}, observed: {} });
  chain.unreachable = false;
  const summary = await drift.checkAllAndRecord();
  assert.equal(summary.checked + summary.failed, 2);
});

test('acknowledging closes the drift issue with the note in the comment', async () => {
  await register();
  await chooseProject();
  chain.state.owner = B;
  await drift.checkAndRecord(ID);
  const [open] = await changes();
  await drift.acknowledgeChange(open.id, 'Agreed in the incident call', 'user-2');
  assert.equal(jira.closed.length, 1);
  assert.equal(jira.closed[0].key, 'SEC-1');
  assert.match(jira.closed[0].outcome, /Agreed in the incident call/);
  assert.equal((await changes())[0].driftIssueClosed, true);
});

test('reconciling closes the drift issue without naming the explaining issue', async () => {
  await register();
  await chooseProject();
  chain.state.owner = B;
  await drift.checkAndRecord(ID);
  const [open] = await changes();
  await drift.reconcileWithIssue(open.id, ISSUE, 'user-2');
  assert.equal(jira.closed.length, 1);
  assert.ok(!jira.closed[0].outcome.includes(ISSUE.key));
});

test('a change that clears on its own closes its drift issue', async () => {
  await register();
  await chooseProject();
  chain.state.owner = B;
  await drift.checkAndRecord(ID);
  chain.state.owner = A;
  await drift.checkAndRecord(ID);
  assert.equal((await changes())[0].status, 'cleared');
  assert.equal(jira.closed.length, 1);
  assert.match(jira.closed[0].outcome, /matches the record again/);
});

test('a workflow that cannot close the issue is remembered, and the reconcile still stands', async () => {
  await register();
  await chooseProject();
  jira.cannotClose = true;
  chain.state.owner = B;
  await drift.checkAndRecord(ID);
  const [open] = await changes();
  const resolved = await drift.acknowledgeChange(open.id, 'known', 'user-2');
  assert.equal(resolved.status, 'in_sync');
  assert.equal((await changes())[0].driftIssueClosed, false);
});

test('a change with no drift issue does not touch Jira when resolved', async () => {
  await register();
  chain.state.owner = B;
  await drift.checkAndRecord(ID);
  const [open] = await changes();
  await drift.acknowledgeChange(open.id, 'known', 'user-2');
  assert.equal(jira.closed.length, 0);
});

test('a contract removed while checking everything is skipped quietly', async () => {
  await register();
  store.set('contract:base:gone', { id: 'base:gone', name: 'Gone', chain: 'base', address: '0x' + '2'.repeat(40), baseline: {}, observed: {} });
  const original = kvs.get;
  kvs.get = async (key) => (key === 'contract:base:gone' ? undefined : original(key));
  try {
    const summary = await drift.checkAllAndRecord();
    assert.equal(summary.failed, 0);
    assert.equal(summary.checked, 1);
  } finally {
    kvs.get = original;
  }
});
