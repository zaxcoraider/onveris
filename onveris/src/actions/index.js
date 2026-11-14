import { CHAINS, listChains } from '../services/chains.js';
import { readContract, isAddress } from '../services/reader.js';

// Handlers for Rovo agent actions and MCP tools. Inputs are written by a language model,
// so every value is validated here and nothing in them is trusted for authorization.

const supportedChains = () => listChains().map((c) => c.key).join(', ');

export async function readContractAction(payload) {
  const chain = String(payload?.chain || '').trim().toLowerCase();
  const address = String(payload?.address || '').trim();

  if (!CHAINS[chain]) {
    return { ok: false, message: `Unknown chain "${chain}". Supported chains: ${supportedChains()}.` };
  }
  if (!isAddress(address)) {
    return { ok: false, message: 'The address must be 0x followed by 40 hexadecimal characters.' };
  }
  try {
    const state = await readContract(chain, address);
    if (state.kind === 'none') {
      return { ok: true, found: false, message: `No contract is deployed at ${state.address} on ${CHAINS[chain].name}.` };
    }
    return {
      ok: true,
      found: true,
      chain: CHAINS[chain].name,
      address: state.address,
      type: state.kind === 'proxy' ? 'upgradeable proxy' : 'plain contract',
      implementation: state.implementation,
      proxyAdmin: state.admin,
      beacon: state.beacon,
      owner: state.owner,
      codeFingerprint: state.codeHash,
      readAtBlock: state.blockNumber,
      readAt: state.readAt,
      explorerUrl: `${CHAINS[chain].explorer}/address/${state.address}`,
    };
  } catch (error) {
    if (error.name === 'ChainUnreachableError') {
      console.warn(error.message);
      return { ok: false, message: `Could not reach ${CHAINS[chain].name} right now. This is a connection problem, not a change to the contract.` };
    }
    console.error(error);
    return { ok: false, message: 'Something went wrong reading this contract.' };
  }
}
