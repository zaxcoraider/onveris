import api, { route } from '@forge/api';
import { RegistryError } from './registry.js';

// Who may change the registry. Anyone who can open Onveris may look, link issues and pages,
// and declare planned changes on their issues. Registering, removing, editing the record and
// reconciling a change are for Jira admins, because each of them changes what counts as true.

// Asked as the current user, so the answer is Jira's own. Anything but a clear yes is a no.
export async function isJiraAdmin() {
  const response = await api
    .asUser()
    .requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Jira answered ${response.status} reading the user's permissions`);
  const data = await response.json();
  return data?.permissions?.ADMINISTER?.havePermission === true;
}

export async function requireAdmin() {
  if (!(await isJiraAdmin())) {
    throw new RegistryError('Only Jira admins can do this. Ask a Jira admin, or ask to be made one.');
  }
}
