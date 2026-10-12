
# Upload Photo

## Structure

`UploadPhoto`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `sha256` | `string` | Required | **Constraints**: *Pattern*: `^[a-f0-9]{64}$` |
| `bytes` | `number` | Required | **Constraints**: `>= 1`, `<= 8388608` |
| `contentType` | [`PhotoContentType`](../../doc/models/photo-content-type.md) | Required | - |

## Example

```ts
import { PhotoContentType, UploadPhoto } from 'stood-platform-apilib';

const uploadPhoto: UploadPhoto = {
  sha256: 'sha2566',
  bytes: 180,
  contentType: PhotoContentType.EnumImagejpeg,
};
```

