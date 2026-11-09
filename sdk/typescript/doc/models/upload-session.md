
# Upload Session

COMPLETE means owned bytes, size, hash and format header checked; signed assessment receipts are audit-only and grant no payment authority. URLs are derived short-lived capabilities, not persisted receipts.

## Structure

`UploadSession`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `id` | `string` | Required | **Constraints**: *Minimum Length*: `1`, *Maximum Length*: `200` |
| `trancheId` | `string` | Required | **Constraints**: *Minimum Length*: `1`, *Maximum Length*: `200` |
| `allowanceId` | `string \| null` | Required | **Constraints**: *Minimum Length*: `1`, *Maximum Length*: `200` |
| `termsVersion` | `number \| null` | Required | **Constraints**: `>= -9007199254740991`, `<= 9007199254740991` |
| `assessmentNonce` | `string \| null` | Required | **Constraints**: *Pattern*: `^[a-f0-9]{64}$` |
| `status` | [`UploadStatus`](../../doc/models/upload-status.md) | Required | - |
| `photos` | [`StoredUploadPhoto[]`](../../doc/models/stored-upload-photo.md) | Required | **Constraints**: *Minimum Items*: `1`, *Maximum Items*: `10` |
| `expiresAt` | `number` | Required | **Constraints**: `>= -9007199254740991`, `<= 9007199254740991` |
| `completedAt` | `number \| null` | Required | **Constraints**: `>= -9007199254740991`, `<= 9007199254740991` |
| `uploads` | [`SignedUpload[]`](../../doc/models/signed-upload.md) | Required | **Constraints**: *Maximum Items*: `10` |

## Example

```ts
import {
  PhotoContentType,
  UploadSession,
  UploadStatus,
} from 'stood-platform-apilib';

const uploadSession: UploadSession = {
  id: 'id6',
  trancheId: 'trancheId4',
  allowanceId: 'allowanceId8',
  termsVersion: 16,
  assessmentNonce: 'assessmentNonce2',
  status: UploadStatus.Open,
  photos: [
    {
      sha256: 'sha2560',
      bytes: 234,
      contentType: PhotoContentType.EnumImagewebp,
      key: 'key8',
    }
  ],
  expiresAt: 230,
  completedAt: 2,
  uploads: [
    {
      key: 'key2',
      url: 'url6',
      headers: {
        'key0': 'headers5'
      },
    }
  ],
};
```

