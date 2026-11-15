import api, { route, getAppContext } from '@forge/api';

// Jira reads, always as the current user, so nobody is shown an issue they cannot view.

const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;
const ISSUE_ID = /^\d+$/;

export const isIssueKey = (value) => typeof value === 'string' && ISSUE_KEY.test(value);

// Pulls an issue key out of what a person typed or pasted: a key ("ops-12"), an issue link
// (".../browse/OPS-12"), or a key with text around it. Returns the key in capitals, or null.
export function extractIssueKey(input) {
  const raw = String(input ?? '').trim();
  const fromLink = raw.match(/\/browse\/([A-Za-z][A-Za-z0-9_]*-\d+)/);
  const match = fromLink ? fromLink[1] : raw.match(/\b([A-Za-z][A-Za-z0-9_]*-\d+)\b/)?.[1];
  return match ? match.toUpperCase() : null;
}

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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "15 Nov 2026, 07:27 UTC". Issues are read by people in any time zone, so always UTC.
export function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso ?? '');
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

// The address of the Onveris page on this site, or null if it cannot be worked out.
// Runs as the app, so it also works from the scheduled checker.
let pageUrl;
async function onverisPageUrl() {
  if (pageUrl !== undefined) return pageUrl;
  try {
    const { appAri, environmentAri } = getAppContext();
    const response = await api.asApp().requestJira(route`/rest/api/3/serverInfo`, { headers: json });
    const { baseUrl } = response.ok ? await response.json() : {};
    pageUrl = baseUrl ? `${baseUrl}/jira/apps/${appAri.appId}/${environmentAri.environmentId}` : null;
  } catch (error) {
    console.warn(`[issues] could not work out the Onveris page address: ${error.message}`);
    pageUrl = null;
  }
  return pageUrl;
}

const paragraph = (...content) => ({ type: 'paragraph', content });
const text = (value, marks) => ({ type: 'text', text: String(value), ...(marks ? { marks } : {}) });
const bold = (value) => text(value, [{ type: 'strong' }]);
const code = (value) => text(value, [{ type: 'code' }]);
const link = (label, href) => text(label, [{ type: 'link', attrs: { href } }]);

// Creates the Jira issue for a change nobody announced. Runs as the app, because the
// scheduled checker has no user. Returns { id, key }.
export async function createDriftIssue({ project, issueType }, change, contract) {
  const page = await onverisPageUrl();
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
        text(`${formatTime(change.detectedAt)}${change.blockNumber ? `, at block ${change.blockNumber}` : ''}`)
      ),
      paragraph(
        bold('What to do: '),
        text('Find out who made the change and why. Then open '),
        page ? link(`${contract.name} in Onveris`, page) : text(`${contract.name} in Onveris (Jira Apps menu)`),
        text(
          ' and either link the change to the issue that explains it or acknowledge it. The record is then ' +
            'updated to match the chain, and Onveris closes this issue.'
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

const RESOLUTION_PREFERENCE = ['done', 'fixed', 'resolved', 'complete', 'completed'];

// Picks a done transition and the fields it needs. A transition qualifies when every required
// field without a default is Resolution, which Onveris can fill in. Pure, so it can be tested.
export function chooseDoneTransition(transitions) {
  const candidates = (transitions || []).filter((t) => t.to?.statusCategory?.key === 'done');
  for (const transition of candidates) {
    const missing = Object.entries(transition.fields || {}).filter(([, f]) => f.required && !f.hasDefaultValue);
    if (missing.length === 0) return { id: transition.id, fields: {} };
    if (missing.length === 1 && missing[0][0] === 'resolution') {
      const options = missing[0][1].allowedValues || [];
      const named = (name) => options.find((o) => String(o.name || '').toLowerCase() === name);
      const pick = RESOLUTION_PREFERENCE.map(named).find(Boolean) || options[0];
      if (pick) return { id: transition.id, fields: { resolution: { id: String(pick.id) } } };
    }
  }
  return null;
}

// Moves an issue to a done status. Returns false when the workflow has no transition Onveris
// can take, or it is refused; the reason is logged.
async function moveToDone(issue) {
  const response = await api
    .asApp()
    .requestJira(route`/rest/api/3/issue/${issue.id}/transitions?expand=transitions.fields`, { headers: json });
  if (!response.ok) {
    console.warn(`[issues] cannot read transitions of ${issue.key}: ${response.status}`);
    return false;
  }
  const { transitions = [] } = await response.json();
  const choice = chooseDoneTransition(transitions);
  if (!choice) {
    const seen = transitions.map((t) => ({
      name: t.name,
      to: t.to?.statusCategory?.key,
      required: Object.entries(t.fields || {}).filter(([, f]) => f.required && !f.hasDefaultValue).map(([k]) => k),
    }));
    console.warn(`[issues] no done transition for ${issue.key} without extra fields: ${JSON.stringify(seen)}`);
    return false;
  }
  const moved = await api.asApp().requestJira(route`/rest/api/3/issue/${issue.id}/transitions`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ transition: { id: choice.id }, fields: choice.fields }),
  });
  if (!moved.ok) console.warn(`[issues] moving ${issue.key} to done refused: ${moved.status} ${await moved.text()}`);
  return moved.ok;
}

// Tells the drift issue how its change was resolved, and closes it where the workflow allows.
// `outcome` is one sentence. Runs as the app. Never throws: the change is already resolved in
// Onveris, and a Jira problem must not undo that. Returns { commented, closed }.
export async function closeDriftIssue(issue, outcome) {
  const result = { commented: false, closed: false };
  try {
    result.closed = await moveToDone(issue);
    const page = await onverisPageUrl();
    const content = [paragraph(bold('Resolved in Onveris. '), text(outcome))];
    if (!result.closed) {
      content.push(paragraph(text('Onveris could not move this issue to done in this workflow. Close it by hand.')));
    }
    if (page) content.push(paragraph(link('Open Onveris', page)));
    const response = await api.asApp().requestJira(route`/rest/api/3/issue/${issue.id}/comment`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ body: { type: 'doc', version: 1, content } }),
    });
    result.commented = response.ok;
    if (!response.ok) console.warn(`[issues] comment on ${issue.key} refused: ${response.status}`);
  } catch (error) {
    console.warn(`[issues] could not update ${issue.key}: ${error.message}`);
  }
  return result;
}
