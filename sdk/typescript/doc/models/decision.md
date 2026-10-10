
# Decision

*This model accepts additional fields of type unknown.*

## Structure

`Decision`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `outcome` | [`DecisionOutcome`](../../doc/models/decision-outcome.md) | Required | - |
| `effect` | [`PaymentEffect`](../../doc/models/payment-effect.md) | Required | - |
| `profileId` | `string` | Required | - |
| `ruleSetVersion` | `string` | Required | - |
| `namedField` | `string \| null` | Required | - |
| `reason` | `string` | Required | - |
| `detail` | `unknown` | Required | - |
| `additionalProperties` | `Record<string, unknown>` | Optional | - |

## Example

```ts
import {
  Decision,
  DecisionOutcome,
  PaymentEffect,
} from 'stood-platform-apilib';

const decision: Decision = {
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
};
```

