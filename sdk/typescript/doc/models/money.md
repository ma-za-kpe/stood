
# Money

## Structure

`Money`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `minor` | `number` | Required | Amount in minor units (cents)<br><br>**Constraints**: `>= -9007199254740991`, `<= 9007199254740991` |
| `currency` | `string` | Required | **Constraints**: *Minimum Length*: `3`, *Maximum Length*: `3` |

## Example

```ts
import { Money } from 'stood-platform-apilib';

const money: Money = {
  minor: 124,
  currency: 'currency8',
};
```

