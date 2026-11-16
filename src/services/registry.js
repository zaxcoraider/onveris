import { CHAINS } from './chains.js';
import { readContract, isAddress } from './reader.js';
import { contractId, listContracts, getContract, saveContract, deleteContract } from '../storage/contracts.js';
import { listChanges, deleteChange } from '../storage/changes.js';
import { listPlanned, deletePlanned } from '../storage/planned.js';
import { withLock } from '../storage/locks.js';

// The parts of a contract's on-chain state that Onveris records and compares.
export const TRACKED_FIELDS = [
  { key: 'implementation', label: 'Implementation' },
  { key: 'admin', label: 'Proxy admin' },
  { key: 'beacon', label: 'Beacon' },
  { key: 'owner', label: 'Owner' },
  { key: 'codeHash', label: 'Code fingerprint' },
];

const NAME_MAX = 80;
const MAX_LINKED_ISSUES = 50;
const MAX_LINKED_PAGES = 50;

// A problem the user can fix. The message is safe to show as-is.
export class RegistryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RegistryError';
  }
}

const pickTracked = (state) => Object.fromEntries(TRACKED_FIELDS.map(({ key }) => [key, state[key] ?? null]));

// Fields where the chain no longer matches the record.
export const findDifferences = (baseline, observed) =>
  TRACKED_FIELDS.filter(({ key }) => (baseline[key] ?? null) !== (observed[key] ?? null)).map(({ key, label }) => ({
    field: key,
    label,
    recorded: baseline[key] ?? null,
    onChain: observed[key] ?? null,
  }));

function validateInput({ chain, address, name }) {
  if (!CHAINS[chain]) throw new RegistryError('Choose a supported chain.');
  if (!isAddress((address || '').trim())) {
    throw new RegistryError('Enter a contract address: 0x followed by 40 hexadecimal characters.');
  }
  const cleanName = (name || '').trim();
  if (!cleanName) throw new RegistryError('Give the contract a name.');
  if (cleanName.length > NAME_MAX) throw new RegistryError(`Keep the name under ${NAME_MAX} characters.`);
  return { chain, address: address.trim().toLowerCase(), name: cleanName };
}

// Reads a contract that is about to be registered. Fails with a message the user can act on
// when it is already registered or nothing is deployed at the address.
async function readForRegistration(chain, address) {
  if (await getContract(contractId(chain, address))) throw new RegistryError('This contract is already registered.');
  const state = await readContract(chain, address);
  if (state.kind === 'none') {
    throw new RegistryError(`Nothing is deployed at this address on ${CHAINS[chain].name}. Check the address and the chain.`);
  }
  return state;
}

// Reads the contract without saving anything, so the user can see what would be recorded.
export async function previewContract(input) {
  const { chain, address, name } = validateInput(input);
  const state = await readForRegistration(chain, address);
  return {
    name,
    chain,
    chainName: CHAINS[chain].name,
    address,
    kind: state.kind,
    blockNumber: state.blockNumber,
    values: pickTracked(state),
  };
}

// Reads the contract from the chain and records what it finds as the baseline.
// `extra` marks how the contract was added, for example { sample: true } from the sample loader.
export async function registerContract(input, extra = {}) {
  const { chain, address, name } = validateInput(input);
  const id = contractId(chain, address);
  const state = await readForRegistration(chain, address);

  const tracked = pickTracked(state);
  const contract = {
    id,
    name,
    chain,
    address,
    kind: state.kind,
    baseline: tracked,
    observed: tracked,
    status: 'in_sync',
    lastCheckedAt: state.readAt,
    lastBlock: state.blockNumber,
    lastError: null,
    linkedIssues: [],
    linkedPages: [],
    sample: Boolean(extra.sample),
    createdAt: state.readAt,
  };
  await saveContract(contract);
  return contract;
}

// Re-reads one contract and updates its status. A failed read marks it unreachable and
// keeps the last known state: it is never treated as a change on the chain.
// Everything that loads a contract, changes it and saves it does so under one claim per
// contract (the same one drift.js uses), so two writers never overwrite each other's work.
// The claim is held for moments, or for a few seconds while a new change is being recorded,
// so a short wait is nearly always enough. Returns { acquired, value }.
const CLAIM_ATTEMPTS = 10;
const CLAIM_WAIT_MS = 200;

async function underClaim(contractId, work) {
  for (let attempt = 1; ; attempt += 1) {
    const result = await withLock(`contract:${contractId}`, work);
    if (result.acquired || attempt >= CLAIM_ATTEMPTS) return result;
    await new Promise((resolve) => setTimeout(resolve, CLAIM_WAIT_MS));
  }
}

