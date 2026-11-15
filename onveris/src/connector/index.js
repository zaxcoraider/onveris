import { graph } from '@forge/teamwork-graph';
import { getRegistry } from '../services/registry.js';

// Teamwork Graph connector. When a site admin connects it, every registered contract is sent
// to the graph as a document, so it can turn up in Rovo Search and Rovo Chat. The values are
// those from Onveris's last check, so connecting reads nothing from the chain.
//
// Not yet built: sending updates when contracts are registered, removed or change. Until
// then the graph holds the registry as it was when the connection was made.

const STATUS_WORDS = { in_sync: 'in sync with its record', drift: 'differs from its record', unreachable: 'unreachable at the last check' };

function toGraphObject(contract) {
  const { observed } = contract;
  const lines = [
    `${contract.name}: smart contract on ${contract.chainName}, registered in Onveris.`,
    `Address: ${contract.address}`,
    `Type: ${contract.kind === 'proxy' ? 'upgradeable proxy' : 'plain contract'}`,
    `Status: ${STATUS_WORDS[contract.status] || contract.status}`,
    observed.implementation && `Implementation: ${observed.implementation}`,
    observed.admin && `Proxy admin: ${observed.admin}`,
    observed.beacon && `Beacon: ${observed.beacon}`,
    observed.owner && `Owner: ${observed.owner}`,
    observed.codeHash && `Code fingerprint: ${observed.codeHash}`,
    contract.lastBlock && `Last checked at block ${contract.lastBlock}.`,
  ].filter(Boolean);

  return {
    schemaVersion: '1.0',
    id: contract.id,
    updateSequenceNumber: contract.lastBlock || 1,
    displayName: `${contract.name} contract on ${contract.chainName}`,
    url: contract.explorerUrl,
    createdAt: contract.createdAt,
    lastUpdatedAt: contract.lastCheckedAt || contract.createdAt,
    // Everything here is public blockchain data, so it is visible to everyone on the site.
    permissions: [{ accessControls: [{ principals: [{ type: 'EVERYONE' }] }] }],
    'atlassian:document': {
      type: { category: 'OTHER', mimeType: 'text/plain' },
      content: { mimeType: 'text/plain', text: lines.join('\n') },
    },
  };
}

export async function onConnectionChangeHandler(request) {
  const { action, connectionId } = request;
  console.log(`[connector] connection ${action}`);

  // Atlassian removes ingested objects itself when a connection is deleted.
  if (action === 'DELETED') return { success: true };

  const { contracts } = await getRegistry();
  if (contracts.length === 0) {
    console.log('[connector] no contracts registered yet; nothing to send');
    return { success: true };
  }

  const response = await graph.setObjects({ connectionId, objects: contracts.map(toGraphObject) });
  const rejected = response.results?.rejected ?? [];
  const accepted = response.results?.accepted?.length ?? 0;
  if (!response.success || rejected.length > 0) {
    console.error('[connector] setObjects failed', JSON.stringify({ accepted, rejected, error: response.error }));
    return { success: false, message: 'Teamwork Graph did not accept the contract data.' };
  }
  console.log(`[connector] ${accepted || contracts.length} accepted, 0 rejected`);
  return { success: true };
}
