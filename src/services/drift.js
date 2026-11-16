import { isAddress } from './reader.js';
import { decide } from './decide.js';
import { createDriftIssue, closeDriftIssue } from './issues.js';
import { findChangeTransaction } from './history.js';
import { TRACKED_FIELDS, RegistryError, checkContract, describeContract, findDifferences } from './registry.js';
import { getContract, saveContract, listContracts } from '../storage/contracts.js';
import { newChangeId, listChanges, getChange, saveChange } from '../storage/changes.js';
import { plannedId, listPlanned, getPlanned, savePlanned, deletePlanned } from '../storage/planned.js';
import { getSettings } from '../storage/settings.js';
import { withLock } from '../storage/locks.js';

// Turns the differences a check finds into Change records, raises a Jira issue for the ones
// nobody announced, and updates the record when a change is reconciled.

const now = () => new Date().toISOString();
const labelFor = (field) => TRACKED_FIELDS.find(({ key }) => key === field)?.label || field;

// The contract's status follows from its record and the last successful read. An unreachable
// contract stays unreachable until a read succeeds.
function refreshStatus(contract) {
  if (contract.status === 'unreachable') return;
  contract.status = findDifferences(contract.baseline, contract.observed).length > 0 ? 'drift' : 'in_sync';
}

function addIssueLink(contract, issue) {
  const links = contract.linkedIssues || [];
  if (links.some((link) => link.id === issue.id)) return;
  contract.linkedIssues = [...links, { id: issue.id, key: issue.key, linkedAt: now() }];
}

// Creates the Jira issue for an unreconciled change, if a project has been chosen. A failure
// is logged and tried again on the next check; it never stops the check itself.
async function raiseIssue(change, contract, settings) {
  if (!settings.driftProject || !settings.issueType) return false;
  try {
    change.driftIssue = await createDriftIssue(
      { project: settings.driftProject, issueType: settings.issueType },
      change,
      describeContract(contract)
    );
    change.issueFailed = false;
    addIssueLink(contract, change.driftIssue);
  } catch (error) {
    console.error(error);
    change.issueFailed = true;
  }
  return true;
}

const BUSY = 'This contract is being checked right now. Try again in a moment.';
const lockName = (contractId) => `contract:${contractId}`;

const openChangesFor = async (contractId) =>
  (await listChanges(contractId)).filter((change) => change.status === 'unreconciled');

// Brings the Change records for a contract in line with what the last read found.
// Nothing differing and nothing open is the usual case and needs no claim. Otherwise the work
// runs under a claim on the contract, so that a scheduled and a manual check arriving together
// cannot both record the same change and raise two issues. Whoever loses the claim leaves the
// work to the winner.
async function syncChanges(contract) {
  const differs = findDifferences(contract.baseline, contract.observed).length > 0;
  if (!differs && (await openChangesFor(contract.id)).length === 0) return contract;
  const result = await withLock(lockName(contract.id), async () => {
    const current = await getContract(contract.id);
    return current ? applyDifferences(current) : contract;
  });
  return result.acquired ? result.value : contract;
}

