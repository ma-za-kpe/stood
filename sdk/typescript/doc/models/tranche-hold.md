
# Tranche Hold

*This model accepts additional fields of type unknown.*

## Structure

`TrancheHold`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `ageSeconds` | `number` | Required | **Constraints**: `>= 0`, `<= 9007199254740991` |
| `expiresAt` | `string` | Required | UTC ISO-8601 timestamp |
| `additionalProperties` | `Record<string, unknown>` | Optional | - |

## Example

```ts
import { TrancheHold } from 'stood-platform-apilib';

const trancheHold: TrancheHold = {
  ageSeconds: 36,
  expiresAt: 'expires_at6',
  additionalProperties: {
    'exampleAdditionalProperty': { 'key1': 'val1', 'key2': 'val2' }
  },
};
```

