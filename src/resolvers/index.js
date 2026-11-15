import Resolver from '@forge/resolver';
import { NeedsAuthenticationError } from '@forge/api';
import { listChains } from '../services/chains.js';
import {
  TRACKED_FIELDS,
  RegistryError,
  getRegistry,
  previewContract,
  registerContract,
  removeContract,
  describeContract,
  linkIssue,
  unlinkIssue,
  linkedIssueIds,
  contractsForIssue,
} from '../services/registry.js';
import { findIssue, findVisibleIssues, extractIssueKey } from '../services/issues.js';
import {
  checkAndRecord,
  checkAllAndRecord,
  acknowledgeChange,
  reconcileWithIssue,
  editBaseline,
  declarePlannedChange,
  removePlannedChange,
  plannedForIssue,
  changesFor,
} from '../services/drift.js';
import { getSettings } from '../storage/settings.js';
import { loadSamples, removeSamples } from '../services/samples.js';

const resolver = new Resolver();

// Runs a handler and turns failures into a result the UI can show. Problems the user can
// fix carry their own message; anything else is logged and reported in general terms.
const safely = (handler) => async (request) => {
  try {
    return { ok: true, ...(await handler(request)) };
  } catch (error) {
    // Forge uses this error to ask the user for consent; swallowing it would hide the prompt.
    if (error instanceof NeedsAuthenticationError) throw error;
    if (error.name === 'RegistryError') return { ok: false, message: error.message };
    if (error.name === 'ChainUnreachableError') {
      console.warn(error.message);
      return { ok: false, message: "Couldn't reach the chain. Nothing was changed. Try again in a moment." };
    }
    console.error(error);
    return { ok: false, message: 'Something went wrong. Try again.' };
  }
};

// The issue the panel is shown on. It comes from Forge, not from the browser, so it can be
// trusted: the user is looking at this issue.
function panelIssue(context) {
  const issue = context?.extension?.issue;
  if (!issue?.id || !issue?.key) throw new RegistryError('Open this panel on a Jira issue.');
  return { id: String(issue.id), key: issue.key };
}

async function issuePanel(issue) {
  const { linked, others } = await contractsForIssue(issue.id);
  const withPlans = async (contract) => ({
    ...describeContract(contract),
    planned: (await plannedForIssue(contract.id, issue.id)).map(
      ({ field, label, expectedValue, status, declaredAt, matchedAt }) => ({
        field,
        label,
        expectedValue,
        status,
        declaredAt,
        matchedAt,
      })
    ),
  });
  return {
    issue,
    linked: await Promise.all(linked.map(withPlans)),
    available: others.map(describeContract).map(({ id, name, chainName, address }) => ({ id, name, chainName, address })),
  };
}

resolver.define('getSetup', () => ({ chains: listChains(), fields: TRACKED_FIELDS }));

// The registry plus whether a project has been chosen for drift issues.
async function registryView() {
  const [registry, settings] = await Promise.all([getRegistry(), getSettings()]);
  return { ...registry, raisesIssues: Boolean(settings.driftProject) };
}

async function requireVisibleIssue(issueKey) {
  const key = extractIssueKey(issueKey);
  if (!key) throw new RegistryError('Enter an issue key or paste the issue link, for example OPS-12.');
  const issue = await findIssue(key);
  if (!issue) throw new RegistryError(`Couldn't find ${key}. Check the key, and that you can view the issue.`);
  return issue;
}

// A contract's changes, split into those still open and the history. Issues are named only
// when the current user can view them.
async function contractChanges(id) {
  const changes = await changesFor(String(id || ''));
  const refs = changes.flatMap((change) => [change.driftIssue, change.resolutionIssue]).filter(Boolean);
  const { issues } = await findVisibleIssues([...new Set(refs.map((ref) => ref.id))]);
  const visible = new Map(issues.map((issue) => [issue.id, issue]));
  const show = (ref) => (ref ? visible.get(ref.id) || null : null);
  const view = ({ driftIssue, resolutionIssue, resolvedBy, ...change }) => ({
    ...change,
    driftIssue: show(driftIssue),
    resolutionIssue: show(resolutionIssue),
  });
  return {
    open: changes.filter((change) => change.status === 'unreconciled').map(view),
    history: changes.filter((change) => change.status !== 'unreconciled').map(view),
  };
}

