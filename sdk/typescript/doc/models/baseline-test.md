
# Baseline Test

## Structure

`BaselineTest`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `id` | `string` | Required | - |
| `status` | [`BaselineTestStatus`](../../doc/models/baseline-test-status.md) | Required | - |

## Example

```ts
import { BaselineTest, BaselineTestStatus } from 'stood-platform-apilib';

const baselineTest: BaselineTest = {
  id: 'id6',
  status: BaselineTestStatus.Pass,
};
```

