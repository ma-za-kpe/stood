
# Custom Header Signature



Documentation for accessing and setting credentials for requestSignature.

## Auth Credentials

| Name | Type | Description | Setter |
|  --- | --- | --- | --- |
| Stood-Signature | `string` | t=<unix seconds>,v2=<hex HMAC-SHA256(secret, JSON ["stood.request@2", t, method, "/v1"+path+query, Idempotency-Key, If-Match, Content-Type, body])> | `stoodSignature` |



**Note:** Auth credentials can be set using `requestSignatureCredentials` object in the client.

## Usage Example

### Client Initialization

You must provide credentials in the client as shown in the following code snippet.

```ts
import { Client } from 'stood-platform-apilib';

const client = new Client({
  requestSignatureCredentials: {
    'Stood-Signature': 'Stood-Signature'
  },
});
```


