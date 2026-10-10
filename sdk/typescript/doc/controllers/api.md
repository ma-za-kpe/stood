# API

```ts
const api = new Api(client);
```

## Class Name

`Api`

## Methods

* [Create Allowance](../../doc/controllers/api.md#create-allowance)
* [Get Allowance](../../doc/controllers/api.md#get-allowance)
* [Request Mandate](../../doc/controllers/api.md#request-mandate)
* [Get Mandate](../../doc/controllers/api.md#get-mandate)
* [Request Baseline](../../doc/controllers/api.md#request-baseline)
* [Get Baseline](../../doc/controllers/api.md#get-baseline)
* [Get Tranche](../../doc/controllers/api.md#get-tranche)
* [Request Funding](../../doc/controllers/api.md#request-funding)
* [Get Funding](../../doc/controllers/api.md#get-funding)
* [Submit Package](../../doc/controllers/api.md#submit-package)
* [Get Package](../../doc/controllers/api.md#get-package)


# Create Allowance

```ts
async createAllowance(
  idempotencyKey: string,
  body: AllowanceDraft,
  requestOptions?: RequestOptions
): Promise<ApiResponse<Allowance>>
```

## Authentication

This endpoint requires [platformKey](../../doc/auth/oauth-2-bearer-token.md) **AND** [requestSignature](../../doc/auth/custom-header-signature.md)

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `idempotencyKey` | `string` | Header, Required | Same key and body return the same response; a different body is 409<br><br>**Constraints**: *Maximum Length*: `200` |
| `body` | [`AllowanceDraft`](../../doc/models/allowance-draft.md) | Body, Required | - |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**201**: OK

This method returns an [`ApiResponse`](../../doc/api-response.md) instance. The `result` property of this instance returns the response data which is of type [`Allowance`](../../doc/models/allowance.md).

## Example Usage

```ts
const idempotencyKey = 'Idempotency-Key0';

const body: AllowanceDraft = {
  payeeRef: 'payee_ref2',
  cap: {
    minor: 48,
    currency: 'currency4',
  },
  milestones: [
    {
      name: 'name8',
      amount: {
        minor: 124,
        currency: 'currency2',
      },
      profile: 'profile8',
    }
  ],
  windowDays: 224,
  maxResubmits: 32,
};

try {
  const response = await api.createAllowance(
    idempotencyKey,
    body
  );

  // Extracting fully parsed response body.
  console.log(response.result);

  // Extracting response status code.
  console.log(response.statusCode);
  // Extracting response headers.
  console.log(response.headers);
  // Extracting response body of type `string | Stream`
  console.log(response.body);
} catch (error) {
  if (error instanceof ApiError) {
    // Extracting response error status code.
    console.log(error.statusCode);
    // Extracting response error headers.
    console.log(error.headers);
    // Extracting response error body of type `string | Stream`.
    console.log(error.body);
    if (error instanceof ProblemError) {
      console.log(error.result);
    }
  }
}
```

## Errors

| HTTP Status Code | Error Description | Exception Class |
|  --- | --- | --- |
| 401 | Missing or invalid platform key or signature | [`ProblemError`](../../doc/models/problem-error.md) |
| 409 | Idempotency or version conflict | [`ProblemError`](../../doc/models/problem-error.md) |
| 413 | Body over 64 KiB | [`ProblemError`](../../doc/models/problem-error.md) |
| 422 | Invalid request | [`ProblemError`](../../doc/models/problem-error.md) |
| 503 | Storage or the feature is unavailable; retry with the same idempotency key | [`ProblemError`](../../doc/models/problem-error.md) |


# Get Allowance

```ts
async getAllowance(
  id: string,
  requestOptions?: RequestOptions
): Promise<ApiResponse<Allowance>>
```

## Authentication

This endpoint requires [platformKey](../../doc/auth/oauth-2-bearer-token.md) **AND** [requestSignature](../../doc/auth/custom-header-signature.md)

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `id` | `string` | Template, Required | - |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**200**: OK

This method returns an [`ApiResponse`](../../doc/api-response.md) instance. The `result` property of this instance returns the response data which is of type [`Allowance`](../../doc/models/allowance.md).

## Example Usage

```ts
const id = 'id0';

try {
  const response = await api.getAllowance(id);

  // Extracting fully parsed response body.
  console.log(response.result);

  // Extracting response status code.
  console.log(response.statusCode);
  // Extracting response headers.
  console.log(response.headers);
  // Extracting response body of type `string | Stream`
  console.log(response.body);
} catch (error) {
  if (error instanceof ApiError) {
    // Extracting response error status code.
    console.log(error.statusCode);
    // Extracting response error headers.
    console.log(error.headers);
    // Extracting response error body of type `string | Stream`.
    console.log(error.body);
    if (error instanceof ProblemError) {
      console.log(error.result);
    }
  }
}
```

## Errors

| HTTP Status Code | Error Description | Exception Class |
|  --- | --- | --- |
| 401 | Missing or invalid platform key or signature | [`ProblemError`](../../doc/models/problem-error.md) |
| 404 | Not found, or not owned by this platform | [`ProblemError`](../../doc/models/problem-error.md) |


# Request Mandate

```ts
async requestMandate(
  id: string,
  idempotencyKey: string,
  body: unknown,
  requestOptions?: RequestOptions
): Promise<ApiResponse<Mandate>>
```

## Authentication

This endpoint requires [platformKey](../../doc/auth/oauth-2-bearer-token.md) **AND** [requestSignature](../../doc/auth/custom-header-signature.md)

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `id` | `string` | Template, Required | - |
| `idempotencyKey` | `string` | Header, Required | Same key and body return the same response; a different body is 409<br><br>**Constraints**: *Maximum Length*: `200` |
| `body` | `unknown` | Body, Required | - |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**202**: Accepted (recorded, not yet done)

This method returns an [`ApiResponse`](../../doc/api-response.md) instance. The `result` property of this instance returns the response data which is of type [`Mandate`](../../doc/models/mandate.md).

## Example Usage

```ts
const id = 'id0';

const idempotencyKey = 'Idempotency-Key0';

const body = { 'key1': 'val1', 'key2': 'val2' };

try {
  const response = await api.requestMandate(
    id,
    idempotencyKey,
    body
  );

  // Extracting fully parsed response body.
  console.log(response.result);

  // Extracting response status code.
  console.log(response.statusCode);
  // Extracting response headers.
  console.log(response.headers);
  // Extracting response body of type `string | Stream`
  console.log(response.body);
} catch (error) {
  if (error instanceof ApiError) {
    // Extracting response error status code.
    console.log(error.statusCode);
    // Extracting response error headers.
    console.log(error.headers);
    // Extracting response error body of type `string | Stream`.
    console.log(error.body);
    if (error instanceof ProblemError) {
      console.log(error.result);
    }
  }
}
```

## Errors

| HTTP Status Code | Error Description | Exception Class |
|  --- | --- | --- |
| 401 | Missing or invalid platform key or signature | [`ProblemError`](../../doc/models/problem-error.md) |
| 404 | Not found, or not owned by this platform | [`ProblemError`](../../doc/models/problem-error.md) |
| 409 | Idempotency or version conflict | [`ProblemError`](../../doc/models/problem-error.md) |
| 422 | Invalid request | [`ProblemError`](../../doc/models/problem-error.md) |
| 503 | Storage or the feature is unavailable; retry with the same idempotency key | [`ProblemError`](../../doc/models/problem-error.md) |


# Get Mandate

```ts
async getMandate(
  id: string,
  key: string,
  requestOptions?: RequestOptions
): Promise<ApiResponse<Mandate>>
```

## Authentication

This endpoint requires [platformKey](../../doc/auth/oauth-2-bearer-token.md) **AND** [requestSignature](../../doc/auth/custom-header-signature.md)

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `id` | `string` | Template, Required | - |
| `key` | `string` | Template, Required | - |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**200**: OK

This method returns an [`ApiResponse`](../../doc/api-response.md) instance. The `result` property of this instance returns the response data which is of type [`Mandate`](../../doc/models/mandate.md).

## Example Usage

```ts
const id = 'id0';

const key = 'key0';

try {
  const response = await api.getMandate(
    id,
    key
  );

  // Extracting fully parsed response body.
  console.log(response.result);

  // Extracting response status code.
  console.log(response.statusCode);
  // Extracting response headers.
  console.log(response.headers);
  // Extracting response body of type `string | Stream`
  console.log(response.body);
} catch (error) {
  if (error instanceof ApiError) {
    // Extracting response error status code.
    console.log(error.statusCode);
    // Extracting response error headers.
    console.log(error.headers);
    // Extracting response error body of type `string | Stream`.
    console.log(error.body);
    if (error instanceof ProblemError) {
      console.log(error.result);
    }
  }
}
```

## Errors

| HTTP Status Code | Error Description | Exception Class |
|  --- | --- | --- |
| 401 | Missing or invalid platform key or signature | [`ProblemError`](../../doc/models/problem-error.md) |
| 404 | Not found, or not owned by this platform | [`ProblemError`](../../doc/models/problem-error.md) |
| 503 | Storage or the feature is unavailable; retry with the same idempotency key | [`ProblemError`](../../doc/models/problem-error.md) |


# Request Baseline

```ts
async requestBaseline(
  idempotencyKey: string,
  body: CodeTerms,
  requestOptions?: RequestOptions
): Promise<ApiResponse<Baseline>>
```

## Authentication

This endpoint requires [platformKey](../../doc/auth/oauth-2-bearer-token.md) **AND** [requestSignature](../../doc/auth/custom-header-signature.md)

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `idempotencyKey` | `string` | Header, Required | Same key and body return the same response; a different body is 409<br><br>**Constraints**: *Maximum Length*: `200` |
| `body` | [`CodeTerms`](../../doc/models/code-terms.md) | Body, Required | - |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**202**: Accepted (recorded, not yet done)

This method returns an [`ApiResponse`](../../doc/api-response.md) instance. The `result` property of this instance returns the response data which is of type [`Baseline`](../../doc/models/baseline.md).

## Example Usage

```ts
const idempotencyKey = 'Idempotency-Key0';

const body: CodeTerms = {
  repository: 'repository6',
  baseCommit: 'baseCommit8',
  testBundleHash: 'testBundleHash2',
  manifestHash: 'manifestHash4',
  testIds: [
    'testIds9'
  ],
  tests: [
    {
      id: 'id6',
      path: 'path0',
    }
  ],
};

try {
  const response = await api.requestBaseline(
    idempotencyKey,
    body
  );

  // Extracting fully parsed response body.
  console.log(response.result);

  // Extracting response status code.
  console.log(response.statusCode);
  // Extracting response headers.
  console.log(response.headers);
  // Extracting response body of type `string | Stream`
  console.log(response.body);
} catch (error) {
  if (error instanceof ApiError) {
    // Extracting response error status code.
    console.log(error.statusCode);
    // Extracting response error headers.
    console.log(error.headers);
    // Extracting response error body of type `string | Stream`.
    console.log(error.body);
    if (error instanceof ProblemError) {
      console.log(error.result);
    }
  }
}
```

## Errors

| HTTP Status Code | Error Description | Exception Class |
|  --- | --- | --- |
| 401 | Missing or invalid platform key or signature | [`ProblemError`](../../doc/models/problem-error.md) |
| 409 | Idempotency or version conflict | [`ProblemError`](../../doc/models/problem-error.md) |
| 413 | Body over 64 KiB | [`ProblemError`](../../doc/models/problem-error.md) |
| 422 | Invalid request | [`ProblemError`](../../doc/models/problem-error.md) |
| 503 | Storage or the feature is unavailable; retry with the same idempotency key | [`ProblemError`](../../doc/models/problem-error.md) |


# Get Baseline

```ts
async getBaseline(
  id: string,
  requestOptions?: RequestOptions
): Promise<ApiResponse<Baseline>>
```

## Authentication

This endpoint requires [platformKey](../../doc/auth/oauth-2-bearer-token.md) **AND** [requestSignature](../../doc/auth/custom-header-signature.md)

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `id` | `string` | Template, Required | - |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**200**: OK

This method returns an [`ApiResponse`](../../doc/api-response.md) instance. The `result` property of this instance returns the response data which is of type [`Baseline`](../../doc/models/baseline.md).

## Example Usage

```ts
const id = 'id0';

try {
  const response = await api.getBaseline(id);

  // Extracting fully parsed response body.
  console.log(response.result);

  // Extracting response status code.
  console.log(response.statusCode);
  // Extracting response headers.
  console.log(response.headers);
  // Extracting response body of type `string | Stream`
  console.log(response.body);
} catch (error) {
  if (error instanceof ApiError) {
    // Extracting response error status code.
    console.log(error.statusCode);
    // Extracting response error headers.
    console.log(error.headers);
    // Extracting response error body of type `string | Stream`.
    console.log(error.body);
    if (error instanceof ProblemError) {
      console.log(error.result);
    }
  }
}
```

## Errors

| HTTP Status Code | Error Description | Exception Class |
|  --- | --- | --- |
| 401 | Missing or invalid platform key or signature | [`ProblemError`](../../doc/models/problem-error.md) |
| 404 | Not found, or not owned by this platform | [`ProblemError`](../../doc/models/problem-error.md) |
| 503 | Storage or the feature is unavailable; retry with the same idempotency key | [`ProblemError`](../../doc/models/problem-error.md) |


# Get Tranche

```ts
async getTranche(
  id: string,
  requestOptions?: RequestOptions
): Promise<ApiResponse<Tranche>>
```

## Authentication

This endpoint requires [platformKey](../../doc/auth/oauth-2-bearer-token.md) **AND** [requestSignature](../../doc/auth/custom-header-signature.md)

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `id` | `string` | Template, Required | - |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**200**: OK

This method returns an [`ApiResponse`](../../doc/api-response.md) instance. The `result` property of this instance returns the response data which is of type [`Tranche`](../../doc/models/tranche.md).

## Example Usage

```ts
const id = 'id0';

try {
  const response = await api.getTranche(id);

  // Extracting fully parsed response body.
  console.log(response.result);

  // Extracting response status code.
  console.log(response.statusCode);
  // Extracting response headers.
  console.log(response.headers);
  // Extracting response body of type `string | Stream`
  console.log(response.body);
} catch (error) {
  if (error instanceof ApiError) {
    // Extracting response error status code.
    console.log(error.statusCode);
    // Extracting response error headers.
    console.log(error.headers);
    // Extracting response error body of type `string | Stream`.
    console.log(error.body);
    if (error instanceof ProblemError) {
      console.log(error.result);
    }
  }
}
```

## Errors

| HTTP Status Code | Error Description | Exception Class |
|  --- | --- | --- |
| 401 | Missing or invalid platform key or signature | [`ProblemError`](../../doc/models/problem-error.md) |
| 404 | Not found, or not owned by this platform | [`ProblemError`](../../doc/models/problem-error.md) |


# Request Funding

```ts
async requestFunding(
  id: string,
  idempotencyKey: string,
  body: FundingRequest,
  requestOptions?: RequestOptions
): Promise<ApiResponse<Funding>>
```

## Authentication

This endpoint requires [platformKey](../../doc/auth/oauth-2-bearer-token.md) **AND** [requestSignature](../../doc/auth/custom-header-signature.md)

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `id` | `string` | Template, Required | - |
| `idempotencyKey` | `string` | Header, Required | Same key and body return the same response; a different body is 409<br><br>**Constraints**: *Maximum Length*: `200` |
| `body` | [`FundingRequest`](../../doc/models/funding-request.md) | Body, Required | - |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**202**: Accepted (recorded, not yet done)

This method returns an [`ApiResponse`](../../doc/api-response.md) instance. The `result` property of this instance returns the response data which is of type [`Funding`](../../doc/models/funding.md).

## Example Usage

```ts
const id = 'id0';

const idempotencyKey = 'Idempotency-Key0';

const body: FundingRequest = {
  expectedVersion: 114,
  nonce: 'nonce8',
};

try {
  const response = await api.requestFunding(
    id,
    idempotencyKey,
    body
  );

  // Extracting fully parsed response body.
  console.log(response.result);

  // Extracting response status code.
  console.log(response.statusCode);
  // Extracting response headers.
  console.log(response.headers);
  // Extracting response body of type `string | Stream`
  console.log(response.body);
} catch (error) {
  if (error instanceof ApiError) {
    // Extracting response error status code.
    console.log(error.statusCode);
    // Extracting response error headers.
    console.log(error.headers);
    // Extracting response error body of type `string | Stream`.
    console.log(error.body);
    if (error instanceof ProblemError) {
      console.log(error.result);
    }
  }
}
```

## Errors

| HTTP Status Code | Error Description | Exception Class |
|  --- | --- | --- |
| 401 | Missing or invalid platform key or signature | [`ProblemError`](../../doc/models/problem-error.md) |
| 404 | Not found, or not owned by this platform | [`ProblemError`](../../doc/models/problem-error.md) |
| 409 | Idempotency or version conflict | [`ProblemError`](../../doc/models/problem-error.md) |
| 422 | Invalid request | [`ProblemError`](../../doc/models/problem-error.md) |
| 503 | Storage or the feature is unavailable; retry with the same idempotency key | [`ProblemError`](../../doc/models/problem-error.md) |


# Get Funding

```ts
async getFunding(
  id: string,
  key: string,
  requestOptions?: RequestOptions
): Promise<ApiResponse<Funding>>
```

## Authentication

This endpoint requires [platformKey](../../doc/auth/oauth-2-bearer-token.md) **AND** [requestSignature](../../doc/auth/custom-header-signature.md)

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `id` | `string` | Template, Required | - |
| `key` | `string` | Template, Required | - |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**200**: OK

This method returns an [`ApiResponse`](../../doc/api-response.md) instance. The `result` property of this instance returns the response data which is of type [`Funding`](../../doc/models/funding.md).

## Example Usage

```ts
const id = 'id0';

const key = 'key0';

try {
  const response = await api.getFunding(
    id,
    key
  );

  // Extracting fully parsed response body.
  console.log(response.result);

  // Extracting response status code.
  console.log(response.statusCode);
  // Extracting response headers.
  console.log(response.headers);
  // Extracting response body of type `string | Stream`
  console.log(response.body);
} catch (error) {
  if (error instanceof ApiError) {
    // Extracting response error status code.
    console.log(error.statusCode);
    // Extracting response error headers.
    console.log(error.headers);
    // Extracting response error body of type `string | Stream`.
    console.log(error.body);
    if (error instanceof ProblemError) {
      console.log(error.result);
    }
  }
}
```

## Errors

| HTTP Status Code | Error Description | Exception Class |
|  --- | --- | --- |
| 401 | Missing or invalid platform key or signature | [`ProblemError`](../../doc/models/problem-error.md) |
| 404 | Not found, or not owned by this platform | [`ProblemError`](../../doc/models/problem-error.md) |
| 503 | Storage or the feature is unavailable; retry with the same idempotency key | [`ProblemError`](../../doc/models/problem-error.md) |


# Submit Package

```ts
async submitPackage(
  id: string,
  idempotencyKey: string,
  body: CommitPackageInput,
  requestOptions?: RequestOptions
): Promise<ApiResponse<CommitPackage>>
```

## Authentication

This endpoint requires [platformKey](../../doc/auth/oauth-2-bearer-token.md) **AND** [requestSignature](../../doc/auth/custom-header-signature.md)

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `id` | `string` | Template, Required | - |
| `idempotencyKey` | `string` | Header, Required | Same key and body return the same response; a different body is 409<br><br>**Constraints**: *Maximum Length*: `200` |
| `body` | [`CommitPackageInput`](../../doc/models/commit-package-input.md) | Body, Required | - |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**202**: Accepted (recorded, not yet done)

This method returns an [`ApiResponse`](../../doc/api-response.md) instance. The `result` property of this instance returns the response data which is of type [`CommitPackage`](../../doc/models/commit-package.md).

## Example Usage

```ts
const id = 'id0';

const idempotencyKey = 'Idempotency-Key0';

const body: CommitPackageInput = {
  repository: 'repository6',
  baseCommit: 'base_commit8',
  commitSha: 'commit_sha0',
  reportRef: 'report_ref4',
  reportSha256: 'report_sha2562',
};

try {
  const response = await api.submitPackage(
    id,
    idempotencyKey,
    body
  );

  // Extracting fully parsed response body.
  console.log(response.result);

  // Extracting response status code.
  console.log(response.statusCode);
  // Extracting response headers.
  console.log(response.headers);
  // Extracting response body of type `string | Stream`
  console.log(response.body);
} catch (error) {
  if (error instanceof ApiError) {
    // Extracting response error status code.
    console.log(error.statusCode);
    // Extracting response error headers.
    console.log(error.headers);
    // Extracting response error body of type `string | Stream`.
    console.log(error.body);
    if (error instanceof ProblemError) {
      console.log(error.result);
    }
  }
}
```

## Errors

| HTTP Status Code | Error Description | Exception Class |
|  --- | --- | --- |
| 401 | Missing or invalid platform key or signature | [`ProblemError`](../../doc/models/problem-error.md) |
| 404 | Not found, or not owned by this platform | [`ProblemError`](../../doc/models/problem-error.md) |
| 409 | Idempotency or version conflict | [`ProblemError`](../../doc/models/problem-error.md) |
| 422 | Invalid request | [`ProblemError`](../../doc/models/problem-error.md) |
| 503 | Storage or the feature is unavailable; retry with the same idempotency key | [`ProblemError`](../../doc/models/problem-error.md) |


# Get Package

```ts
async getPackage(
  id: string,
  packageId: string,
  requestOptions?: RequestOptions
): Promise<ApiResponse<CommitPackage>>
```

## Authentication

This endpoint requires [platformKey](../../doc/auth/oauth-2-bearer-token.md) **AND** [requestSignature](../../doc/auth/custom-header-signature.md)

## Parameters

| Parameter | Type | Tags | Description |
|  --- | --- | --- | --- |
| `id` | `string` | Template, Required | - |
| `packageId` | `string` | Template, Required | - |
| `requestOptions` | `RequestOptions \| undefined` | Optional | Pass additional request options. |

## Response Type

**200**: OK

This method returns an [`ApiResponse`](../../doc/api-response.md) instance. The `result` property of this instance returns the response data which is of type [`CommitPackage`](../../doc/models/commit-package.md).

## Example Usage

```ts
const id = 'id0';

const packageId = 'packageId4';

try {
  const response = await api.getPackage(
    id,
    packageId
  );

  // Extracting fully parsed response body.
  console.log(response.result);

  // Extracting response status code.
  console.log(response.statusCode);
  // Extracting response headers.
  console.log(response.headers);
  // Extracting response body of type `string | Stream`
  console.log(response.body);
} catch (error) {
  if (error instanceof ApiError) {
    // Extracting response error status code.
    console.log(error.statusCode);
    // Extracting response error headers.
    console.log(error.headers);
    // Extracting response error body of type `string | Stream`.
    console.log(error.body);
    if (error instanceof ProblemError) {
      console.log(error.result);
    }
  }
}
```

## Errors

| HTTP Status Code | Error Description | Exception Class |
|  --- | --- | --- |
| 401 | Missing or invalid platform key or signature | [`ProblemError`](../../doc/models/problem-error.md) |
| 404 | Not found, or not owned by this platform | [`ProblemError`](../../doc/models/problem-error.md) |
| 503 | Storage or the feature is unavailable; retry with the same idempotency key | [`ProblemError`](../../doc/models/problem-error.md) |