// Must run under the contract's claim, on a freshly loaded contract.
async function applyDifferences(contract) {
  const differences = findDifferences(contract.baseline, contract.observed);
  const open = await openChangesFor(contract.id);
  if (differences.length === 0 && open.length === 0) return contract;

  const planned = (await listPlanned(contract.id)).filter((plan) => plan.status === 'open');
  const settings = await getSettings();
  const plan = decide(differences, open, planned);
  let contractChanged = false;

  for (const { difference, planned: announced } of plan.create) {
    const change = {
      id: newChangeId(contract.id),
      contractId: contract.id,
      field: difference.field,
      label: difference.label,
      oldValue: difference.recorded,
      newValue: difference.onChain,
      detectedAt: now(),
      blockNumber: contract.lastBlock,
      status: 'unreconciled',
      driftIssue: null,
    };
    // Where the chain says which transaction made the change, keep it: { txHash, blockNumber, txUrl }.
    Object.assign(change, await findChangeTransaction(contract, change.field, change.newValue));
    if (announced) {
      // An issue said this would happen: record it against that issue and accept the new value.
      Object.assign(change, { status: 'planned', resolutionIssue: announced.issue, resolvedAt: change.detectedAt });
      contract.baseline[change.field] = change.newValue;
      await savePlanned({ ...announced, status: 'matched', matchedAt: change.detectedAt, changeId: change.id });
      contractChanged = true;
    } else if (await raiseIssue(change, contract, settings)) {
      contractChanged = true;
    }
    await saveChange(change);
  }

  for (const { change, newValue } of plan.update) {
    await saveChange({ ...change, newValue, updatedAt: now() });
  }

  for (const change of plan.keep) {
    if (!change.driftIssue && (await raiseIssue(change, contract, settings))) {
      await saveChange(change);
      contractChanged = true;
    }
  }

  for (const change of plan.clear) {
    const cleared = { ...change, status: 'cleared', resolvedAt: now() };
    await saveChange(cleared);
    await updateDriftIssue(cleared);
  }

  if (contractChanged) {
    refreshStatus(contract);
    await saveContract(contract);
  }
  return contract;
}

// Re-reads one contract and records any changes. An unreachable chain records nothing.
export async function checkAndRecord(id) {
  const contract = await checkContract(id);
  if (contract.status === 'unreachable') return contract;
  return syncChanges(contract);
}

// Checks every contract, least recently checked first, until the time budget runs out.
// One contract failing never stops the others.
export async function checkAllAndRecord({ budgetMs = Infinity } = {}) {
  const started = Date.now();
  const contracts = (await listContracts()).sort((a, b) =>
    (a.lastCheckedAt || '').localeCompare(b.lastCheckedAt || '')
  );
  const summary = { checked: 0, drift: 0, unreachable: 0, failed: 0, skipped: 0 };
  for (const { id } of contracts) {
    if (Date.now() - started > budgetMs) {
      summary.skipped += 1;
      continue;
    }
    try {
      const contract = await checkAndRecord(id);
      summary.checked += 1;
      if (contract.status === 'drift') summary.drift += 1;
      if (contract.status === 'unreachable') summary.unreachable += 1;
    } catch (error) {
      // Removed by someone while this run was under way: nothing to check, and not a failure.
      if (error.name === 'RegistryError' && !(await getContract(id))) continue;
      console.error(error);
      summary.failed += 1;
    }
  }
  return summary;
}

// One sentence for the drift issue's comment saying how its change was resolved. User notes
// are quoted. The issue that explains a change is not named: people who can see the drift
// issue may not be allowed to see that one.
function outcomeSentence(change) {
  if (change.status === 'acknowledged') {
    return `The change was acknowledged with this note: “${change.note}”. The record now matches the chain.`;
  }
  if (change.status === 'reconciled') {
    return 'The change was linked to the issue that explains it. The record now matches the chain.';
  }
  return 'The chain matches the record again, so this change no longer stands.';
}

// Comments on and closes the drift issue of a resolved change, and remembers that it did.
async function updateDriftIssue(change) {
  if (!change.driftIssue) return;
  const { commented, closed } = await closeDriftIssue(change.driftIssue, outcomeSentence(change));
  if (commented || closed) await saveChange({ ...change, driftIssueClosed: closed, driftIssueUpdatedAt: now() });
}

// Runs work that changes a contract's record under the contract's claim.
async function exclusively(contractId, work) {
  const result = await withLock(lockName(contractId), work);
  if (!result.acquired) throw new RegistryError(BUSY);
  return result.value;
}

async function requireChange(changeId) {
  const change = await getChange(String(changeId || ''));
  if (!change) throw new RegistryError('This change no longer exists.');
  return change;
}

