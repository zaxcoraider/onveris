import { CHAINS, listChains } from '../services/chains.js';
import { readContract, isAddress } from '../services/reader.js';
import { TRACKED_FIELDS, getRegistry } from '../services/registry.js';
import { changesFor } from '../services/drift.js';

// Handlers for Rovo agent actions and MCP tools. Inputs are written by a language model,
// so every value is validated here and nothing in them is trusted for authorization.

const supportedChains = () => listChains().map((c) => c.key).join(', ');

export async function readContractAction(payload) {
  const chain = String(payload?.chain || '').trim().toLowerCase();
  const address = String(payload?.address || '').trim();

  if (!CHAINS[chain]) {
    return { ok: false, message: `Unknown chain "${chain}". Supported chains: ${supportedChains()}.` };
  }
  if (!isAddress(address)) {
    return { ok: false, message: 'The address must be 0x followed by 40 hexadecimal characters.' };
  }
  try {
    const state = await readContract(chain, address);
    if (state.kind === 'none') {
      return { ok: true, found: false, message: `No contract is deployed at ${state.address} on ${CHAINS[chain].name}.` };
    }
    return {
      ok: true,
      found: true,
      chain: CHAINS[chain].name,
      address: state.address,
      type: state.kind === 'proxy' ? 'upgradeable proxy' : 'plain contract',
      implementation: state.implementation,
      proxyAdmin: state.admin,
      beacon: state.beacon,
      owner: state.owner,
      codeFingerprint: state.codeHash,
      readAtBlock: state.blockNumber,
      readAt: state.readAt,
      explorerUrl: `${CHAINS[chain].explorer}/address/${state.address}`,
    };
  } catch (error) {
    if (error.name === 'ChainUnreachableError') {
      console.warn(error.message);
      return { ok: false, message: `Could not reach ${CHAINS[chain].name} right now. This is a connection problem, not a change to the contract.` };
    }
    console.error(error);
    return { ok: false, message: 'Something went wrong reading this contract.' };
  }
}

// --- Actions over the registry. All read-only: they report what Onveris has recorded and
// last read, with the time of that read. They never name Jira issues, because an action
// cannot check that the person asking may view them; they say an issue exists and point
// to Onveris, where issues are shown only to people who can see them.

const STATUS_WORDS = { in_sync: 'in sync', drift: 'drift', unreachable: 'unreachable' };
const STATUS_INPUTS = { 'in sync': 'in_sync', in_sync: 'in_sync', insync: 'in_sync', drift: 'drift', unreachable: 'unreachable' };
const CHANGE_WORDS = {
  unreconciled: 'unrecorded, waiting to be reconciled',
  planned: 'planned: an issue announced it in advance',
  reconciled: 'reconciled: linked to the issue that explains it',
  acknowledged: 'acknowledged with a note',
  cleared: 'matches the record again',
};
const MAX_DAYS = 365;

const text = (value) => String(value ?? '').trim();

const failure = (error) => {
  console.error(error);
  return { ok: false, message: 'Something went wrong reading the Onveris registry.' };
};

const summarizeContract = (contract) => ({
  name: contract.name,
  chain: contract.chainName,
  address: contract.address,
  type: contract.kind === 'proxy' ? 'upgradeable proxy' : 'plain contract',
  status: STATUS_WORDS[contract.status] || contract.status,
  lastCheckedAt: contract.lastCheckedAt,
  lastCheckedBlock: contract.lastBlock,
  explorerUrl: contract.explorerUrl,
});

const describeChange = (change, contract) => ({
  contract: contract ? contract.name : change.contractId,
  chain: contract ? contract.chainName : undefined,
  whatChanged: change.label,
  recordedValue: change.oldValue,
  newValue: change.newValue,
  detectedAt: change.detectedAt,
  status: CHANGE_WORDS[change.status] || change.status,
  note: change.note || undefined,
  transactionUrl: change.txUrl || undefined,
  jiraIssueRaised: Boolean(change.driftIssue),
  explainedByAnIssue: Boolean(change.resolutionIssue),
});

// Finds one registered contract from what a user typed: an address, or part of a name.
function findContract(contracts, query, chainInput) {
  const chain = text(chainInput).toLowerCase();
  const pool = chain ? contracts.filter((c) => c.chain === chain) : contracts;
  const wanted = text(query).toLowerCase();
  if (isAddress(wanted)) return { matches: pool.filter((c) => c.address === wanted) };
  const exact = pool.filter((c) => c.name.toLowerCase() === wanted);
  return { matches: exact.length > 0 ? exact : pool.filter((c) => c.name.toLowerCase().includes(wanted)) };
}

