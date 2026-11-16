import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

let answer;
mock.module('@forge/api', {
  defaultExport: { asUser: () => ({ requestJira: async () => answer }) },
  namedExports: { route: (strings, ...values) => String.raw({ raw: strings }, ...values) },
});
mock.module('../src/storage/kv.js', { namedExports: { kvs: {}, listByPrefix: async () => [] } });

const { isJiraAdmin, requireAdmin } = await import('../src/services/access.js');
const jira = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });

test('a Jira admin may change the registry', async () => {
  answer = jira({ permissions: { ADMINISTER: { havePermission: true } } });
  assert.equal(await isJiraAdmin(), true);
  await requireAdmin();
});

test('anyone else is refused with a message they can act on', async () => {
  answer = jira({ permissions: { ADMINISTER: { havePermission: false } } });
  assert.equal(await isJiraAdmin(), false);
  await assert.rejects(requireAdmin(), { name: 'RegistryError', message: /Only Jira admins/ });
});

test('an unclear answer from Jira is a no', async () => {
  for (const body of [{}, { permissions: {} }, { permissions: { ADMINISTER: { havePermission: 'true' } } }, null]) {
    answer = jira(body);
    assert.equal(await isJiraAdmin(), false);
  }
});

test('a failed permission read refuses the action instead of allowing it', async () => {
  answer = jira({}, false, 500);
  await assert.rejects(requireAdmin(), /Jira answered 500/);
});
