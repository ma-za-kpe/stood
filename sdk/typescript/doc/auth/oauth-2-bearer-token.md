
# OAuth 2 Bearer token



Documentation for accessing and setting credentials for platformKey.

## Auth Credentials

| Name | Type | Description | Setter |
|  --- | --- | --- | --- |
| accessToken | `string` | The OAuth 2.0 Access Token to use for API requests. | `accessToken` |



**Note:** Auth credentials can be set using `platformKeyCredentials` object in the client.

## Usage Example

### Client Initialization

You must provide credentials in the client as shown in the following code snippet.

```ts
import { Client } from 'stood-platform-apilib';

const client = new Client({
  platformKeyCredentials: {
    accessToken: 'AccessToken'
  },
});
```


