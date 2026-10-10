
# Mandate

## Structure

`Mandate`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `key` | `string` | Required | - |
| `status` | [`MandateStatus`](../../doc/models/mandate-status.md) | Required | - |
| `approveUrl` | `string \| null` | Required | Only while AWAITING_APPROVAL: where the buyer approves |
| `expiresAt` | `number` | Required | When the signing request lapses, Unix milliseconds<br><br>**Constraints**: `>= -9007199254740991`, `<= 9007199254740991` |

## Example

```ts
import { Mandate, MandateStatus } from 'stood-platform-apilib';

const mandate: Mandate = {
  key: 'key6',
  status: MandateStatus.Signed,
  approveUrl: 'approve_url2',
  expiresAt: 78,
};
```