const contractAndChanges = async (contract) => ({
  contract: describeContract(contract),
  changes: await contractChanges(contract.id),
});

resolver.define('getRegistry', safely(registryView));

resolver.define(
  'loadSamples',
  safely(async ({ context }) => ({ loaded: await loadSamples(context?.accountId), ...(await registryView()) }))
);

resolver.define('removeSamples', safely(async () => ({ ...(await removeSamples()), ...(await registryView()) })));

resolver.define('previewContract', safely(async ({ payload }) => ({ preview: await previewContract(payload || {}) })));

resolver.define(
  'registerContract',
  safely(async ({ payload, context }) => ({
    contract: describeContract(await registerContract(payload || {}, context?.accountId)),
  }))
);

resolver.define(
  'checkContract',
  safely(async ({ payload }) => contractAndChanges(await checkAndRecord(payload?.id)))
);

resolver.define(
  'checkAll',
  safely(async () => {
    await checkAllAndRecord({ budgetMs: 20000 });
    return registryView();
  })
);

resolver.define(
  'removeContract',
  safely(async ({ payload }) => {
    await removeContract(payload?.id);
    return {};
  })
);

// Issues linked to a contract, limited to the ones the current user can view.
resolver.define(
  'getContractIssues',
  safely(async ({ payload }) => findVisibleIssues(await linkedIssueIds(payload?.id)))
);

resolver.define(
  'linkIssueByKey',
  safely(async ({ payload, context }) => {
    const issue = await requireVisibleIssue(payload?.issueKey);
    await linkIssue(payload?.id, issue, context?.accountId);
    return findVisibleIssues(await linkedIssueIds(payload?.id));
  })
);

resolver.define(
  'unlinkIssue',
  safely(async ({ payload }) => {
    // Only someone who can view the issue may remove its link.
    const issue = await findIssue(String(payload?.issueId || ''));
    if (!issue) throw new RegistryError("Couldn't find that issue. You may not have permission to view it.");
    await unlinkIssue(payload?.id, issue.id);
    return findVisibleIssues(await linkedIssueIds(payload?.id));
  })
);

resolver.define('getContractChanges', safely(async ({ payload }) => ({ changes: await contractChanges(payload?.id) })));

resolver.define(
  'acknowledgeChange',
  safely(async ({ payload, context }) =>
    contractAndChanges(await acknowledgeChange(payload?.changeId, payload?.note, context?.accountId))
  )
);

resolver.define(
  'reconcileWithIssue',
  safely(async ({ payload, context }) => {
    const issue = await requireVisibleIssue(payload?.issueKey);
    return contractAndChanges(await reconcileWithIssue(payload?.changeId, issue, context?.accountId));
  })
);

resolver.define(
  'editBaseline',
  safely(async ({ payload, context }) =>
    contractAndChanges(await editBaseline(payload?.id, payload?.field, payload?.value, context?.accountId))
  )
);

resolver.define('getIssuePanel', safely(async ({ context }) => issuePanel(panelIssue(context))));

resolver.define(
  'linkContractToIssue',
  safely(async ({ payload, context }) => {
    const issue = panelIssue(context);
    await linkIssue(payload?.contractId, issue, context?.accountId);
    return issuePanel(issue);
  })
);

resolver.define(
  'unlinkContractFromIssue',
  safely(async ({ payload, context }) => {
    const issue = panelIssue(context);
    await unlinkIssue(payload?.contractId, issue.id);
    return issuePanel(issue);
  })
);

// Re-reads the chain for every contract linked to the issue the panel is on.
resolver.define(
  'checkIssueContracts',
  safely(async ({ context }) => {
    const issue = panelIssue(context);
    const { linked } = await contractsForIssue(issue.id);
    for (const contract of linked) await checkAndRecord(contract.id);
    return issuePanel(issue);
  })
);

resolver.define(
  'declarePlannedChange',
  safely(async ({ payload, context }) => {
    const issue = panelIssue(context);
    await declarePlannedChange(payload?.contractId, issue, payload?.field, payload?.expectedValue, context?.accountId);
    return issuePanel(issue);
  })
);

resolver.define(
  'removePlannedChange',
  safely(async ({ payload, context }) => {
    const issue = panelIssue(context);
    await removePlannedChange(payload?.contractId, issue.id, String(payload?.field || ''));
    return issuePanel(issue);
  })
);

export const handler = resolver.getDefinitions();
