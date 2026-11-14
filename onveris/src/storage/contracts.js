import { kvs, WhereConditions } from '@forge/kvs';

// Registered contracts live in Forge key-value storage, one record per contract.
const PREFIX = 'contract:';
const keyFor = (id) => `${PREFIX}${id}`;

export const contractId = (chain, address) => `${chain}:${address.toLowerCase()}`;

export async function listContracts() {
  const contracts = [];
  let cursor;
  do {
    let query = kvs.query().where('key', WhereConditions.beginsWith(PREFIX)).limit(100);
    if (cursor) query = query.cursor(cursor);
    const page = await query.getMany();
    contracts.push(...page.results.map((item) => item.value));
    cursor = page.nextCursor;
  } while (cursor);
  return contracts.sort((a, b) => a.name.localeCompare(b.name));
}

export const getContract = (id) => kvs.get(keyFor(id));
export const saveContract = (contract) => kvs.set(keyFor(contract.id), contract);
export const deleteContract = (id) => kvs.delete(keyFor(id));
