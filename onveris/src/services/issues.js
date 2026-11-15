import api, { route } from '@forge/api';

// Jira reads, always as the current user, so nobody is shown an issue they cannot view.

const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;
const ISSUE_ID = /^\d+$/;

export const isIssueKey = (value) => typeof value === 'string' && ISSUE_KEY.test(value);

const summarize = (issue) => ({
  id: String(issue.id),
  key: issue.key,
  summary: issue.fields?.summary || '',
  status: issue.fields?.status?.name || '',
});

// Returns the issue, or null when it does not exist or the user cannot view it.
// Jira answers both cases the same way, and so do we.
export async function findIssue(idOrKey) {
  if (!ISSUE_ID.test(idOrKey) && !ISSUE_KEY.test(idOrKey)) return null;
  const response = await api
    .asUser()
    .requestJira(route`/rest/api/3/issue/${idOrKey}?fields=summary,status`, { headers: { Accept: 'application/json' } });
  if (response.status === 404 || response.status === 403) return null;
  if (!response.ok) throw new Error(`Jira answered ${response.status} reading issue ${idOrKey}`);
  return summarize(await response.json());
}

// Looks up several issues by id. Ones the user cannot view are left out and only counted.
export async function findVisibleIssues(ids) {
  const found = await Promise.all(ids.map((id) => findIssue(String(id))));
  const issues = found.filter(Boolean);
  return { issues, hidden: ids.length - issues.length };
}

const json = { Accept: 'application/json', 'Content-Type': 'application/json' };

// Projects the current user can see, for choosing where drift issues go.
export async function listProjects() {
  const response = await api
    .asUser()
    .requestJira(route`/rest/api/3/project/search?maxResults=100&orderBy=name`, { headers: json });
  if (!response.ok) throw new Error(`Jira answered ${response.status} listing projects`);
  const data = await response.json();
  return (data.values || []).map(({ id, key, name }) => ({ id: String(id), key, name }));
}

// The issue type drift issues are created with: Task where the project has one, otherwise the
// first type that is not a sub-task. Returns null when the project has no usable type.
export async function pickIssueType(projectId) {
  const response = await api
    .asUser()
    .requestJira(route`/rest/api/3/issue/createmeta/${projectId}/issuetypes`, { headers: json });
  if (!response.ok) throw new Error(`Jira answered ${response.status} reading issue types`);
  const data = await response.json();
  const types = (data.issueTypes || data.values || []).filter((type) => !type.subtask);
  const chosen = types.find((type) => type.name === 'Task') || types[0];
  return chosen ? { id: String(chosen.id), name: chosen.name } : null;
}

const paragraph = (...content) => ({ type: 'paragraph', content });
const text = (value, marks) => ({ type: 'text', text: String(value), ...(marks ? { marks } : {}) });
const bold = (value) => text(value, [{ type: 'strong' }]);
const code = (value) => text(value, [{ type: 'code' }]);
const link = (label, href) => text(label, [{ type: 'link', attrs: { href } }]);

// Creates the Jira issue for a change nobody announced. Runs as the app, because the
// scheduled checker has no user. Returns { id, key }.
export async function createDriftIssue({ project, issueType }, change, contract) {
  const description = {
    type: 'doc',
    version: 1,
    content: [
      paragraph(
        text('Onveris found that '),
        bold(contract.name),
        text(` on ${contract.chainName} no longer matches its record, and no issue announced the change. `),
        text('If nobody planned it, treat it as an incident.')
      ),
      paragraph(bold('What changed: '), text(change.label)),
      paragraph(bold('Recorded: '), code(change.oldValue || 'None')),
      paragraph(bold('On chain now: '), code(change.newValue || 'None')),
      paragraph(
        bold('Contract: '),
        contract.explorerUrl ? link(contract.address, contract.explorerUrl) : code(contract.address)
      ),
      ...(change.txUrl ? [paragraph(bold('Transaction: '), link(change.txHash, change.txUrl))] : []),
      paragraph(
        bold('Detected: '),
        text(`${change.detectedAt}${change.blockNumber ? `, at block ${change.blockNumber}` : ''}`)
      ),
      paragraph(
        bold('What to do: '),
        text(
          'Find out who made the change and why. Then open the contract in Onveris (Apps menu) and either link ' +
            'the change to the issue that explains it or acknowledge it. The record is then updated to match the chain.'
        )
      ),
    ],
  };
  const fields = {
    project: { id: project.id },
    issuetype: { id: issueType.id },
    summary: `Unrecorded change: ${contract.name} ${change.label.toLowerCase()} changed on ${contract.chainName}`,
    description,
  };
  const create = (extra) =>
    api.asApp().requestJira(route`/rest/api/3/issue`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ fields: { ...fields, ...extra } }),
    });
  // Some projects do not allow labels when creating an issue; the label is a nicety, so go without.
  let response = await create({ labels: ['onveris-drift'] });
  if (response.status === 400) response = await create({});
  if (!response.ok) throw new Error(`Jira answered ${response.status} creating an issue: ${await response.text()}`);
  const created = await response.json();
  return { id: String(created.id), key: created.key };
}
