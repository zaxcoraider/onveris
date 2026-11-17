import { randomUUID } from 'node:crypto';
import { graph, types } from '@forge/teamwork-graph';
import { getRegistry } from '../services/registry.js';
import { recordConnectorEvent, recordConnectorSync } from '../storage/status.js';
import { getConnection, saveConnection, forgetConnection } from '../storage/connector.js';

// Teamwork Graph connector. When a site admin connects it, every registered contract is sent
// to the graph as a document, so it can turn up in Rovo Search and Rovo Chat. After that a
// recurring task sends the registry again every SYNC_MINUTES, and removes from the graph any
// contract that is no longer registered. The values are those from Onveris's last check, so
// syncing reads nothing from the chain.

export const MAX_OBJECTS_PER_REQUEST = 100;
export const SYNC_MINUTES = 30;
const OBJECT_TYPE = 'atlassian:document';

const STATUS_WORDS = { in_sync: 'in sync with its record', drift: 'differs from its record', unreachable: 'unreachable at the last check' };

function toGraphObject(contract, sequence) {
  const { observed } = contract;
  const lines = [
    `${contract.name}: smart contract on ${contract.chainName}, registered in Onveris.`,
    `Address: ${contract.address}`,
    `Type: ${contract.kind === 'proxy' ? 'upgradeable proxy' : 'plain contract'}`,
    `Status: ${STATUS_WORDS[contract.status] || contract.status}`,
    observed.implementation && `Implementation: ${observed.implementation}`,
    observed.admin && `Proxy admin: ${observed.admin}`,
    observed.beacon && `Beacon: ${observed.beacon}`,
    observed.owner && `Owner: ${observed.owner}`,
    observed.codeHash && `Code fingerprint: ${observed.codeHash}`,
    contract.lastBlock && `Last checked at block ${contract.lastBlock}.`,
  ].filter(Boolean);

  return {
    schemaVersion: '1.0',
    id: contract.id,
    // The time of the sync, in seconds: it rises with every sync, so the latest one always wins.
    updateSequenceNumber: sequence,
    displayName: displayName(contract),
    url: contract.explorerUrl,
    createdAt: contract.createdAt,
    lastUpdatedAt: contract.lastCheckedAt || contract.createdAt,
    // Everything here is public blockchain data, so it is visible to everyone on the site.
    permissions: [{ accessControls: [{ principals: [{ type: 'EVERYONE' }] }] }],
    [OBJECT_TYPE]: {
      type: { category: 'OTHER', mimeType: 'text/plain' },
      content: { mimeType: 'text/plain', text: lines.join('\n') },
    },
  };
}

// The contract's name, with its chain added only when the name does not already say it:
// "Sample: stablecoin on Base", not "Sample: stablecoin on Base contract on Base".
export function displayName(contract) {
  const chainWord = contract.chainName.split(' ')[0].toLowerCase();
  return contract.name.toLowerCase().includes(chainWord) ? contract.name : `${contract.name} (${contract.chainName})`;
}

const inBatches = (items) => {
  const batches = [];
  for (let i = 0; i < items.length; i += MAX_OBJECTS_PER_REQUEST) batches.push(items.slice(i, i + MAX_OBJECTS_PER_REQUEST));
  return batches;
};

// Sends the whole registry and removes contracts sent before that are no longer registered.
// Returns the ids to remember as sent. After a failure that is everything that may now be in
// the graph, so a later sync still removes what it should.
export async function syncRegistry(connectionId, previousIds = []) {
  const { contracts } = await getRegistry();
  const sequence = Math.floor(Date.now() / 1000);
  const ids = contracts.map((contract) => contract.id);
  const mayBeInGraph = [...new Set([...previousIds, ...ids])];
  let sent = 0;
  const failed = (error) => ({ ok: false, error, sent, removed: 0, ids: mayBeInGraph });

  for (const batch of inBatches(contracts.map((contract) => toGraphObject(contract, sequence)))) {
    const response = await graph.setObjects({ connectionId, objects: batch });
    const rejected = response.results?.rejected ?? [];
    if (!response.success || rejected.length > 0) {
      console.error('[connector] setObjects failed', JSON.stringify({ sent, rejected, error: response.error }));
      return failed('Teamwork Graph did not accept the contract data.');
    }
    sent += response.results?.accepted?.length || batch.length;
  }

  const current = new Set(ids);
  const gone = previousIds.filter((id) => !current.has(id));
  for (const externalIds of inBatches(gone)) {
    const response = await graph.deleteObjectsByExternalId({ objectType: OBJECT_TYPE, externalIds, connectionId });
    if (!response.success) {
      console.error('[connector] deleteObjectsByExternalId failed', JSON.stringify({ error: response.error }));
      return failed('Teamwork Graph did not remove contracts that are no longer registered.');
    }
  }

  return { ok: true, sent, removed: gone.length, ids };
}

