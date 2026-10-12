
# Upload Input

## Structure

`UploadInput`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `photos` | [`UploadPhoto[]`](../../doc/models/upload-photo.md) | Required | **Constraints**: *Minimum Items*: `1`, *Maximum Items*: `10` |

## Example

```ts
import { PhotoContentType, UploadInput } from 'stood-platform-apilib';

const uploadInput: UploadInput = {
  photos: [
    {
      sha256: 'sha2560',
      bytes: 234,
      contentType: PhotoContentType.EnumImagewebp,
    }
  ],
};
```

