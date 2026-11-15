// These tests read live public chains, so they need a network connection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readContract, isAddress } from '../src/services/reader.js';

const USDC_ETHEREUM = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // proxy, older OpenZeppelin slots
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // proxy
const WETH_ETHEREUM = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // plain, no owner()
const NOTHING_DEPLOYED = '0x000000000000000000000000000000000000dEaD';

test('isAddress accepts only 0x plus 40 hex characters', () => {
  assert.equal(isAddress(USDC_ETHEREUM), true);
  assert.equal(isAddress(USDC_ETHEREUM.slice(0, -1)), false);
  assert.equal(isAddress('0x' + 'g'.repeat(40)), false);
  assert.equal(isAddress(undefined), false);
});

test('reads a proxy that uses the older OpenZeppelin slots', async () => {
  const state = await readContract('ethereum', USDC_ETHEREUM);
  assert.equal(state.kind, 'proxy');
  assert.equal(state.address, USDC_ETHEREUM.toLowerCase());
  assert.ok(isAddress(state.implementation));
  assert.ok(isAddress(state.admin));
  assert.match(state.codeHash, /^0x[0-9a-f]{64}$/);
  assert.ok(state.blockNumber > 0);
});

test('reads a proxy on a second chain', async () => {
  const state = await readContract('base', USDC_BASE);
  assert.equal(state.kind, 'proxy');
  assert.ok(isAddress(state.implementation));
});

test('reads a plain contract with no owner function', async () => {
  const state = await readContract('ethereum', WETH_ETHEREUM);
  assert.equal(state.kind, 'plain');
  assert.equal(state.implementation, null);
  assert.equal(state.owner, null);
  assert.match(state.codeHash, /^0x[0-9a-f]{64}$/);
});

test('reports an address with no code as nothing deployed', async () => {
  const state = await readContract('ethereum', NOTHING_DEPLOYED);
  assert.equal(state.kind, 'none');
  assert.equal(state.codeHash, null);
});

test('two reads of the same contract agree', async () => {
  const [first, second] = await Promise.all([
    readContract('ethereum', WETH_ETHEREUM),
    readContract('ethereum', WETH_ETHEREUM),
  ]);
  assert.equal(first.codeHash, second.codeHash);
});

test('rejects an invalid address and an unsupported chain', async () => {
  await assert.rejects(readContract('ethereum', '0x123'));
  await assert.rejects(readContract('solana', WETH_ETHEREUM));
});
