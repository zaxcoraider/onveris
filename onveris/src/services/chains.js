// Supported chains and the public JSON-RPC endpoints tried for each, in order.
// Every host listed here must also be declared under permissions.external.fetch.backend
// in manifest.yml, or Forge rejects the request.
export const CHAINS = {
  ethereum: {
    key: 'ethereum',
    name: 'Ethereum',
    chainId: 1,
    explorer: 'https://etherscan.io',
    endpoints: ['https://ethereum-rpc.publicnode.com', 'https://1rpc.io/eth'],
  },
  base: {
    key: 'base',
    name: 'Base',
    chainId: 8453,
    explorer: 'https://basescan.org',
    endpoints: ['https://base-rpc.publicnode.com', 'https://mainnet.base.org'],
  },
  arbitrum: {
    key: 'arbitrum',
    name: 'Arbitrum One',
    chainId: 42161,
    explorer: 'https://arbiscan.io',
    endpoints: ['https://arbitrum-one-rpc.publicnode.com', 'https://arb1.arbitrum.io/rpc'],
  },
  optimism: {
    key: 'optimism',
    name: 'Optimism',
    chainId: 10,
    explorer: 'https://optimistic.etherscan.io',
    endpoints: ['https://optimism-rpc.publicnode.com', 'https://mainnet.optimism.io'],
  },
  polygon: {
    key: 'polygon',
    name: 'Polygon',
    chainId: 137,
    explorer: 'https://polygonscan.com',
    endpoints: ['https://polygon-bor-rpc.publicnode.com', 'https://1rpc.io/matic'],
  },
  sepolia: {
    key: 'sepolia',
    name: 'Sepolia (test network)',
    chainId: 11155111,
    explorer: 'https://sepolia.etherscan.io',
    endpoints: ['https://ethereum-sepolia-rpc.publicnode.com', 'https://1rpc.io/sepolia'],
  },
};

export const listChains = () =>
  Object.values(CHAINS).map(({ key, name, chainId, explorer }) => ({ key, name, chainId, explorer }));

export const getChain = (key) => {
  const chain = CHAINS[key];
  if (!chain) throw new Error(`Unsupported chain: ${key}`);
  return chain;
};
