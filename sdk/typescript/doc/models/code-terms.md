
# Code Terms

Frozen terms of a code milestone (profiles code.*), checked at draft time.

*This model accepts additional fields of type unknown.*

## Structure

`CodeTerms`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `repository` | `string` | Required | **Constraints**: *Pattern*: `^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$` |
| `baseCommit` | `string` | Required | **Constraints**: *Pattern*: `^[a-f0-9]{40}$` |
| `testBundleHash` | `string` | Required | **Constraints**: *Pattern*: `^[a-f0-9]{64}$` |
| `manifestHash` | `string` | Required | **Constraints**: *Pattern*: `^[a-f0-9]{64}$` |
| `testIds` | `string[]` | Required | **Constraints**: *Minimum Items*: `1`, *Maximum Items*: `200` |
| `tests` | [`FrozenTest[]`](../../doc/models/frozen-test.md) | Required | **Constraints**: *Minimum Items*: `1`, *Maximum Items*: `200` |
| `minMutation` | `number \| undefined` | Optional | Mutation-score floor from 0 to 1; no floor (0) when omitted<br><br>**Constraints**: `>= 0`, `<= 1` |
| `additionalProperties` | `Record<string, unknown>` | Optional | - |

## Example

```ts
import { CodeTerms } from 'stood-platform-apilib';

const codeTerms: CodeTerms = {
  repository: 'repository2',
  baseCommit: 'baseCommit2',
  testBundleHash: 'testBundleHash8',
  manifestHash: 'manifestHash8',
  testIds: [
    'testIds7',
    'testIds6',
    'testIds5'
  ],
  tests: [
    {
      id: 'id6',
      path: 'path0',
    }
  ],
  minMutation: 1,
  additionalProperties: {
    'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
  },
};
```