// Runs a sync, remembers what was sent, and records the outcome for the settings page.
async function syncAndRemember(connectionId, record) {
  const result = await syncRegistry(connectionId, record.sentIds || []);
  await saveConnection(connectionId, { ...record, sentIds: result.ids });
  await recordConnectorSync({ ok: result.ok, sent: result.sent, removed: result.removed });
  console.log(`[connector] sync ${result.ok ? 'done' : 'failed'}: ${result.sent} sent, ${result.removed} removed`);
  return result;
}

export async function onConnectionChangeHandler(request) {
  const { action, connectionId } = request;
  console.log(`[connector] connection ${action}`);

  // Atlassian removes ingested objects and stops the sync task itself when a connection is
  // deleted; only Onveris's own record of the connection is left to clear.
  if (action === 'DELETED') {
    await forgetConnection(connectionId);
    await recordConnectorEvent(action);
    return { success: true };
  }

  // One task id per connection, kept so that connecting again updates the schedule instead of
  // adding a second one. It is saved before the task is scheduled, because the task looks it up.
  const record = (await getConnection(connectionId)) || {};
  const taskId = record.taskId || randomUUID();
  await saveConnection(connectionId, { ...record, taskId });

  const result = await syncAndRemember(connectionId, { ...record, taskId });
  if (!result.ok) return { success: false, message: result.error };

  const scheduled = await graph.scheduleOrUpdateTask({
    connectionId,
    scheduleInterval: { value: SYNC_MINUTES, timeUnit: 'minutes' },
    task: { taskId, taskType: types.FORGE_TASK_TYPES.ENTITY_INGESTION_FULL },
  });
  // Orchestration answers carry no success flag; only an error field on failure.
  if (scheduled.error) {
    console.error('[connector] scheduleOrUpdateTask failed', JSON.stringify({ error: scheduled.error }));
    return { success: false, message: 'Teamwork Graph did not accept the sync schedule.' };
  }

  await recordConnectorEvent(action);
  return { success: true };
}

// Called by the platform every SYNC_MINUTES for each connection.
export async function taskRunnerHandler(request) {
  const { taskId, scanId, taskExecutionId, connectionId } = request;
  const report = (status, failureReason) =>
    graph.updateTaskStatus({ scanId, taskExecutionId, connectionId, status, task: { taskId }, ...(failureReason && { failureReason }) });

  try {
    const record = await getConnection(connectionId);
    // A task Onveris no longer knows, for example from a connection made before it kept records.
    if (!record || record.taskId !== taskId) {
      console.warn('[connector] task not known for this connection');
      await report('failure', 'ENTITY_NOT_FOUND');
      return { success: false, message: 'Task not found' };
    }
    // The platform can deliver the same run more than once. The task repeats for good, so it is
    // never marked finished; a run already handled is answered without syncing again.
    if (record.lastScanId === scanId) {
      await report('success');
      return { success: true, message: 'Already done (repeated delivery)' };
    }

    const result = await syncAndRemember(connectionId, record);
    if (!result.ok) {
      await report('failure', 'RETRYABLE_ERROR');
      return { success: false, message: result.error };
    }
    await saveConnection(connectionId, { ...record, sentIds: result.ids, lastScanId: scanId });
    await report('success');
    return { success: true };
  } catch (error) {
    console.error('[connector] task failed', error);
    await report('failure', 'RETRYABLE_ERROR');
    return { success: false, message: error.message };
  }
}
