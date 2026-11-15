import { kvs, WhereConditions } from '@forge/kvs';

// Every stored value whose key starts with the prefix.
export async function listByPrefix(prefix) {
  const values = [];
  let cursor;
  do {
    let query = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(100);
    if (cursor) query = query.cursor(cursor);
    const page = await query.getMany();
    values.push(...page.results.map((item) => item.value));
    cursor = page.nextCursor;
  } while (cursor);
  return values;
}

export { kvs };
