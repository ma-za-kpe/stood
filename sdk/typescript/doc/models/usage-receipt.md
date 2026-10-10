
# Usage Receipt

The buyer's signed confirmation that a final milestone is in use

## Structure

`UsageReceipt`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `version` | `number` | Required, Constant | **Value**: `1` |
| `allowanceId` | `string` | Required | **Constraints**: *Minimum Length*: `1`, *Maximum Length*: `200` |
| `trancheId` | `string` | Required | **Constraints**: *Minimum Length*: `1`, *Maximum Length*: `200` |
| `commit` | `string` | Required | The tranche's latest submitted package commit<br><br>**Constraints**: *Pattern*: `^[a-f0-9]{40}$` |
| `authority` | [`UsageAuthority`](../../doc/models/usage-authority.md) | Required | A key Stood is configured to trust, outside the builder's tree |
| `observedAt` | `number` | Required | When the buyer confirmed use, Unix milliseconds (within 24 hours)<br><br>**Constraints**: `>= -9007199254740991`, `<= 9007199254740991` |
| `nonce` | `string` | Required | **Constraints**: *Pattern*: `^[A-Za-z0-9_-]{16,200}$` |
| `signature` | `string` | Required | Base64 Ed25519 signature over "stood-usage-receipt/v1", allowanceId, trancheId, commit, keyId, root, observedAt and nonce, joined by NUL<br><br>**Constraints**: *Maximum Length*: `200` |

## Example

```ts
import { UsageReceipt } from 'stood-platform-apilib';

const usageReceipt: UsageReceipt = {
  version: 1,
  allowanceId: 'allowanceId8',
  trancheId: 'trancheId4',
  commit: 'commit8',
  authority: {
    keyId: 'keyId6',
    root: 'root2',
  },
  observedAt: 240,
  nonce: 'nonce8',
  signature: 'signature4',
};
```

