
# Problem Error

RFC 9457 problem details

*This model accepts additional fields of type unknown.*

## Structure

`ProblemError`

## Fields

| Name | Type | Tags | Description |
|  --- | --- | --- | --- |
| `type` | `string` | Required | urn:stood:problem:<code> |
| `title` | `string` | Required | - |
| `status` | `number` | Required | **Constraints**: `>= -9007199254740991`, `<= 9007199254740991` |
| `code` | `string` | Required | - |
| `detail` | `string` | Required | - |
| `additionalProperties` | `Record<string, unknown>` | Optional | - |

## Example

```ts
try {
  // make the API call
} catch (error) {
  if (error instanceof ProblemError) {
    console.log(error.result);
  }
}
```

