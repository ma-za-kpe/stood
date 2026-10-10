
# Milestone

## Structure

`Milestone`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `name` | `string` | Required | **Constraints**: *Minimum Length*: `1`, *Maximum Length*: `100` |
| `amount` | [`Money`](../../doc/models/money.md) | Required | - |
| `profile` | `string` | Required | Evidence profile, e.g. code.milestone@1 or code.final@1<br><br>**Constraints**: *Minimum Length*: `1`, *Maximum Length*: `100` |
| `params` | [`MilestoneParams \| undefined`](../../doc/models/containers/milestone-params.md) | Optional | This is a container for any-of cases. |

## Example

```ts
import { Milestone } from 'stood-platform-apilib';

const milestone: Milestone = {
  name: 'name8',
  amount: {
    minor: 124,
    currency: 'currency2',
  },
  profile: 'profile2',
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
};
```

