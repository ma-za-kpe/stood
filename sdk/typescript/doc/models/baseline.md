
# Baseline

## Structure

`Baseline`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `id` | `string` | Required | **Constraints**: *Minimum Length*: `1`, *Maximum Length*: `200` |
| `status` | [`BaselineStatus`](../../doc/models/baseline-status.md) | Required | QUEUED until Stood has run it; INVALID when the frozen tests are not at the base commit as described |
| `repository` | `string` | Required | - |
| `baseCommit` | `string` | Required | **Constraints**: *Pattern*: `^[a-f0-9]{40}$` |
| `testBundleHash` | `string` | Required | **Constraints**: *Pattern*: `^[a-f0-9]{64}$` |
| `tests` | [`BaselineTest[] \| null`](../../doc/models/baseline-test.md) | Required | Only when DONE: every frozen test as it ran on the base commit; a red baseline is all FAIL |
| `evidenceSha256` | `string \| null` | Required | Only when DONE: SHA-256 of the run stored in Stood's evidence bucket<br><br>**Constraints**: *Pattern*: `^[a-f0-9]{64}$` |
| `createdAt` | `string` | Required | UTC ISO-8601 timestamp |
| `finishedAt` | `string \| null` | Required | UTC ISO-8601 timestamp |

## Example

```ts
import {
  Baseline,
  BaselineStatus,
  BaselineTestStatus,
} from 'stood-platform-apilib';

const baseline: Baseline = {
  id: 'id0',
  status: BaselineStatus.Queued,
  repository: 'repository0',
  baseCommit: 'base_commit2',
  testBundleHash: 'test_bundle_hash6',
  tests: [
    {
      id: 'id6',
      status: BaselineTestStatus.Pass,
    }
  ],
  evidenceSha256: 'evidence_sha2562',
  createdAt: 'created_at8',
  finishedAt: 'finished_at6',
};
```

