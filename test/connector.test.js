import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let contracts = [];
let calls;
let store;
let setAnswer;
let deleteAnswer;
let scheduleAnswer;

const accepted = (objects) => ({ success: true, results: { accepted: objects.map((o) => ({ entityId: o.id })), rejected: [] } });

mock.module('@forge/teamwork-graph', {
  namedExports: {
    types: { FORGE_TASK_TYPES: { ENTITY_INGESTION_FULL: 'entity_ingestion_full' } },
    graph: {
      setObjects: async (request) => {
        calls.set.push(request);
        return setAnswer(request.objects);
      },
      deleteObjectsByExternalId: async (request) => {
        calls.delete.push(request);
        return deleteAnswer();
      },
      scheduleOrUpdateTask: async (request) => {
        calls.schedule.push(request);
        return scheduleAnswer();
      },
      updateTaskStatus: async (request) => {
        calls.status.push(request);
        return { status: 'OK' };
      },
    },
  },
});
mock.module('../src/services/registry.js', { namedExports: { getRegistry: async () => ({ contracts }) } });
mock.module('../src/storage/status.js', {
  namedExports: { recordConnectorEvent: async () => {}, recordConnectorSync: async (result) => calls.synced.push(result) },
});
mock.module('../src/storage/connector.js', {
  namedExports: {
    getConnection: async (id) => store.get(id) || null,
    saveConnection: async (id, record) => store.set(id, structuredClone(record)),
    forgetConnection: async (id) => store.delete(id),
  },
});

const { onConnectionChangeHandler, taskRunnerHandler, syncRegistry, displayName, SYNC_MINUTES } = await import('../src/connector/index.js');

const contract = (n) => ({
  id: `ethereum:0x${String(n).padStart(40, '0')}`,
  name: `Contract ${n}`,
  chainName: 'Ethereum',
  address: '0x' + String(n).padStart(40, '0'),
  kind: 'plain',
  status: 'in_sync',
  observed: {},
  explorerUrl: 'https://etherscan.io',
  createdAt: '2026-11-17T00:00:00Z',
});
const registry = (n) => Array.from({ length: n }, (_, i) => contract(i));
const tick = (record, scanId = 'scan-1') => ({ taskId: record.taskId, scanId, taskExecutionId: `exec-${scanId}`, connectionId: 'conn' });

beforeEach(() => {
  calls = { set: [], delete: [], schedule: [], status: [], synced: [] };
  store = new Map();
  setAnswer = accepted;
  deleteAnswer = () => ({ success: true });
  scheduleAnswer = () => ({ status: 'ACCEPTED', taskId: 'x' });
  mock.method(console, 'log', () => {});
  mock.method(console, 'error', () => {});
  mock.method(console, 'warn', () => {});
});

test('a registry larger than one request is sent in batches of at most 100', async () => {
  contracts = registry(250);
  const result = await syncRegistry('conn');
  assert.equal(result.ok, true);
  assert.deepEqual(
    calls.set.map((request) => request.objects.length),
    [100, 100, 50]
  );
  assert.equal(result.sent, 250);
});

