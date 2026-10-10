
# Funding Request

## Structure

`FundingRequest`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `expectedVersion` | `number` | Required | The tranche version just read<br><br>**Constraints**: `>= 0`, `<= 9007199254740991` |
| `nonce` | `string` | Required | **Constraints**: *Pattern*: `^[A-HJ-NP-Z2-9]{3}$` |

## Example

```ts
import { FundingRequest } from 'stood-platform-apilib';

const fundingRequest: FundingRequest = {
  expectedVersion: 24,
  nonce: 'nonce4',
};
```

