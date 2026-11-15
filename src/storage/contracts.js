import { kvs, listByPrefix } from './kv.js';

// Registered contracts live in Forge key-value storage, one record per contract.
const PREFIX = 'contract:';
const keyFor = (id) => `${PREFIX}${id}`;

export const contractId = (chain, address) => `${chain}:${address.toLowerCase()}`;

export const listContracts = async () => (await listByPrefix(PREFIX)).sort((a, b) => a.name.localeCompare(b.name));
export const getContract = (id) => kvs.get(keyFor(id));
export const saveContract = (contract) => kvs.set(keyFor(contract.id), contract);
export const deleteContract = (id) => kvs.delete(keyFor(id));
