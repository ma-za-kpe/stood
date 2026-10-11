# Signing requests

Stood holds a buyer's money per milestone on PayPal (sandbox only) and releases it only on evidence. Every request to the platform API is signed, so only your platform can ask Stood to move money.

## Every request carries

| Header | Value |
| --- | --- |
| `Authorization` | `Bearer <your platform key>` |
| `Stood-Signature` | `t=<unix seconds>,v2=<hex HMAC-SHA256>` |
| `Content-Type` | `application/json` |
| `Idempotency-Key` | on every write: the same key for a retry of the same request |
| `If-Match` | where a route asks for the version you read |

The signature is HMAC-SHA256 with your platform secret over the UTF-8 bytes of:

```text
JSON.stringify(["stood.request@2", timestamp, method, target, idempotencyKey, ifMatch, contentType, rawBody])
```

- `timestamp` is the same unix seconds as in the header, within five minutes of Stood's clock.
- `method` is uppercase; `target` is the path and query as sent, including `/v1`.
- Absent headers are empty strings; a GET has an empty body.
- Do not reformat the body after signing.

## Limits

- Bodies are at most 64 KiB.
- Each platform may make **120 writes and 600 reads a minute**. Over that, Stood answers `429 rate_limited` with `Retry-After` in seconds. After 30 failed sign-ins from one address in a minute, that address gets `429` until the minute ends.

## Why there is no "Try it out"

The browser cannot sign with your platform secret without exposing it, so the console is off. Use the TypeScript SDK or `@stood/stood-sdk`, which sign each request for you.

## Errors

Every error is an RFC 9457 problem (`application/problem+json`) with a stable `code`: `unauthorized`, `not_found`, `idempotency_conflict`, `stale_version`, `validation`, `payload_too_large`, `rate_limited`, `storage_unavailable`.

The live contract is served at <https://stood-api.onrender.com/v1/openapi.json>.
