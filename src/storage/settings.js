import { kvs } from './kv.js';

const KEY = 'settings';

// Site-wide settings. `driftProject` is the Jira project where unrecorded changes are raised.
export const getSettings = async () => (await kvs.get(KEY)) || { driftProject: null };
export const saveSettings = (settings) => kvs.set(KEY, settings);
