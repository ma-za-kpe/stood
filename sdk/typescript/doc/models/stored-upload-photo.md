
# Stored Upload Photo

## Structure

`StoredUploadPhoto`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `sha256` | `string` | Required | **Constraints**: *Pattern*: `^[a-f0-9]{64}$` |
| `bytes` | `number` | Required | **Constraints**: `>= 1`, `<= 8388608` |
| `contentType` | [`PhotoContentType`](../../doc/models/photo-content-type.md) | Required | - |
| `key` | `string` | Required | - |

## Example

```ts
import { PhotoContentType, StoredUploadPhoto } from 'stood-platform-apilib';

const storedUploadPhoto: StoredUploadPhoto = {
  sha256: 'sha2562',
  bytes: 220,
  contentType: PhotoContentType.EnumImagejpeg,
  key: 'key0',
};
```

