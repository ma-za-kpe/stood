
# Code Terms Input

Frozen terms of a code milestone, as a platform sends them.

## Structure

`CodeTermsInput`

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

## Example

```ts
import { CodeTermsInput } from 'stood-platform-apilib';

const codeTermsInput: CodeTermsInput = {
  repository: 'repository8',
  baseCommit: 'baseCommit6',
  testBundleHash: 'testBundleHash4',
  manifestHash: 'manifestHash2',
  testIds: [
    'testIds7',
    'testIds8',
    'testIds9'
  ],
  tests: [
    {
      id: 'id6',
      path: 'path0',
    }
  ],
  minMutation: 1,
};
```

