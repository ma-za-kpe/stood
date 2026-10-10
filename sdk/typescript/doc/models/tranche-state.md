
# Tranche State

## Enumeration

`TrancheState`

## Fields

| Name |
|  --- |
| `Pending` |
| `WaitFunding` |
| `Held` |
| `Deciding` |
| `Waiting` |
| `CapturePending` |
| `VoidPending` |
| `ReauthorizePending` |
| `Released` |
| `Refused` |
| `Expired` |
| `Cancelled` |
| `Disputed` |

## Example

```ts
import { TrancheState } from 'stood-platform-apilib';

const trancheState = TrancheState.WaitFunding;
```