export async function listContractsAction(payload) {
  try {
    const chain = text(payload?.chain).toLowerCase();
    const statusInput = text(payload?.status).toLowerCase();
    if (chain && !CHAINS[chain]) {
      return { ok: false, message: `Unknown chain "${chain}". Supported chains: ${supportedChains()}.` };
    }
    const status = statusInput ? STATUS_INPUTS[statusInput] : null;
    if (statusInput && !status) {
      return { ok: false, message: 'Status must be one of: in sync, drift, unreachable.' };
    }
    const { contracts, summary } = await getRegistry();
    const shown = contracts.filter((c) => (!chain || c.chain === chain) && (!status || c.status === status));
    return {
      ok: true,
      registry: {
        total: summary.total,
        inSync: summary.inSync,
        drift: summary.drift,
        unreachable: summary.unreachable,
      },
      contracts: shown.map(summarizeContract),
      note:
        summary.total === 0
          ? 'No contracts are registered yet. Open Onveris from the Jira Apps menu to register one.'
          : 'Status is from the last check; Onveris checks every contract about every five minutes.',
    };
  } catch (error) {
    return failure(error);
  }
}

export async function contractStatusAction(payload) {
  try {
    const query = text(payload?.contract);
    if (!query) return { ok: false, message: 'Say which contract: its name or its address.' };
    const { contracts } = await getRegistry();
    const { matches } = findContract(contracts, query, payload?.chain);
    if (matches.length === 0) {
      return {
        ok: false,
        message: `No registered contract matches "${query}". To read a contract that is not registered, use the read-contract action.`,
      };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        message: `More than one registered contract matches "${query}". Ask which one.`,
        candidates: matches.slice(0, 10).map(({ name, chainName, address }) => ({ name, chain: chainName, address })),
      };
    }
    const contract = matches[0];
    const changes = await changesFor(contract.id);
    return {
      ok: true,
      contract: summarizeContract(contract),
      recordVersusChain: TRACKED_FIELDS.filter(({ key }) => contract.baseline[key] || contract.observed[key]).map(
        ({ key, label }) => ({
          field: label,
          recorded: contract.baseline[key] || null,
          onChain: contract.observed[key] || null,
          matches: (contract.baseline[key] ?? null) === (contract.observed[key] ?? null),
        })
      ),
      openChanges: changes.filter((c) => c.status === 'unreconciled').map((c) => describeChange(c, contract)),
      linkedIssueCount: contract.linkedIssueCount,
      note:
        contract.status === 'unreachable'
          ? `The last check could not reach ${contract.chainName}. Values are from the last successful read. This is a connection problem, not a change.`
          : 'Values are from the last check. Issues are not named here; open the contract in Onveris to see them.',
    };
  } catch (error) {
    return failure(error);
  }
}

export async function recentChangesAction(payload) {
  try {
    const rawDays = payload?.days === undefined || payload?.days === null || payload?.days === '' ? 7 : Number(payload.days);
    if (!Number.isFinite(rawDays) || rawDays <= 0) return { ok: false, message: 'Days must be a positive number.' };
    const days = Math.min(Math.ceil(rawDays), MAX_DAYS);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { contracts } = await getRegistry();
    let scope = contracts;
    const query = text(payload?.contract);
    if (query) {
      const { matches } = findContract(contracts, query, payload?.chain);
      if (matches.length === 0) return { ok: false, message: `No registered contract matches "${query}".` };
      scope = matches;
    }
    const byId = new Map(contracts.map((c) => [c.id, c]));
    const changes = (await changesFor())
      .filter((change) => change.detectedAt >= since && (!query || scope.some((c) => c.id === change.contractId)))
      .slice(0, 50);
    return {
      ok: true,
      days,
      count: changes.length,
      unreconciled: changes.filter((c) => c.status === 'unreconciled').length,
      changes: changes.map((change) => describeChange(change, byId.get(change.contractId))),
      note:
        changes.length === 0
          ? `Onveris detected no changes in the last ${days} days. It only knows about changes since each contract was registered.`
          : 'Changes are listed newest first, at most 50. Issues are not named here; open the contract in Onveris to see them.',
    };
  } catch (error) {
    return failure(error);
  }
}
