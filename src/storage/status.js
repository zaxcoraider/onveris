import { kvs } from './kv.js';

// Small facts for the settings page's status section. Failing to record them must never
// break the work they describe, so writers swallow and log errors.

const CHECKER_KEY = 'status:checker';
const CONNECTOR_KEY = 'status:connector';

const remember = async (key, value) => {
  try {
    await kvs.set(key, value);
  } catch (error) {
    console.warn(`[status] could not record ${key}: ${error.message}`);
  }
};

// When the five-minute checker last ran and what it did.
export const recordCheckerRun = (summary) => remember(CHECKER_KEY, { at: new Date().toISOString(), summary });
export const getCheckerRun = async () => (await kvs.get(CHECKER_KEY)) || null;

// The last Teamwork Graph connection event: CREATED, UPDATED or DELETED.
export const recordConnectorEvent = (action) => remember(CONNECTOR_KEY, { action, at: new Date().toISOString() });
export const getConnectorEvent = async () => (await kvs.get(CONNECTOR_KEY)) || null;
