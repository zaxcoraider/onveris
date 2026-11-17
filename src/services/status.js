import api, { route } from '@forge/api';
import { CHAINS } from './chains.js';
import { probeEndpoint } from './rpc.js';
import { getCheckerRun, getConnectorEvent, getConnectorSync } from '../storage/status.js';

// What the settings page shows under "How Onveris is running". Every part answers on its own,
// so one slow or failing part never hides the others.

const host = (endpoint) => new URL(endpoint).host;

// Every endpoint of every chain, asked for its latest block at the same time.
async function chainStatus() {
  return Promise.all(
    Object.values(CHAINS).map(async (chain) => ({
      key: chain.key,
      name: chain.name,
      endpoints: await Promise.all(
        chain.endpoints.map(async (endpoint) => ({ host: host(endpoint), ...(await probeEndpoint(endpoint)) }))
      ),
    }))
  );
}

// Whether Onveris can read Confluence on this site, as the app. Onveris is installed in Jira
// first; until it is connected to Confluence too, Confluence refuses the request.
async function confluenceStatus() {
  try {
    const response = await api
      .asApp()
      .requestConfluence(route`/wiki/api/v2/pages?limit=1`, { headers: { Accept: 'application/json' } });
    return { connected: response.ok, httpStatus: response.status };
  } catch (error) {
    console.warn(`[status] Confluence check failed: ${error.message}`);
    return { connected: false, httpStatus: null };
  }
}

export async function getStatus() {
  const [chains, confluence, checker, connector, connectorSync] = await Promise.all([
    chainStatus(),
    confluenceStatus(),
    getCheckerRun(),
    getConnectorEvent(),
    getConnectorSync(),
  ]);
  return { chains, confluence, checker, connector, connectorSync, checkedAt: new Date().toISOString() };
}
