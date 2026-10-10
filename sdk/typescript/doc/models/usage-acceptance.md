
# Usage Acceptance

## Structure

`UsageAcceptance`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `trancheId` | `string` | Required | **Constraints**: *Minimum Length*: `1`, *Maximum Length*: `200` |
| `commit` | `string` | Required | **Constraints**: *Pattern*: `^[a-f0-9]{40}$` |
| `status` | `string` | Required, Constant | **Value**: `'ACCEPTED'` |
| `acceptedAt` | `string` | Required | UTC ISO-8601 timestamp |

## Example

```ts
import { UsageAcceptance } from 'stood-platform-apilib';

const usageAcceptance: UsageAcceptance = {
  trancheId: 'tranche_id4',
  commit: 'commit6',
  status: 'ACCEPTED',
  acceptedAt: 'accepted_at2',
};
```

