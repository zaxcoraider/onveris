import { kvs, listByPrefix } from './kv.js';

// A PlannedChange is an issue saying in advance that it will change one value of a contract.
// One per contract, issue and field.
const PREFIX = 'planned:';
export const plannedId = (contractId, issueId, field) => `${contractId}:${issueId}:${field}`;
const keyFor = (id) => `${PREFIX}${id}`;

export const listPlanned = (contractId) => listByPrefix(contractId ? `${PREFIX}${contractId}:` : PREFIX);
export const getPlanned = (id) => kvs.get(keyFor(id));
export const savePlanned = (planned) => kvs.set(keyFor(planned.id), planned);
export const deletePlanned = (id) => kvs.delete(keyFor(id));
