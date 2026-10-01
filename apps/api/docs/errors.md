# Errors

Authenticated REST routes return JSON with a stable shape:

```json
{"error":"Link not found","code":"NOT_FOUND","retryable":false}
```

The `error` string remains for existing clients. Use `code` for programmatic decisions. No private storage details are returned.

| Code | HTTP status | Meaning | Retry? |
| --- | --- | --- | --- |
| `AUTHENTICATION_REQUIRED` | 401 | Bearer credential missing, invalid, expired, unknown, or revoked. | No; obtain a valid credential. |
| `FORBIDDEN` | 403 | Credential cannot access this route or an admin tried a user route. | No. |
| `INVALID_INPUT` | 400 | Invalid URL, active value, key name, or slug. | No; correct the request. |
| `NOT_FOUND` | 404 | Resource is missing or not owned by the caller. | No. |
| `UPSTREAM_ERROR` | 502 | Authentication storage or Firestore operation failed. | Yes, with backoff. |
| `SERVICE_UNAVAILABLE` | 503 | Required Worker authentication or storage configuration is missing. | Yes, after configuration is restored. |

MCP tool execution errors return `isError: true` and `structuredContent.error` with `code`, `message`, and `retryable`. Invalid MCP tool arguments are rejected by the SDK as JSON-RPC invalid parameters. Protocol errors use standard MCP JSON-RPC responses.

The public redirect route uses plain text for errors. There is no application rate-limit error today.
