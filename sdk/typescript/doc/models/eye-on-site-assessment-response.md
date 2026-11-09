
# Eye on Site Assessment Response

Authenticated EyeOnSite evidence retained for audit only; it has no payment or milestone decision authority.

## Structure

`EyeOnSiteAssessmentResponse`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `receipt` | `Record<string, unknown>` | Required | - |
| `authority` | `string` | Required, Constant | **Value**: `'AUDIT_ONLY'` |

## Example

```ts
import { EyeOnSiteAssessmentResponse } from 'stood-platform-apilib';

const eyeOnSiteAssessmentResponse: EyeOnSiteAssessmentResponse = {
  receipt: {
    'key0': { 'key1': 'val1', 'key2': 'val2' },
    'key1': { 'key1': 'val1', 'key2': 'val2' },
    'key2': { 'key1': 'val1', 'key2': 'val2' }
  },
  authority: 'AUDIT_ONLY',
};
```

