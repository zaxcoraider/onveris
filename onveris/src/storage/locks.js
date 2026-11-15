import { kvs } from './kv.js';

// A short-lived claim on a name, so two function runs do not do the same work at once.
// Built on "set only if the key does not exist", the one atomic test-and-set that
// key-value storage offers. A claim left behind by a run that died expires on its own.

const PREFIX = 'lock:';
const DEFAULT_SECONDS = 120;

const isTaken = (error) => error?.responseDetails?.status === 409 || /EXIST|CONFLICT/i.test(String(error?.code || ''));

async function claim(key, seconds) {
  try {
    await kvs.set(key, { expiresAt: Date.now() + seconds * 1000 }, { keyPolicy: 'FAIL_IF_EXISTS' });
    return true;
  } catch (error) {
    if (!isTaken(error)) throw error;
    return false;
  }
}

// Runs `work` while holding the claim. Returns { acquired: true, value } or, when someone
// else holds it, { acquired: false } without running `work`.
export async function withLock(name, work, seconds = DEFAULT_SECONDS) {
  const key = `${PREFIX}${name}`;
  let acquired = await claim(key, seconds);
  if (!acquired) {
    const holder = await kvs.get(key);
    if (!holder || holder.expiresAt < Date.now()) {
      await kvs.delete(key);
      acquired = await claim(key, seconds);
    }
  }
  if (!acquired) return { acquired: false };
  try {
    return { acquired: true, value: await work() };
  } finally {
    await kvs.delete(key);
  }
}