test('connecting sends the registry, then schedules one recurring sync with a UUID task id', async () => {
  contracts = registry(3);
  assert.deepEqual(await onConnectionChangeHandler({ action: 'CREATED', connectionId: 'conn' }), { success: true });
  const [scheduled] = calls.schedule;
  assert.match(scheduled.task.taskId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(scheduled.task.taskType, 'entity_ingestion_full');
  assert.deepEqual(scheduled.scheduleInterval, { value: SYNC_MINUTES, timeUnit: 'minutes' });
  assert.equal(store.get('conn').taskId, scheduled.task.taskId);
  assert.equal(store.get('conn').sentIds.length, 3);
});

test('connecting again keeps the same task, so the schedule is updated and not doubled', async () => {
  contracts = registry(1);
  await onConnectionChangeHandler({ action: 'CREATED', connectionId: 'conn' });
  await onConnectionChangeHandler({ action: 'UPDATED', connectionId: 'conn' });
  assert.equal(calls.schedule.length, 2);
  assert.equal(calls.schedule[0].task.taskId, calls.schedule[1].task.taskId);
});

test('the recurring sync removes contracts that are no longer registered', async () => {
  contracts = registry(3);
  await onConnectionChangeHandler({ action: 'CREATED', connectionId: 'conn' });
  const removedId = contracts[2].id;
  contracts = contracts.slice(0, 2);

  assert.deepEqual(await taskRunnerHandler(tick(store.get('conn'))), { success: true });
  assert.deepEqual(calls.delete, [{ objectType: 'atlassian:document', externalIds: [removedId], connectionId: 'conn' }]);
  assert.equal(calls.status.at(-1).status, 'success');
  assert.deepEqual(store.get('conn').sentIds, contracts.map((c) => c.id));
});

test('every sync runs: a finished run does not stop the next one', async () => {
  contracts = registry(2);
  await onConnectionChangeHandler({ action: 'CREATED', connectionId: 'conn' });
  const record = store.get('conn');
  await taskRunnerHandler(tick(record, 'scan-1'));
  await taskRunnerHandler(tick(record, 'scan-2'));
  assert.equal(calls.set.length, 3);
});

test('a repeated delivery of the same run is answered without sending again', async () => {
  contracts = registry(2);
  await onConnectionChangeHandler({ action: 'CREATED', connectionId: 'conn' });
  const record = store.get('conn');
  await taskRunnerHandler(tick(record, 'scan-1'));
  const sends = calls.set.length;
  assert.equal((await taskRunnerHandler(tick(record, 'scan-1'))).success, true);
  assert.equal(calls.set.length, sends);
  assert.equal(calls.status.at(-1).status, 'success');
});

test('a rejected batch fails the run as retryable and still remembers what may be in the graph', async () => {
  contracts = registry(2);
  await onConnectionChangeHandler({ action: 'CREATED', connectionId: 'conn' });
  const before = store.get('conn').sentIds;
  contracts = [contract(7)];
  setAnswer = () => ({ success: true, results: { accepted: [], rejected: [{ key: { entityId: 'x' }, errors: [] }] } });

  const result = await taskRunnerHandler(tick(store.get('conn')));
  assert.equal(result.success, false);
  assert.equal(calls.status.at(-1).status, 'failure');
  assert.equal(calls.status.at(-1).failureReason, 'RETRYABLE_ERROR');
  assert.equal(calls.delete.length, 0);
  assert.deepEqual(store.get('conn').sentIds.sort(), [...before, contract(7).id].sort());
  assert.equal(store.get('conn').lastScanId, undefined);
});

test('a failed removal fails the run, so the next run tries the removal again', async () => {
  contracts = registry(2);
  await onConnectionChangeHandler({ action: 'CREATED', connectionId: 'conn' });
  contracts = contracts.slice(0, 1);
  deleteAnswer = () => ({ success: false, error: 'busy' });
  await taskRunnerHandler(tick(store.get('conn'), 'scan-1'));
  assert.equal(calls.status.at(-1).status, 'failure');
  assert.equal(store.get('conn').sentIds.length, 2);

  deleteAnswer = () => ({ success: true });
  await taskRunnerHandler(tick(store.get('conn'), 'scan-2'));
  assert.equal(calls.status.at(-1).status, 'success');
  assert.equal(store.get('conn').sentIds.length, 1);
});

test('a task Onveris does not know is reported as not found', async () => {
  const result = await taskRunnerHandler({ taskId: 'other', scanId: 's', taskExecutionId: 'e', connectionId: 'conn' });
  assert.equal(result.success, false);
  assert.equal(calls.status[0].failureReason, 'ENTITY_NOT_FOUND');
  assert.equal(calls.set.length, 0);
});

test('a schedule the platform refuses fails the connection', async () => {
  contracts = registry(1);
  scheduleAnswer = () => ({ status: 'ERROR', error: 'bad interval' });
  const result = await onConnectionChangeHandler({ action: 'CREATED', connectionId: 'conn' });
  assert.equal(result.success, false);
});

test('an empty registry sends nothing but still schedules the sync', async () => {
  contracts = [];
  assert.deepEqual(await onConnectionChangeHandler({ action: 'CREATED', connectionId: 'conn' }), { success: true });
  assert.equal(calls.set.length, 0);
  assert.equal(calls.schedule.length, 1);
});

test('disconnecting forgets the connection', async () => {
  contracts = registry(1);
  await onConnectionChangeHandler({ action: 'CREATED', connectionId: 'conn' });
  await onConnectionChangeHandler({ action: 'DELETED', connectionId: 'conn' });
  assert.equal(store.has('conn'), false);
});

test('each sync sends a higher sequence number than any block number sent before', async () => {
  contracts = [{ ...contract(1), lastBlock: 450_000_000 }];
  await syncRegistry('conn');
  assert.ok(calls.set[0].objects[0].updateSequenceNumber > 450_000_000);
});

test('the search title names the chain only when the contract name does not', () => {
  assert.equal(displayName({ name: 'Sample: stablecoin on Base', chainName: 'Base' }), 'Sample: stablecoin on Base');
  assert.equal(displayName({ name: 'Sample: stablecoin on Arbitrum', chainName: 'Arbitrum One' }), 'Sample: stablecoin on Arbitrum');
  assert.equal(displayName({ name: 'Treasury', chainName: 'Ethereum' }), 'Treasury (Ethereum)');
});
