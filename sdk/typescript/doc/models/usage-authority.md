
# Usage Authority

A key Stood is configured to trust, outside the builder's tree

## Structure

`UsageAuthority`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `keyId` | `string` | Required | **Constraints**: *Maximum Length*: `64` |
| `root` | `string` | Required | **Constraints**: *Maximum Length*: `100` |

## Example

```ts
import { UsageAuthority } from 'stood-platform-apilib';

const usageAuthority: UsageAuthority = {
  keyId: 'keyId2',
  root: 'root8',
};
```

