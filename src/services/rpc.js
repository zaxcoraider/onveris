import { getChain } from './chains.js';

const REQUEST_TIMEOUT_MS = 8000;

// Raised when no endpoint for a chain gave a usable answer. Callers must treat this
// as "unreachable", never as a change on the chain.
export class ChainUnreachableError extends Error {
  constructor(chainKey, attempts) {
    super(`Could not reach ${chainKey}: ${attempts.map((a) => `${a.endpoint} (${a.reason})`).join('; ')}`);
    this.name = 'ChainUnreachableError';
    this.chainKey = chainKey;
    this.attempts = attempts;
  }
}

let nextId = 1;

async function callEndpoint(endpoint, calls) {
  const body = calls.map(({ method, params }) => ({ jsonrpc: '2.0', id: nextId++, method, params }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload) || payload.length !== body.length) {
      throw new Error('unexpected batch response');
    }
    const byId = new Map(payload.map((item) => [item.id, item]));
    return body.map((request) => {
      const item = byId.get(request.id);
      if (!item) throw new Error('missing result in batch');
      if (item.error) throw new Error(item.error.message || 'RPC error');
      return item.result;
    });
  } finally {
    clearTimeout(timer);
  }
}

// Sends a batch of read calls to the chain, trying each endpoint in order.
// All results in a batch come from the same endpoint, so they are consistent with each other.
export async function rpcBatch(chainKey, calls) {
  const chain = getChain(chainKey);
  const attempts = [];
  for (const endpoint of chain.endpoints) {
    try {
      const results = await callEndpoint(endpoint, calls);
      return { results, endpoint };
    } catch (error) {
      attempts.push({ endpoint, reason: error.name === 'AbortError' ? 'timed out' : error.message });
    }
  }
  throw new ChainUnreachableError(chainKey, attempts);
}

// Asks one endpoint for its latest block, for the settings page's status section.
// Never throws: returns { ok, block, ms } or { ok: false, reason, ms }.
export async function probeEndpoint(endpoint) {
  const started = Date.now();
  try {
    const [block] = await callEndpoint(endpoint, [{ method: 'eth_blockNumber', params: [] }]);
    return { ok: true, block: Number(BigInt(block)), ms: Date.now() - started };
  } catch (error) {
    return { ok: false, reason: error.name === 'AbortError' ? 'timed out' : error.message, ms: Date.now() - started };
  }
}
