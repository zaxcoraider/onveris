import { keccak_256 } from '@noble/hashes/sha3.js';
import { rpcBatch } from './rpc.js';

const toHex = (bytes) => '0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const hexToBytes = (hex) => {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  return bytes;
};
export const keccakText = (text) => toHex(keccak_256(new TextEncoder().encode(text)));
const minusOne = (hex) => '0x' + (BigInt(hex) - 1n).toString(16).padStart(64, '0');

// Storage slots where proxies keep their implementation and admin addresses.
// EIP-1967 slots are keccak256(label) - 1; the older OpenZeppelin (zeppelinos) slots are keccak256(label).
const SLOTS = {
  eip1967Implementation: minusOne(keccakText('eip1967.proxy.implementation')),
  eip1967Admin: minusOne(keccakText('eip1967.proxy.admin')),
  eip1967Beacon: minusOne(keccakText('eip1967.proxy.beacon')),
  legacyImplementation: keccakText('org.zeppelinos.proxy.implementation'),
  legacyAdmin: keccakText('org.zeppelinos.proxy.admin'),
};

const OWNER_SELECTOR = '0x8da5cb5b'; // owner()
const ZERO_WORD = '0x' + '0'.repeat(64);

export const isAddress = (value) => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);

// Reads a 32-byte word as an address. Returns null for an empty word or one that is not address-shaped.
function wordToAddress(word) {
  if (typeof word !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(word)) return null;
  if (word === ZERO_WORD) return null;
  if (!/^0x0{24}/.test(word)) return null;
  return '0x' + word.slice(26).toLowerCase();
}

// What an endpoint's error to the owner() call says about the contract:
//   'execution'  the call ran and failed, so the contract has no usable owner(): a normal outcome
//   'transient'  the endpoint could not serve the call just now: a failed read
//   'unclear'    neither is certain
// Getting this wrong in one direction leaves a contract unreachable for good; in the other it
// reports the owner as gone when only the endpoint stumbled. Hence the middle answer.
const EXECUTION_ERROR = /revert|invalid opcode|invalid jump|bad jump|bad instruction|invalid instruction|opcode|out of gas|stack (under|over)flow|vm exception|evm error|execution/i;
const TRANSIENT_ERROR = /rate|limit|too many|quota|exceeded|capacity|busy|overload|unavailable|try again|time[d ]*out|timeout|missing trie|header not found|unknown block|not found|internal|unauthori[sz]ed|forbidden|denied/i;

export function classifyCallError(error) {
  const message = String(error?.message || '');
  if (error?.code === 3 || EXECUTION_ERROR.test(message)) return 'execution';
  if (TRANSIENT_ERROR.test(message)) return 'transient';
  return 'unclear';
}

// Reads the current state of a contract. Throws ChainUnreachableError if the chain cannot be read.
export async function readContract(chainKey, address) {
  if (!isAddress(address)) throw new Error('Not a valid contract address');
  const target = address.toLowerCase();

  const baseCalls = [
    { method: 'eth_blockNumber', params: [] },
    { method: 'eth_getCode', params: [target, 'latest'] },
    { method: 'eth_getStorageAt', params: [target, SLOTS.eip1967Implementation, 'latest'] },
    { method: 'eth_getStorageAt', params: [target, SLOTS.eip1967Admin, 'latest'] },
    { method: 'eth_getStorageAt', params: [target, SLOTS.eip1967Beacon, 'latest'] },
    { method: 'eth_getStorageAt', params: [target, SLOTS.legacyImplementation, 'latest'] },
    { method: 'eth_getStorageAt', params: [target, SLOTS.legacyAdmin, 'latest'] },
  ];
  // owner() is optional and is asked in the same batch, so the endpoint's other answers show
  // it is working. An execution failure means the contract has no owner function, which is a
  // normal outcome. A transient error fails the endpoint and the next one is tried.
  const OWNER_CALL = baseCalls.length;
  const calls = [...baseCalls, { method: 'eth_call', params: [{ to: target, data: OWNER_SELECTOR }, 'latest'] }];
  let unclear = 0;
  const acceptOwnerError = (error) => {
    const kind = classifyCallError(error);
    if (kind === 'unclear') unclear += 1;
    return kind === 'execution';
  };

  let read;
  try {
    read = await rpcBatch(chainKey, calls, { [OWNER_CALL]: acceptOwnerError });
  } catch (error) {
    // An unclear error is not trusted from one endpoint. When every endpoint answered the
    // rest and each failed owner() in its own way, the call is what fails, not the chain:
    // read the rest without it. Anything else is a failed read.
    if (error.name !== 'ChainUnreachableError' || unclear === 0 || unclear !== error.attempts.length) throw error;
    read = await rpcBatch(chainKey, baseCalls);
    read.results.push(null);
  }
  const { results, endpoint } = read;
  const [blockHex, code, implWord, adminWord, beaconWord, legacyImplWord, legacyAdminWord, ownerWord] = results;

  const hasCode = typeof code === 'string' && code.length > 2;
  const implementation = wordToAddress(implWord) || wordToAddress(legacyImplWord);
  const admin = wordToAddress(adminWord) || wordToAddress(legacyAdminWord);
  const beacon = wordToAddress(beaconWord);

  const owner = hasCode ? wordToAddress(ownerWord) : null;

  return {
    chain: chainKey,
    address: target,
    blockNumber: Number(BigInt(blockHex)),
    hasCode,
    kind: !hasCode ? 'none' : implementation || beacon ? 'proxy' : 'plain',
    codeHash: hasCode ? toHex(keccak_256(hexToBytes(code))) : null,
    implementation,
    admin,
    beacon,
    owner,
    readAt: new Date().toISOString(),
    endpoint,
  };
}
