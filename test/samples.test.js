import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
const kvs = {
  get: async (key) => (store.has(key) ? structuredClone(store.get(key)) : undefined),
  set: async (key, value) => void store.set(key, structuredClone(value)),
  delete: async (key) => void store.delete(key),
};
const listByPrefix = async (prefix) =>
  [...store].filter(([key]) => key.startsWith(prefix)).map(([, value]) => structuredClone(value));

const unreachable = new Set();
mock.module('../src/storage/kv.js', { namedExports: { kvs, listByPrefix } });
mock.module('../src/services/reader.js', {
  namedExports: {
    isAddress: (value) => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value),
    readContract: async (chain, address) => {
      if (unreachable.has(chain)) throw Object.assign(new Error(`Could not reach ${chain}`), { name: 'ChainUnreachableError' });
      return { chain, address, kind: 'proxy', hasCode: true, blockNumber: 1, readAt: new Date().toISOString(), implementation: '0x' + 'a'.repeat(40) };
    },
  },
});

const { SAMPLES, loadSamples, removeSamples } = await import('../src/services/samples.js');
const registry = await import('../src/services/registry.js');
const { isAddress } = await import('../src/services/reader.js');
const { CHAINS } = await import('../src/services/chains.js');

beforeEach(() => {
  store.clear();
  unreachable.clear();
});

test('every sample is a valid address on a supported chain, listed once, with no brand in its name', () => {
  for (const sample of SAMPLES) {
    assert.ok(CHAINS[sample.chain], sample.name);
    assert.ok(isAddress(sample.address), sample.name);
    assert.equal(sample.address, sample.address.toLowerCase(), sample.name);
    assert.doesNotMatch(sample.name, /usdc|aave|uniswap|weth|circle/i);
  }
  assert.equal(new Set(SAMPLES.map((s) => `${s.chain}:${s.address}`)).size, SAMPLES.length);
});

test('loading registers every sample, marked as a sample', async () => {
  const result = await loadSamples('judge');
  assert.equal(result.added.length, SAMPLES.length);
  const { contracts } = await registry.getRegistry();
  assert.equal(contracts.length, SAMPLES.length);
  assert.ok(contracts.every((c) => c.sample === true && c.status === 'in_sync'));
});

test('loading twice adds nothing the second time', async () => {
  await loadSamples('judge');
  const again = await loadSamples('judge');
  assert.equal(again.added.length, 0);
  assert.equal(again.alreadyThere.length, SAMPLES.length);
});

test('an unreachable chain skips its samples and loads the rest', async () => {
  unreachable.add('polygon');
  const result = await loadSamples('judge');
  assert.deepEqual(result.failed, ['Sample: stablecoin on Polygon']);
  assert.equal(result.added.length, SAMPLES.length - 1);
});

test('removing takes away samples only, not contracts registered by hand', async () => {
  const mine = { chain: 'sepolia', address: '0x' + '9'.repeat(40), name: 'Our treasury' };
  await registry.registerContract(mine, 'zax');
  await loadSamples('judge');
  const { removed } = await removeSamples();
  assert.equal(removed, SAMPLES.length);
  const { contracts } = await registry.getRegistry();
  assert.deepEqual(contracts.map((c) => c.name), ['Our treasury']);
});

test('a sample address registered by hand is left alone by both load and remove', async () => {
  const [first] = SAMPLES;
  await registry.registerContract({ ...first, name: 'Our stablecoin' }, 'zax');
  const result = await loadSamples('judge');
  assert.ok(result.alreadyThere.includes(first.name));
  await removeSamples();
  const { contracts } = await registry.getRegistry();
  assert.deepEqual(contracts.map((c) => c.name), ['Our stablecoin']);
});
