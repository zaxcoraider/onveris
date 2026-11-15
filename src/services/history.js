import { keccakText } from './reader.js';
import { rpcBatch } from './rpc.js';
import { CHAINS } from './chains.js';

// Finds the transaction behind a change Onveris has just detected, by reading the standard
// events contracts emit when they are upgraded or change hands.
//
// Only the blocks since the previous check are searched. Free public endpoints refuse older
// or wider searches (measured 15 Nov 2026: 10,000 blocks at most on some, archive data on
// none), so a contract's history from before it was registered cannot be read this way.

const MAX_BLOCK_SPAN = 9000;
const ZERO_ADDRESS = '0x' + '0'.repeat(40);

const topicAddress = (topic) => (typeof topic === 'string' && topic.length === 66 ? '0x' + topic.slice(26).toLowerCase() : null);
const dataAddress = (data, index) =>
  typeof data === 'string' && data.length >= 2 + 64 * (index + 1)
    ? '0x' + data.slice(2 + 64 * index + 24, 2 + 64 * (index + 1)).toLowerCase()
    : null;

// For each tracked value, the event that announces a new one and where the new value sits in it.
const EVENTS = {
  implementation: { topic: keccakText('Upgraded(address)'), newValue: (log) => topicAddress(log.topics[1]) },
  beacon: { topic: keccakText('BeaconUpgraded(address)'), newValue: (log) => topicAddress(log.topics[1]) },
  owner: { topic: keccakText('OwnershipTransferred(address,address)'), newValue: (log) => topicAddress(log.topics[2]) },
  admin: { topic: keccakText('AdminChanged(address,address)'), newValue: (log) => dataAddress(log.data, 1) },
};

export const hasEventFor = (field) => Boolean(EVENTS[field]);

// The latest log that announces exactly this new value for this field, or null.
// A value of null on the chain is announced as the zero address.
export function matchEvent(logs, field, newValue) {
  const event = EVENTS[field];
  if (!event) return null;
  const wanted = (newValue || ZERO_ADDRESS).toLowerCase();
  const matches = logs.filter(
    (log) => log.topics?.[0] === event.topic && !log.removed && event.newValue(log) === wanted
  );
  if (matches.length === 0) return null;
  const latest = matches.reduce((a, b) => (BigInt(b.blockNumber) >= BigInt(a.blockNumber) ? b : a));
  return { txHash: latest.transactionHash, blockNumber: Number(BigInt(latest.blockNumber)) };
}

// Looks for the transaction that set `newValue`, between the previous check and this one.
// Returns { txHash, blockNumber, txUrl } or null. It never throws: not finding the
// transaction, or not reaching the chain, only means the change is shown without one.
export async function findChangeTransaction(contract, field, newValue) {
  const event = EVENTS[field];
  const toBlock = contract.lastBlock;
  if (!event || !toBlock) return null;
  const since = contract.previousBlock ? contract.previousBlock + 1 : toBlock;
  const fromBlock = Math.max(since, toBlock - MAX_BLOCK_SPAN);
  if (fromBlock > toBlock) return null;
  try {
    const { results } = await rpcBatch(contract.chain, [
      {
        method: 'eth_getLogs',
        params: [
          {
            address: contract.address,
            topics: [event.topic],
            fromBlock: '0x' + fromBlock.toString(16),
            toBlock: '0x' + toBlock.toString(16),
          },
        ],
      },
    ]);
    const found = matchEvent(Array.isArray(results[0]) ? results[0] : [], field, newValue);
    return found ? { ...found, txUrl: `${CHAINS[contract.chain].explorer}/tx/${found.txHash}` } : null;
  } catch (error) {
    console.warn(`[history] no transaction lookup for ${contract.id}: ${error.message}`);
    return null;
  }
}
