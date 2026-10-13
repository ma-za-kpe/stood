
# Allowance Proposal

## Structure

`AllowanceProposal`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `expectedVersion` | `number` | Required | **Constraints**: `>= 1`, `<= 2147483646` |
| `terms` | [`AllowanceDraft`](../../doc/models/allowance-draft.md) | Required | - |

## Example

```ts
import { AllowanceProposal } from 'stood-platform-apilib';

const allowanceProposal: AllowanceProposal = {
  expectedVersion: 110,
  terms: {
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
    windowDays: 182,
    maxResubmits: 74,
  },
};
```

