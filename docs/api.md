# Pendekin link management API

This is the HTTP contract for an external application that manages a Pendekin user's short links. The API key determines the user who owns every request.

## Connection

- **Base URL:** `https://pendekin-api.muhammadzulkifli79.workers.dev` (replace this origin if your Pendekin Worker uses another domain).
- **Authentication:** `Authorization: Bearer <PENDEKIN_API_KEY>` on every `/api/links` request.
- **Request bodies:** JSON with `Content-Type: application/json` for `POST` and `PATCH`.
- **Response bodies:** JSON. Successful API responses and errors are not cached (`Cache-Control: no-store`).

Create a named key in the signed-in Pendekin dashboard under **API keys**. Copy its full value when shown; it cannot be retrieved again. Store it as a server-side secret in the connecting application. Do not put it in frontend code, URLs, or query parameters.

An API key can use the four link operations below. It cannot call `/api/keys` or `/api/me`; those routes require a Firebase sign-in session. The key can access only links owned by the user who created it.

## Link object

Every returned link has this shape:

```json
{
  "id": "a1b2c3d4",
  "slug": "a1b2c3d4",
  "targetUrl": "https://example.com/page",
  "shortUrl": "https://pendekin-web.pages.dev/r/a1b2c3d4",
  "active": true,
  "createdAt": "2026-10-01T08:00:00.000Z"
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Internal link ID. Use `slug` for route paths. |
| `slug` | string | Eight-character alphanumeric short code. |
| `targetUrl` | string | Destination URL. |
| `shortUrl` | string | Public redirect URL on the configured web or custom-domain origin. |
| `active` | boolean | `false` pauses the redirect while retaining the link. |
| `createdAt` | string or `null` | Creation timestamp in ISO 8601 format, or `null` for a record without a timestamp. |

## Operations

Use list links when a slug is unknown. Use the returned `slug` for activation, pausing, or deletion; do not invent one. There is no get-by-slug or search endpoint.

| Action | Method and path | JSON request | Success |
| --- | --- | --- | --- |
| List owned links | `GET /api/links` | None | `200 {"links": [<link>, ...]}`; newest first. |
| Create a link | `POST /api/links` | `{"targetUrl":"https://example.com/page"}` | `201 {"link": <link>}`; new links start active. |
| Activate or pause | `PATCH /api/links/{slug}` | `{"active":true}` or `{"active":false}` | `200 {"link": <link>}`. |
| Delete a link | `DELETE /api/links/{slug}` | None | `200 {"deleted":true}`. |

`targetUrl` must be an absolute `http` or `https` URL, at most 2,048 characters, with no username or password. The server normalizes it when creating the link. `{slug}` must be exactly eight alphanumeric characters. The API generates the slug; callers cannot choose it. There is currently no endpoint to change a link's destination. Use `active: false` to pause a link; deletion removes it. Creating a link is not idempotent, and idempotency keys are not supported. If a create response is lost, list links before deciding to retry. Setting the same `active` value again has the same effect; repeating a deletion returns 404.

### Copyable requests

Set `PENDEKIN_API_KEY` in your application's server-side environment, then use:

```sh
API_BASE_URL='https://pendekin-api.muhammadzulkifli79.workers.dev'

curl -H "Authorization: Bearer $PENDEKIN_API_KEY" \
  "$API_BASE_URL/api/links"

curl -X POST "$API_BASE_URL/api/links" \
  -H "Authorization: Bearer $PENDEKIN_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"targetUrl":"https://example.com/page"}'

curl -X PATCH "$API_BASE_URL/api/links/a1b2c3d4" \
  -H "Authorization: Bearer $PENDEKIN_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"active":false}'

curl -X PATCH "$API_BASE_URL/api/links/a1b2c3d4" \
  -H "Authorization: Bearer $PENDEKIN_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"active":true}'

curl -X DELETE "$API_BASE_URL/api/links/a1b2c3d4" \
  -H "Authorization: Bearer $PENDEKIN_API_KEY"
```

Replace `a1b2c3d4` with the `slug` from a create or list response. Treat the create response as the source of the generated `shortUrl`.

## Public redirect

Open the returned `shortUrl` on the web or custom-domain origin. `GET /r/{slug}` needs no API key. The Pages Function calls the Worker's public redirect endpoint; an active link responds with `302` and a `Location` header pointing to `targetUrl`. A paused, missing, or invalid link responds with `404`. The Worker-origin `/r/{slug}` remains available for previously shared links.

## Errors and key lifecycle

Errors from `/api/links` are JSON objects with a human-readable `error` string plus stable `code` and `retryable` fields, for example `{"error":"Link not found","code":"NOT_FOUND","retryable":false}`. The `error` string remains for existing clients. See `/docs/errors.md` for all error codes. Handle these status codes:

| Status | Meaning |
| --- | --- |
| `400` | Invalid `targetUrl`, `active` value, or slug. |
| `401` | API key missing, malformed, unknown, or revoked. |
| `403` | A valid API key called a protected route outside the link API. |
| `404` | Link missing or owned by another user for update/delete. |
| `502` | The Worker could not complete authentication or a storage operation. |
| `503` | Required Worker authentication or storage configuration is missing. |

Revoking a key in the dashboard makes its next request fail with `401`. Changes to a Firebase account outside Pendekin, including disabling or deleting it, do not automatically revoke its API keys; revoke those keys separately.

## Pagination and rate limits

The link list is unpaginated and returns the complete owned array, newest first. Pendekin currently has no application-defined rate limit or guaranteed `Retry-After` header. Back off on transient 502 and 503 responses and follow `Retry-After` if present.
