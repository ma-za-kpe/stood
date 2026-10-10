
# Tranche

## Structure

`Tranche`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `id` | `string` | Required | **Constraints**: *Minimum Length*: `1`, *Maximum Length*: `200` |
| `state` | [`TrancheState`](../../doc/models/tranche-state.md) | Required | - |
| `version` | `number` | Required | Send as expected_version when funding<br><br>**Constraints**: `>= -9007199254740991`, `<= 9007199254740991` |
| `profile` | `string` | Required | - |
| `amount` | [`Money`](../../doc/models/money.md) | Required | - |
| `decision` | [`Decision \| null`](../../doc/models/decision.md) | Required | - |
| `hold` | [`TrancheHold \| null`](../../doc/models/tranche-hold.md) | Required | - |
| `settlement` | [`Settlement \| null`](../../doc/models/settlement.md) | Required | - |
| `safeRecovery` | `boolean` | Required | - |
| `pending` | [`PendingPaymentOperation \| null`](../../doc/models/pending-payment-operation.md) | Required | - |
| `sentences` | `Record<string, unknown>` | Required | Plain-language status for the payer and the inspector |
| `packageId` | `string \| null` | Required | **Constraints**: *Minimum Length*: `1`, *Maximum Length*: `200` |
| `resubmissionsLeft` | `number` | Required | **Constraints**: `>= 0`, `<= 9007199254740991` |
| `provider` | [`PaymentProvider`](../../doc/models/payment-provider.md) | Required | - |

## Example

```ts
import {
  DecisionOutcome,
  PaymentEffect,
  PaymentProvider,
  Tranche,
  TrancheState,
} from 'stood-platform-apilib';

const tranche: Tranche = {
  id: 'id4',
  state: TrancheState.Pending,
  version: 152,
  profile: 'profile6',
  amount: {
    minor: 124,
    currency: 'currency2',
  },
  decision: {
    outcome: DecisionOutcome.Refuse,
    effect: PaymentEffect.Capture,
    profileId: 'profileId2',
    ruleSetVersion: 'ruleSetVersion0',
    namedField: 'namedField4',
    reason: 'reason8',
    detail: { 'key1': 'val1', 'key2': 'val2' },
    additionalProperties: {
      'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
    },
  },
  hold: {
    ageSeconds: 150,
    expiresAt: 'expires_at8',
    additionalProperties: {
      'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
    },
  },
  settlement: {
    effect: 'effect6',
    additionalProperties: {
      'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
    },
  },
  safeRecovery: false,
  pending: {
    effect: 'effect8',
    status: 'status6',
    createdAt: 'created_at2',
  },
  sentences: {
    'key0': { 'key1': 'val1', 'key2': 'val2' }
  },
  packageId: 'package_id2',
  resubmissionsLeft: 220,
  provider: PaymentProvider.Paypalsandbox,
};
```

