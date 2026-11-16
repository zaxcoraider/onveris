import { kvs, listByPrefix } from './kv.js';

// Onveris used to save the Atlassian account id of whoever registered, linked, edited or
// reconciled something. Nothing ever showed them, and account ids are personal data, so they
// are no longer saved. This removes the ones saved by earlier versions, once per site.

const DONE_KEY = 'migration:no-account-ids';
const OWN_FIELDS = ['createdBy', 'resolvedBy', 'declaredBy', 'updatedBy'];

// Returns the record without account ids, or null when it holds none.
export function withoutAccountIds(record) {
  let changed = false;
  const clean = { ...record };
  for (const field of OWN_FIELDS) {
    if (field in clean) {
      delete clean[field];
      changed = true;
    }
  }
  for (const list of ['linkedIssues', 'linkedPages']) {
    if (Array.isArray(clean[list]) && clean[list].some((link) => 'linkedBy' in link)) {
      clean[list] = clean[list].map(({ linkedBy, ...link }) => link);
      changed = true;
    }
  }
  if (clean.lastEdit && 'by' in clean.lastEdit) {
    const { by, ...lastEdit } = clean.lastEdit;
    clean.lastEdit = lastEdit;
    changed = true;
  }
  return changed ? clean : null;
}

export async function removeStoredAccountIds() {
  if (await kvs.get(DONE_KEY)) return;
  let cleaned = 0;
  for (const prefix of ['contract:', 'change:', 'planned:']) {
    for (const record of await listByPrefix(prefix)) {
      const clean = withoutAccountIds(record);
      if (clean) {
        await kvs.set(`${prefix}${record.id}`, clean);
        cleaned += 1;
      }
    }
  }
  const settings = await kvs.get('settings');
  const cleanSettings = settings && withoutAccountIds(settings);
  if (cleanSettings) {
    await kvs.set('settings', cleanSettings);
    cleaned += 1;
  }
  await kvs.set(DONE_KEY, { at: new Date().toISOString(), cleaned });
  if (cleaned > 0) console.log(`[scrub] removed account ids from ${cleaned} stored records`);
}