// Closes a change and makes the record take the value now on the chain. `issue` is added to
// the contract's linked issues when the change is being explained by one.
async function resolve(changeId, resolution, issue) {
  const { contractId } = await requireChange(changeId);
  const resolved = await exclusively(contractId, async () => {
    const change = await requireChange(changeId);
    if (change.status !== 'unreconciled') throw new RegistryError('This change has already been reconciled.');
    const contract = await getContract(contractId);
    if (!contract) throw new RegistryError('This contract is no longer registered.');
    const current = contract.observed[change.field] ?? null;
    contract.baseline[change.field] = current;
    if (issue) addIssueLink(contract, issue);
    refreshStatus(contract);
    const closed = { ...change, ...resolution, newValue: current, resolvedAt: now() };
    await saveChange(closed);
    await saveContract(contract);
    return { contract, change: closed };
  });
  // Outside the claim: a slow Jira must not hold up the next check.
  await updateDriftIssue(resolved.change);
  return resolved.contract;
}

// "We know about this change and accept it", with a note saying why.
export async function acknowledgeChange(changeId, note) {
  const cleanNote = String(note || '').trim();
  if (!cleanNote) throw new RegistryError('Say briefly why this change is accepted.');
  if (cleanNote.length > 500) throw new RegistryError('Keep the note under 500 characters.');
  return resolve(changeId, { status: 'acknowledged', note: cleanNote });
}

// "This issue explains the change." The caller has confirmed the user can view the issue.
export async function reconcileWithIssue(changeId, issue) {
  return resolve(changeId, { status: 'reconciled', resolutionIssue: { id: issue.id, key: issue.key } }, issue);
}

function cleanValue(field, value) {
  const clean = String(value ?? '').trim().toLowerCase();
  if (!clean) return null;
  if (field === 'codeHash') {
    if (!/^0x[0-9a-f]{64}$/.test(clean)) throw new RegistryError('Enter a code fingerprint: 0x followed by 64 hexadecimal characters.');
  } else if (!isAddress(clean)) {
    throw new RegistryError('Enter an address: 0x followed by 40 hexadecimal characters, or leave it empty for none.');
  }
  return clean;
}

function requireField(field) {
  if (!TRACKED_FIELDS.some(({ key }) => key === field)) throw new RegistryError('Choose which value changes.');
}

// Changes a recorded value by hand, then checks the chain against the new record.
export async function editBaseline(id, field, value) {
  requireField(field);
  const contractId = String(id || '');
  const recorded = cleanValue(field, value);
  await exclusively(contractId, async () => {
    const contract = await getContract(contractId);
    if (!contract) throw new RegistryError('This contract is no longer registered.');
    contract.baseline[field] = recorded;
    contract.lastEdit = { field, at: now() };
    refreshStatus(contract);
    await saveContract(contract);
  });
  return checkAndRecord(contractId);
}

// An issue announces that it will change one value of a contract it is linked to.
export async function declarePlannedChange(contractId, issue, field, expectedValue) {
  requireField(field);
  const contract = await getContract(String(contractId || ''));
  if (!contract) throw new RegistryError('This contract is no longer registered.');
  if (!(contract.linkedIssues || []).some((link) => link.id === issue.id)) {
    throw new RegistryError('Link the contract to this issue first.');
  }
  const expected = cleanValue(field, expectedValue);
  if (expected && expected === (contract.baseline[field] ?? null)) {
    throw new RegistryError('That is already the recorded value. Enter the new value, or leave it empty.');
  }
  await savePlanned({
    id: plannedId(contract.id, issue.id, field),
    contractId: contract.id,
    issue: { id: issue.id, key: issue.key },
    field,
    label: labelFor(field),
    expectedValue: expected,
    status: 'open',
    declaredAt: now(),
  });
}

export async function removePlannedChange(contractId, issueId, field) {
  const id = plannedId(String(contractId || ''), issueId, field);
  if (await getPlanned(id)) await deletePlanned(id);
}

export const plannedForIssue = async (contractId, issueId) =>
  (await listPlanned(contractId)).filter((plan) => plan.issue.id === issueId);

export const changesFor = (contractId) => listChanges(contractId);
