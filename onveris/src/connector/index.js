import { graph } from '@forge/teamwork-graph';
import { CHAINS } from '../services/chains.js';
import { readContract } from '../services/reader.js';

// Phase 0 feasibility test: put one well-known public contract into the Teamwork Graph
// so we can see whether it becomes searchable in Rovo. The registry will replace this list.
const TEST_CONTRACTS = [
  { chain: 'ethereum', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', name: 'USDC' },
];

function toGraphObject(contract, state) {
  const chain = CHAINS[contract.chain];
  const lines = [
    `${contract.name} smart contract on ${chain.name}.`,
    `Address: ${state.address}`,
    `Type: ${state.kind === 'proxy' ? 'upgradeable proxy' : 'plain contract'}`,
    state.implementation && `Implementation: ${state.implementation}`,
    state.admin && `Proxy admin: ${state.admin}`,
    state.owner && `Owner: ${state.owner}`,
    `Code fingerprint: ${state.codeHash}`,
    `Read from the chain at block ${state.blockNumber}.`,
  ].filter(Boolean);

  return {
    schemaVersion: '1.0',
    id: `${contract.chain}:${state.address}`,
    updateSequenceNumber: state.blockNumber,
    displayName: `${contract.name} contract on ${chain.name}`,
    url: `${chain.explorer}/address/${state.address}`,
    createdAt: state.readAt,
    lastUpdatedAt: state.readAt,
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

  const objects = [];
  for (const contract of TEST_CONTRACTS) {
    try {
      const state = await readContract(contract.chain, contract.address);
      if (state.kind !== 'none') objects.push(toGraphObject(contract, state));
    } catch (error) {
      console.warn(`[connector] could not read ${contract.name}: ${error.message}`);
    }
  }
  if (objects.length === 0) {
    return { success: false, message: 'Could not read any contracts from the chain. Try connecting again.' };
  }

  const response = await graph.setObjects({ connectionId, objects });
  const rejected = response.results?.rejected ?? [];
  const accepted = response.results?.accepted?.length ?? 0;
  if (!response.success || rejected.length > 0) {
    console.error('[connector] setObjects failed', JSON.stringify({ accepted, rejected, error: response.error }));
    return { success: false, message: 'Teamwork Graph did not accept the contract data.' };
  }
  console.log(`[connector] ${accepted || objects.length} accepted, 0 rejected`);
  return { success: true };
}
