import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { PostgresFunding } from './adapters/db-postgres/funding.js';
import { PostgresMandates } from './adapters/db-postgres/mandates.js';
import { PostgresPlatformApi } from './adapters/db-postgres/platform-api.js';
import type * as schema from './adapters/db-postgres/schema.js';
import { TokenCipher } from './adapters/db-postgres/token-cipher.js';
import type { PostgresTranches } from './adapters/db-postgres/tranches.js';
import { PayPalFundingAdapter } from './adapters/payments-paypal/funding.js';
import type { PayPalFundingTransport, PayPalVaultTransport } from './adapters/payments-paypal/sdk.js';
import { PayPalVaultAdapter } from './adapters/payments-paypal/vault.js';
import { advanceFunding } from './application/funding.js';
import { advanceMandate } from './application/mandate-signing.js';
import { advancePending } from './application/pending-work.js';

// T-0260: the worker step for saved-PayPal mandates and tranche funding, as the reconciler runs it.
// Throws when the transport cannot save accounts or fund orders, or the sealed-token keys are missing.
type WorkerDeps = {
  db: NodePgDatabase<typeof schema>;
  transport: unknown;
  tranches: PostgresTranches;
  vaultKeys: string;
  clock(): Promise<number>;
};
export function signingWorker(deps: WorkerDeps) {
  const sdk = deps.transport as Partial<PayPalFundingTransport & PayPalVaultTransport>;
  if (typeof sdk.fund !== 'function' || typeof sdk.vault !== 'function')
    throw new Error('PayPal transport cannot save accounts or fund orders');
  const mandates = new PostgresMandates(deps.db, new TokenCipher(deps.vaultKeys));
  const funding = new PostgresFunding(deps.db);
  const terms = new PostgresPlatformApi(deps.db);
  const vault = new PayPalVaultAdapter(sdk as PayPalVaultTransport);
  const provider = new PayPalFundingAdapter(sdk as PayPalFundingTransport, mandates);
  return () =>
    advancePending({
      mandates,
      fundings: funding,
      mandate: async (key) => {
        const now = await deps.clock();
        const before = (await mandates.load(key)).status;
        await advanceMandate(mandates, { load: (p, id) => terms.allowance(p, id) }, vault, key, () => now);
        return { before, after: (await mandates.load(key)).status };
      },
      fund: async (key) => {
        const before = (await funding.load(key)).status;
        await advanceFunding(funding, deps.tranches, provider, mandates, key, deps.clock);
        return { before, after: (await funding.load(key)).status };
      },
    });
}

// #77 operations: recovers a funding stuck in CREATING (PayPal's answer to the create was lost) from the PayPal order
// id an operator found. Nothing is created or re-sent: Stood reads that order from PayPal, and it counts only if PayPal
// shows it carries this funding's key and tranche (reference_id, custom_id) and the exact amount; then the funding
// moves on exactly as if the original answer had arrived. Anything else leaves it unchanged.
export function fundingRecovery(deps: WorkerDeps) {
  const sdk = deps.transport as Partial<PayPalFundingTransport>;
  if (typeof sdk.fund !== 'function') throw new Error('PayPal transport cannot fund orders');
  const mandates = new PostgresMandates(deps.db, new TokenCipher(deps.vaultKeys));
  const funding = new PostgresFunding(deps.db);
  const provider = new PayPalFundingAdapter(sdk as PayPalFundingTransport, mandates);
  return async (key: string, orderId: string) => {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(orderId)) throw new Error('INVALID_ORDER_ID');
    const before = await funding.load(key);
    const outcome = await advanceFunding(funding, deps.tranches, provider, mandates, key, deps.clock, orderId);
    return { before: before.status, outcome };
  };
}
