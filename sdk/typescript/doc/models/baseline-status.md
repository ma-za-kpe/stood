
# Baseline Status

QUEUED until Stood has run it; INVALID when the frozen tests are not at the base commit as described

## Enumeration

`BaselineStatus`

## Fields

| Name |
|  --- |
| `Queued` |
| `Done` |
| `Invalid` |

## Example

```ts
import { BaselineStatus } from 'stood-platform-apilib';

const baselineStatus = BaselineStatus.Queued;
```

