import { RegistryError, registerContract, removeContract } from './registry.js';
import { contractId, getContract, listContracts } from '../storage/contracts.js';

// Well-known public contracts that let someone see Onveris working on a fresh site in a
// minute. Names describe what each contract is rather than its brand, so nothing on screen
// is a third-party trademark. Every one was read successfully on 15 Nov 2026.
export const SAMPLES = [
  { chain: 'ethereum', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', name: 'Sample: stablecoin on Ethereum' },
  { chain: 'base', address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', name: 'Sample: stablecoin on Base' },
  { chain: 'arbitrum', address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', name: 'Sample: stablecoin on Arbitrum' },
  { chain: 'optimism', address: '0x0b2c639c533813f4aa9d7837caf62653d097ff85', name: 'Sample: stablecoin on Optimism' },
  { chain: 'polygon', address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', name: 'Sample: stablecoin on Polygon' },
  { chain: 'ethereum', address: '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2', name: 'Sample: lending pool on Ethereum' },
  { chain: 'ethereum', address: '0x1f98431c8ad98523631ae4a59f267346ea31f984', name: 'Sample: exchange factory on Ethereum' },
  { chain: 'ethereum', address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', name: 'Sample: wrapped ether on Ethereum' },
];

// Registers every sample not already in the registry, reading each from its chain.
// A sample that cannot be read is skipped and reported; the others still load.
export async function loadSamples() {
  const result = { added: [], alreadyThere: [], failed: [] };
  for (const sample of SAMPLES) {
    if (await getContract(contractId(sample.chain, sample.address))) {
      result.alreadyThere.push(sample.name);
      continue;
    }
    try {
      await registerContract(sample, { sample: true });
      result.added.push(sample.name);
    } catch (error) {
      if (error.name !== 'ChainUnreachableError' && !(error instanceof RegistryError)) throw error;
      console.warn(`[samples] ${sample.name}: ${error.message}`);
      result.failed.push(sample.name);
    }
  }
  return result;
}

// Removes the contracts the loader added, with their changes and planned changes. Contracts
// registered by hand are left alone, even when they have the same address as a sample.
export async function removeSamples() {
  const samples = (await listContracts()).filter((contract) => contract.sample);
  for (const contract of samples) await removeContract(contract.id);
  return { removed: samples.length };
}
