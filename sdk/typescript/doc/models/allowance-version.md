
# Allowance Version

## Structure

`AllowanceVersion`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `version` | `number` | Required | **Constraints**: `>= 1`, `<= 2147483647` |
| `body` | [`Allowance`](../../doc/models/allowance.md) | Required | - |
| `termsHash` | `string` | Required | **Constraints**: *Pattern*: `^[a-f0-9]{64}$` |

## Example

```ts
import { AllowanceVersion } from 'stood-platform-apilib';

const allowanceVersion: AllowanceVersion = {
  version: 202,
  body: {
    id: 'id6',
    status: 'DRAFT',
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
    windowDays: 224,
    maxResubmits: 32,
    tranches: [
      {
        id: 'id4',
        name: 'name4',
      }
    ],
  },
  termsHash: 'terms_hash0',
};
```

