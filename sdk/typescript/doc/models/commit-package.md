
# Commit Package

## Structure

`CommitPackage`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `id` | `string` | Required | **Constraints**: *Minimum Length*: `1`, *Maximum Length*: `200` |
| `trancheId` | `string` | Required | **Constraints**: *Minimum Length*: `1`, *Maximum Length*: `200` |
| `status` | `string` | Required, Constant | **Value**: `'QUEUED'` |
| `waitingFor` | [`PackageWaitingFor`](../../doc/models/package-waiting-for.md) | Required | - |
| `metadata` | [`CommitPackageInput`](../../doc/models/commit-package-input.md) | Required | - |
| `createdAt` | `string` | Required | UTC ISO-8601 timestamp |

## Example

```ts
import { CommitPackage, PackageWaitingFor } from 'stood-platform-apilib';

const commitPackage: CommitPackage = {
  id: 'id0',
  trancheId: 'trancheId8',
  status: 'QUEUED',
  waitingFor: PackageWaitingFor.Runner,
  metadata: {
    repository: 'repository6',
    baseCommit: 'base_commit8',
    commitSha: 'commit_sha0',
    reportRef: 'report_ref4',
    reportSha256: 'report_sha2562',
  },
  createdAt: 'createdAt4',
};
```