export async function checkContract(id) {
  const registered = await requireContract(id);

  // The chain read is the slow part and happens outside the claim.
  let state = null;
  try {
    state = await readContract(registered.chain, registered.address);
  } catch (error) {
    if (error.name !== 'ChainUnreachableError') throw error;
    console.warn(error.message);
  }

  // The record is loaded again after the read, so that a reconcile, an edit or a link made in
  // the meantime is kept, and what was read is laid over it.
  const apply = (contract) => {
    if (!state) return Object.assign(contract, { status: 'unreachable', lastError: new Date().toISOString() });
    const observed = pickTracked(state);
    return Object.assign(contract, {
      // The block of the previous successful read: a change found now happened after it.
      previousBlock: contract.lastBlock || null,
      observed,
      kind: state.kind,
      status: findDifferences(contract.baseline, observed).length > 0 ? 'drift' : 'in_sync',
      lastCheckedAt: state.readAt,
      lastBlock: state.blockNumber,
      lastError: null,
    });
  };
  const result = await underClaim(registered.id, async () => {
    const current = await getContract(registered.id);
    // Removed while the chain was being read: nothing to save.
    if (!current) return apply(registered);
    // Two checks can finish out of order. An older read never replaces a newer one.
    if (state && current.lastBlock && state.blockNumber < current.lastBlock) return current;
    const contract = apply(current);
    await saveContract(contract);
    return contract;
  });
  if (result.acquired) return result.value;
  // Someone else is recording a change on this contract right now. What was read is shown
  // but not saved; the next check saves it.
  console.warn(`[check] ${registered.id} is busy; this read was not saved`);
  return apply((await getContract(registered.id)) || registered);
}

export async function checkAllContracts() {
  const contracts = await listContracts();
  const results = [];
  for (const contract of contracts) {
    results.push(await checkContract(contract.id));
  }
  return results;
}

// Removes a contract together with its change history and planned changes.
export async function removeContract(id) {
  const contractKey = String(id || '');
  if (!contractKey) return;
  for (const change of await listChanges(contractKey)) await deleteChange(change.id);
  for (const planned of await listPlanned(contractKey)) await deletePlanned(planned.id);
  await deleteContract(contractKey);
}

async function requireContract(id) {
  const contract = await getContract(id);
  if (!contract) throw new RegistryError('This contract is no longer registered.');
  return contract;
}

// Links are saved under the contract's claim, so a link and a check saving at the same moment
// cannot overwrite each other.
async function changeLinks(id, change) {
  const contractId = String(id || '');
  const result = await underClaim(contractId, async () => {
    const contract = await requireContract(contractId);
    if ((await change(contract)) !== false) await saveContract(contract);
    return contract;
  });
  if (!result.acquired) throw new RegistryError('This contract is being checked right now. Try again in a moment.');
  return result.value;
}

// Links a contract to a Jira issue. The caller must already have confirmed that the
// current user can view the issue. Linking twice is harmless.
export async function linkIssue(id, issue) {
  return changeLinks(id, (contract) => {
    const links = contract.linkedIssues || [];
    if (links.some((link) => link.id === issue.id)) return false;
    if (links.length >= MAX_LINKED_ISSUES) {
      throw new RegistryError(`A contract can be linked to at most ${MAX_LINKED_ISSUES} issues. Unlink one first.`);
    }
    contract.linkedIssues = [...links, { id: issue.id, key: issue.key, linkedAt: new Date().toISOString() }];
    return true;
  });
}

export async function unlinkIssue(id, issueId) {
  const contract = await changeLinks(id, (target) => {
    target.linkedIssues = (target.linkedIssues || []).filter((link) => link.id !== String(issueId));
  });
  // An issue that is no longer linked no longer announces changes to this contract.
  for (const planned of await listPlanned(contract.id)) {
    if (planned.issue.id === String(issueId) && planned.status === 'open') await deletePlanned(planned.id);
  }
  return contract;
}

export const linkedIssueIds = async (id) => ((await requireContract(id)).linkedIssues || []).map((link) => link.id);

// Links a contract to the Confluence page that documents it. The caller must already have
// confirmed that the current user can view the page. Linking twice is harmless.
export async function linkPage(id, page) {
  return changeLinks(id, (contract) => {
    const links = contract.linkedPages || [];
    if (links.some((link) => link.id === page.id)) return false;
    if (links.length >= MAX_LINKED_PAGES) {
      throw new RegistryError(`A contract can be linked to at most ${MAX_LINKED_PAGES} pages. Unlink one first.`);
    }
    contract.linkedPages = [...links, { id: page.id, linkedAt: new Date().toISOString() }];
    return true;
  });
}

export async function unlinkPage(id, pageId) {
  return changeLinks(id, (contract) => {
    contract.linkedPages = (contract.linkedPages || []).filter((link) => link.id !== String(pageId));
  });
}

export const linkedPageIds = async (id) => ((await requireContract(id)).linkedPages || []).map((link) => link.id);

// Every registered contract, split by whether it is linked to the given issue.
export async function contractsForIssue(issueId) {
  const all = await listContracts();
  const isLinked = (contract) => (contract.linkedIssues || []).some((link) => link.id === String(issueId));
  return { linked: all.filter(isLinked), others: all.filter((contract) => !isLinked(contract)) };
}

// What the UI receives. Linked issues and pages are reduced to counts here: which ones they are
// is only ever sent after checking that the current user can view them.
const withDetails = ({ linkedIssues, linkedPages, ...contract }) => ({
  ...contract,
  linkedIssueCount: (linkedIssues || []).length,
  linkedPageCount: (linkedPages || []).length,
  chainName: CHAINS[contract.chain]?.name || contract.chain,
  explorerUrl: CHAINS[contract.chain] ? `${CHAINS[contract.chain].explorer}/address/${contract.address}` : null,
  differences: findDifferences(contract.baseline, contract.observed),
});

export async function getRegistry() {
  const contracts = (await listContracts()).map(withDetails);
  const count = (status) => contracts.filter((c) => c.status === status).length;
  return {
    contracts,
    summary: { total: contracts.length, inSync: count('in_sync'), drift: count('drift'), unreachable: count('unreachable') },
  };
}

export const describeContract = withDetails;
