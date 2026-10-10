/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import {
  boolean,
  dict,
  lazy,
  nullable,
  number,
  object,
  optional,
  Schema,
  string,
  unknown,
} from '../schema.js';
import { Decision, decisionSchema } from './decision.js';
import { Money, moneySchema } from './money.js';
import { PaymentProvider, paymentProviderSchema } from './paymentProvider.js';
import {
  PendingPaymentOperation,
  pendingPaymentOperationSchema,
} from './pendingPaymentOperation.js';
import { Settlement, settlementSchema } from './settlement.js';
import { TrancheHold, trancheHoldSchema } from './trancheHold.js';
import { TrancheState, trancheStateSchema } from './trancheState.js';

export interface Tranche {
  id: string;
  state: TrancheState;
  /** Send as expected_version when funding */
  version: number;
  profile: string;
  amount: Money;
  decision: Decision | null;
  hold: TrancheHold | null;
  settlement: Settlement | null;
  safeRecovery: boolean;
  pending: PendingPaymentOperation | null;
  /** Plain-language status for the payer and the inspector */
  sentences?: Record<string, unknown>;
  packageId: string | null;
  resubmissionsLeft: number;
  provider: PaymentProvider;
}

export const trancheSchema: Schema<Tranche> = lazy(() =>
  object({
    id: ['id', string()],
    state: ['state', trancheStateSchema],
    version: ['version', number()],
    profile: ['profile', string()],
    amount: ['amount', moneySchema],
    decision: ['decision', nullable(decisionSchema)],
    hold: ['hold', nullable(trancheHoldSchema)],
    settlement: ['settlement', nullable(settlementSchema)],
    safeRecovery: ['safe_recovery', boolean()],
    pending: ['pending', nullable(pendingPaymentOperationSchema)],
    sentences: ['sentences', optional(dict(unknown()))],
    packageId: ['package_id', nullable(string())],
    resubmissionsLeft: ['resubmissions_left', number()],
    provider: ['provider', paymentProviderSchema],
  })
);
