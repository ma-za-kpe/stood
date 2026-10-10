
# Commit Package Input

## Structure

`CommitPackageInput`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `repository` | `string` | Required | **Constraints**: *Pattern*: `^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$` |
| `baseCommit` | `string` | Required | **Constraints**: *Pattern*: `^[a-f0-9]{40}$` |
| `commitSha` | `string` | Required | **Constraints**: *Pattern*: `^[a-f0-9]{40}$` |
| `reportRef` | `string` | Required | **Constraints**: *Pattern*: `^[A-Za-z0-9][A-Za-z0-9/_-]*\.json$` |
| `reportSha256` | `string` | Required | **Constraints**: *Pattern*: `^[a-f0-9]{64}$` |

## Example

```ts
import { CommitPackageInput } from 'stood-platform-apilib';

const commitPackageInput: CommitPackageInput = {
  repository: 'repository4',
  baseCommit: 'base_commit6',
  commitSha: 'commit_sha8',
  reportRef: 'report_ref2',
  reportSha256: 'report_sha2560',
};
```

