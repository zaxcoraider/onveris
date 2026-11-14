import Resolver from '@forge/resolver';
import { listChains } from '../services/chains.js';
import {
  TRACKED_FIELDS,
  getRegistry,
  registerContract,
  checkContract,
  checkAllContracts,
  removeContract,
  describeContract,
} from '../services/registry.js';

const resolver = new Resolver();

// Runs a handler and turns failures into a result the UI can show. Problems the user can
// fix carry their own message; anything else is logged and reported in general terms.
const safely = (handler) => async (request) => {
  try {
    return { ok: true, ...(await handler(request)) };
  } catch (error) {
    if (error.name === 'RegistryError') return { ok: false, message: error.message };
    if (error.name === 'ChainUnreachableError') {
      console.warn(error.message);
      return { ok: false, message: "Couldn't reach the chain. Nothing was changed. Try again in a moment." };
    }
    console.error(error);
    return { ok: false, message: 'Something went wrong. Try again.' };
  }
};

resolver.define('getSetup', () => ({ chains: listChains(), fields: TRACKED_FIELDS }));

resolver.define('getRegistry', safely(async () => getRegistry()));

resolver.define(
  'registerContract',
  safely(async ({ payload, context }) => ({
    contract: describeContract(await registerContract(payload || {}, context?.accountId)),
  }))
);

resolver.define(
  'checkContract',
  safely(async ({ payload }) => ({ contract: describeContract(await checkContract(payload?.id)) }))
);

resolver.define(
  'checkAll',
  safely(async () => {
    await checkAllContracts();
    return getRegistry();
  })
);

resolver.define(
  'removeContract',
  safely(async ({ payload }) => {
    await removeContract(payload?.id);
    return {};
  })
);

export const handler = resolver.getDefinitions();
