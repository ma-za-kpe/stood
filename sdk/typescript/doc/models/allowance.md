
# Allowance

## Structure

`Allowance`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `id` | `string` | Required | **Constraints**: *Minimum Length*: `1`, *Maximum Length*: `200` |
| `status` | `string` | Required, Constant | **Value**: `'DRAFT'` |
| `payeeRef` | `string` | Required | - |
| `cap` | [`Money`](../../doc/models/money.md) | Required | - |
| `milestones` | [`Milestone[]`](../../doc/models/milestone.md) | Required | - |
| `windowDays` | `number` | Required | **Constraints**: `>= -9007199254740991`, `<= 9007199254740991` |
| `maxResubmits` | `number` | Required | **Constraints**: `>= -9007199254740991`, `<= 9007199254740991` |
| `tranches` | [`TrancheRef[]`](../../doc/models/tranche-ref.md) | Required | - |

## Example

```ts
import { Allowance } from 'stood-platform-apilib';

const allowance: Allowance = {
  id: 'id8',
  status: 'DRAFT',
  payeeRef: 'payee_ref0',
  cap: {
    minor: 48,
    currency: 'currency4',
  },
  milestones: [
    {
      name: 'name8',
      amount: {
        minor: 124,
        currency: 'currency2',
      },
      profile: 'profile8',
      params: {
        repository: 'repository8',
        baseCommit: 'baseCommit6',
        testBundleHash: 'testBundleHash4',
        manifestHash: 'manifestHash2',
        testIds: [
          'testIds7',
          'testIds8'
        ],
        tests: [
          {
            id: 'id6',
            path: 'path0',
          },
          {
            id: 'id6',
            path: 'path0',
          },
          {
            id: 'id6',
            path: 'path0',
          }
        ],
        minMutation: 1,
        additionalProperties: {
          'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
        },
      },
    }
  ],
  windowDays: 162,
  maxResubmits: 94,
  tranches: [
    {
      id: 'id4',
      name: 'name4',
    }
  ],
};
```

