import { isAddress } from './reader.js';
import { decide } from './decide.js';
import { createDriftIssue } from './issues.js';
import { TRACKED_FIELDS, RegistryError, checkContract, describeContract, findDifferences } from './registry.js';
import { getContract, saveContract, listContracts } from '../storage/contracts.js';
import { newChangeId, listChanges, getChange, saveChange } from '../storage/changes.js';
import { plannedId, listPlanned, getPlanned, savePlanned, deletePlanned } from '../storage/planned.js';
import { getSettings } from '../storage/settings.js';

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

function addIssueLink(contract, issue, accountId) {
  const links = contract.linkedIssues || [];
  if (links.some((link) => link.id === issue.id)) return;
  contract.linkedIssues = [...links, { id: issue.id, key: issue.key, linkedBy: accountId || null, linkedAt: now() }];
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
    addIssueLink(contract, change.driftIssue, null);
  } catch (error) {
    console.error(error);
    change.issueFailed = true;
  }
  return true;
}

// Brings the Change records for a contract in line with what the last read found.
async function syncChanges(contract) {
  const differences = findDifferences(contract.baseline, contract.observed);
  const open = (await listChanges(contract.id)).filter((change) => change.status === 'unreconciled');
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
    await saveChange({ ...change, status: 'cleared', resolvedAt: now() });
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
      console.error(error);
      summary.failed += 1;
    }
  }
  return summary;
}

async function openChange(changeId) {
  const change = await getChange(String(changeId || ''));
  if (!change) throw new RegistryError('This change no longer exists.');
  if (change.status !== 'unreconciled') throw new RegistryError('This change has already been reconciled.');
  const contract = await getContract(change.contractId);
  if (!contract) throw new RegistryError('This contract is no longer registered.');
  return { change, contract };
}

// Closes a change and makes the record take the value now on the chain.
async function resolve({ change, contract }, resolution, accountId) {
  const current = contract.observed[change.field] ?? null;
  contract.baseline[change.field] = current;
  refreshStatus(contract);
  await saveChange({ ...change, ...resolution, newValue: current, resolvedBy: accountId || null, resolvedAt: now() });
  await saveContract(contract);
  return contract;
}

// "We know about this change and accept it", with a note saying why.
export async function acknowledgeChange(changeId, note, accountId) {
  const cleanNote = String(note || '').trim();
  if (!cleanNote) throw new RegistryError('Say briefly why this change is accepted.');
  if (cleanNote.length > 500) throw new RegistryError('Keep the note under 500 characters.');
  return resolve(await openChange(changeId), { status: 'acknowledged', note: cleanNote }, accountId);
}

// "This issue explains the change." The caller has confirmed the user can view the issue.
export async function reconcileWithIssue(changeId, issue, accountId) {
  const found = await openChange(changeId);
  addIssueLink(found.contract, issue, accountId);
  return resolve(found, { status: 'reconciled', resolutionIssue: { id: issue.id, key: issue.key } }, accountId);
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
export async function editBaseline(id, field, value, accountId) {
  requireField(field);
  const contract = await getContract(String(id || ''));
  if (!contract) throw new RegistryError('This contract is no longer registered.');
  contract.baseline[field] = cleanValue(field, value);
  contract.lastEdit = { field, by: accountId || null, at: now() };
  refreshStatus(contract);
  await saveContract(contract);
  return checkAndRecord(contract.id);
}

// An issue announces that it will change one value of a contract it is linked to.
export async function declarePlannedChange(contractId, issue, field, expectedValue, accountId) {
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
    declaredBy: accountId || null,
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
