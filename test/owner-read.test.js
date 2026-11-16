// How a failing owner() call is read. The chain is scripted through a stand-in for fetch.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readContract, classifyCallError } from '../src/services/reader.js';

const ADDRESS = '0x' + '11'.repeat(20);
const OWNER = '0x' + '0'.repeat(24) + 'ab'.repeat(20);
const ZERO = '0x' + '0'.repeat(64);

// Per endpoint, in order of use: what it does with owner(). 'down' fails the whole request.
let script;
let requests;
const realFetch = globalThis.fetch;

beforeEach(() => {
  requests = [];
  globalThis.fetch = async (endpoint, { body }) => {
    const calls = JSON.parse(body);
    const behaviour = script[new Set(requests.map((r) => r.endpoint)).add(endpoint).size - 1];
    requests.push({ endpoint, methods: calls.map((c) => c.method) });
    if (behaviour === 'down') return { ok: false, status: 503 };
    const items = calls.map(({ id, method }) => {
      if (method === 'eth_blockNumber') return { id, result: '0x64' };
      if (method === 'eth_getCode') return { id, result: '0x6001' };
      if (method === 'eth_getStorageAt') return { id, result: ZERO };
      return typeof behaviour === 'string' ? { id, result: behaviour } : { id, error: behaviour };
    });
    return { ok: true, status: 200, json: async () => items };
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('sorts endpoint errors into execution, transient and unclear', () => {
  for (const error of [
    { code: 3, message: 'execution reverted' },
    { code: -32000, message: 'invalid opcode: INVALID' },
    { code: -32000, message: 'out of gas' },
    { code: -32015, message: 'VM Exception while processing transaction' },
    { code: -32000, message: 'stack underflow (0 <=> 1)' },
    { code: 3, message: '' },
  ]) assert.equal(classifyCallError(error), 'execution', error.message);
  for (const error of [
    { code: -32005, message: 'rate limit reached' },
    { code: 429, message: 'Too Many Requests' },
    { code: -32000, message: 'header not found' },
    { code: -32000, message: 'missing trie node abc' },
    { code: -32603, message: 'Internal error' },
    { code: -32000, message: 'request timed out' },
  ]) assert.equal(classifyCallError(error), 'transient', error.message);
  assert.equal(classifyCallError({ code: -32000, message: 'something new' }), 'unclear');
  assert.equal(classifyCallError(undefined), 'unclear');
});

test('reads the owner in the same request as everything else', async () => {
  script = [OWNER];
  const state = await readContract('ethereum', ADDRESS);
  assert.equal(state.owner, '0x' + 'ab'.repeat(20));
  assert.equal(requests.length, 1);
});

test('a contract whose owner() fails to execute simply has no owner', async () => {
  for (const error of [{ code: 3, message: 'execution reverted' }, { code: -32000, message: 'invalid opcode: INVALID' }]) {
    requests = [];
    script = [error];
    const state = await readContract('ethereum', ADDRESS);
    assert.equal(state.owner, null);
    assert.equal(state.kind, 'plain');
    assert.equal(requests.length, 1);
  }
});

test('a transient error on owner() moves on to the next endpoint', async () => {
  script = [{ code: -32005, message: 'rate limit reached' }, OWNER];
  const state = await readContract('ethereum', ADDRESS);
  assert.equal(state.owner, '0x' + 'ab'.repeat(20));
});

test('a transient error on owner() everywhere is a failed read, never a missing owner', async () => {
  script = [{ code: -32005, message: 'rate limit reached' }, { code: -32603, message: 'Internal error' }];
  await assert.rejects(readContract('ethereum', ADDRESS), { name: 'ChainUnreachableError' });
});

test('an unclear error is not trusted from one endpoint when another gives the owner', async () => {
  script = [{ code: -32000, message: 'something new' }, OWNER];
  const state = await readContract('ethereum', ADDRESS);
  assert.equal(state.owner, '0x' + 'ab'.repeat(20));
});

test('an unclear error from every endpoint means no owner, and the contract stays readable', async () => {
  script = [{ code: -32000, message: 'something new' }, { code: -32000, message: 'another oddity' }];
  const state = await readContract('ethereum', ADDRESS);
  assert.equal(state.owner, null);
  assert.equal(state.blockNumber, 100);
  assert.ok(!requests.at(-1).methods.includes('eth_call'));
});

test('an unclear error from one endpoint and a dead second endpoint is a failed read', async () => {
  script = [{ code: -32000, message: 'something new' }, 'down'];
  await assert.rejects(readContract('ethereum', ADDRESS), { name: 'ChainUnreachableError' });
});

test('an unclear error from one endpoint and a transient one from the other is a failed read', async () => {
  script = [{ code: -32000, message: 'something new' }, { code: -32005, message: 'rate limit reached' }];
  await assert.rejects(readContract('ethereum', ADDRESS), { name: 'ChainUnreachableError' });
});
