# Getting started with the Pendekin API

Pendekin creates and manages short links. The current API is unversioned and its supported routes are under `/api`. The OpenAPI contract is available at `/openapi.json`.

## Choose an interface

- Use REST for direct HTTP integrations.
- Use the MCP endpoint at `/mcp` for agent tools. It exposes the same four link actions and uses the same bearer credential and ownership rules.
- Open the `shortUrl` returned by link operations without authentication to follow an active short link.

## First request

Create an API key in the signed-in dashboard, store it as a server-side secret, then send `Authorization: Bearer <key>`:

```sh
curl -H "Authorization: Bearer $PENDEKIN_API_KEY" "$API_BASE_URL/api/links"
```

The list returns `{"links": [...]}`. Use a returned `slug` for updates or deletion; do not invent one. To create a link, send `{"targetUrl":"https://example.com/page"}` to `POST /api/links`.

## Sequencing and retries

Creating a link is not idempotent. If a create response is lost, list existing links before deciding to retry. Setting a link's `active` value can be repeated safely. Deleting an already deleted link returns 404.

See [links](./links.md), [authentication](./authentication.md), and [errors](./errors.md).
