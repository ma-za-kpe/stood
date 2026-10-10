
# Pending Payment Operation

## Structure

`PendingPaymentOperation`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `effect` | `string` | Required | - |
| `status` | `string` | Required | - |
| `createdAt` | `string` | Required | UTC ISO-8601 timestamp |

## Example

```ts
import { PendingPaymentOperation } from 'stood-platform-apilib';

const pendingPaymentOperation: PendingPaymentOperation = {
  effect: 'effect4',
  status: 'status2',
  createdAt: 'created_at8',
};
```

