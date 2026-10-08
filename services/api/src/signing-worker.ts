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
export function signingWorker(deps: {
  db: NodePgDatabase<typeof schema>;
  transport: unknown;
  tranches: PostgresTranches;
  vaultKeys: string;
  clock(): Promise<number>;
}) {
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
        return advanceMandate(mandates, { load: (p, id) => terms.allowance(p, id) }, vault, key, () => now);
      },
      fund: (key) => advanceFunding(funding, deps.tranches, provider, mandates, key, deps.clock),
    });
}
