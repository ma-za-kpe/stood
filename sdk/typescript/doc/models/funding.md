
# Funding

## Structure

`Funding`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `key` | `string` | Required | - |
| `status` | [`FundingStatus`](../../doc/models/funding-status.md) | Required | - |
| `approveUrl` | `string \| null` | Required | - |
| `holdExpiresAt` | `number \| null` | Required | Only while HELD: when the hold lapses, Unix milliseconds<br><br>**Constraints**: `>= -9007199254740991`, `<= 9007199254740991` |

## Example

```ts
import { Funding, FundingStatus } from 'stood-platform-apilib';

const funding: Funding = {
  key: 'key4',
  status: FundingStatus.Held,
  approveUrl: 'approve_url0',
  holdExpiresAt: 144,
};
```

