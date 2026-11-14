import { CHAINS } from './chains.js';
import { readContract, isAddress } from './reader.js';
import { contractId, listContracts, getContract, saveContract, deleteContract } from '../storage/contracts.js';

// The parts of a contract's on-chain state that Onveris records and compares.
export const TRACKED_FIELDS = [
  { key: 'implementation', label: 'Implementation' },
  { key: 'admin', label: 'Proxy admin' },
  { key: 'beacon', label: 'Beacon' },
  { key: 'owner', label: 'Owner' },
  { key: 'codeHash', label: 'Code fingerprint' },
];

const NAME_MAX = 80;

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

// Reads the contract from the chain and records what it finds as the baseline.
export async function registerContract(input, accountId) {
  const { chain, address, name } = validateInput(input);
  const id = contractId(chain, address);
  if (await getContract(id)) throw new RegistryError('This contract is already registered.');

  const state = await readContract(chain, address);
  if (state.kind === 'none') {
    throw new RegistryError(`Nothing is deployed at this address on ${CHAINS[chain].name}. Check the address and the chain.`);
  }

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
    createdBy: accountId || null,
    createdAt: state.readAt,
  };
  await saveContract(contract);
  return contract;
}

// Re-reads one contract and updates its status. A failed read marks it unreachable and
// keeps the last known state: it is never treated as a change on the chain.
export async function checkContract(id) {
  const contract = await getContract(id);
  if (!contract) throw new RegistryError('This contract is no longer registered.');

  try {
    const state = await readContract(contract.chain, contract.address);
    const observed = pickTracked(state);
    const differences = findDifferences(contract.baseline, observed);
    Object.assign(contract, {
      observed,
      kind: state.kind,
      status: differences.length > 0 ? 'drift' : 'in_sync',
      lastCheckedAt: state.readAt,
      lastBlock: state.blockNumber,
      lastError: null,
    });
  } catch (error) {
    if (error.name !== 'ChainUnreachableError') throw error;
    console.warn(error.message);
    Object.assign(contract, { status: 'unreachable', lastError: new Date().toISOString() });
  }
  await saveContract(contract);
  return contract;
}

export async function checkAllContracts() {
  const contracts = await listContracts();
  const results = [];
  for (const contract of contracts) {
    results.push(await checkContract(contract.id));
  }
  return results;
}

export async function removeContract(id) {
  await deleteContract(id);
}

const withDetails = (contract) => ({
  ...contract,
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
