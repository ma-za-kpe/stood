
# Allowance Draft

## Structure

`AllowanceDraft`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `payeeRef` | `string` | Required | **Constraints**: *Minimum Length*: `1`, *Maximum Length*: `200` |
| `cap` | [`Money`](../../doc/models/money.md) | Required | - |
| `milestones` | [`Milestone[]`](../../doc/models/milestone.md) | Required | **Constraints**: *Maximum Items*: `50` |
| `windowDays` | `number` | Required | **Constraints**: `>= -9007199254740991`, `<= 9007199254740991` |
| `maxResubmits` | `number` | Required | **Constraints**: `>= -9007199254740991`, `<= 9007199254740991` |

## Example

```ts
import { AllowanceDraft } from 'stood-platform-apilib';

const allowanceDraft: AllowanceDraft = {
  payeeRef: 'payee_ref2',
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
  windowDays: 100,
  maxResubmits: 156,
};
```

