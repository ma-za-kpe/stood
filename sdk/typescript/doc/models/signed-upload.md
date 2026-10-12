
# Signed Upload

## Structure

`SignedUpload`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `key` | `string` | Required | - |
| `url` | `string` | Required | - |
| `headers` | `Record<string, string>` | Required | - |

## Example

```ts
import { SignedUpload } from 'stood-platform-apilib';

const signedUpload: SignedUpload = {
  key: 'key4',
  url: 'url8',
  headers: {
    'key0': 'headers7',
    'key1': 'headers8',
    'key2': 'headers9'
  },
};
```

