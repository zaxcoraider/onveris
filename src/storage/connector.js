import { kvs } from './kv.js';

// What Onveris remembers about each Teamwork Graph connection: the id of its recurring sync
// task, the contract ids last sent (so ones removed from the registry can be removed from the
// graph too), and the last sync run handled (so a repeated delivery of the same run is skipped).

const key = (connectionId) => `connector:connection:${connectionId}`;

export const getConnection = async (connectionId) => (await kvs.get(key(connectionId))) || null;
export const saveConnection = (connectionId, record) => kvs.set(key(connectionId), record);
export const forgetConnection = (connectionId) => kvs.delete(key(connectionId));
