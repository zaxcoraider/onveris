import { kvs, listByPrefix } from './kv.js';

// A Change is one tracked value of a contract differing from its record. Keys start with the
// contract id, so one contract's changes can be listed on their own.
const PREFIX = 'change:';
const keyFor = (id) => `${PREFIX}${id}`;

export const newChangeId = (contractId) =>
  `${contractId}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Newest first. Without a contract id, every change in the registry.
export const listChanges = async (contractId) =>
  (await listByPrefix(contractId ? `${PREFIX}${contractId}:` : PREFIX)).sort((a, b) =>
    b.detectedAt.localeCompare(a.detectedAt)
  );
export const getChange = (id) => kvs.get(keyFor(id));
export const saveChange = (change) => kvs.set(keyFor(change.id), change);
export const deleteChange = (id) => kvs.delete(keyFor(id));
