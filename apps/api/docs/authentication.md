# Authentication

Send `Authorization: Bearer <credential>` to authenticated REST routes and MCP at `/mcp`.

## Firebase session token

A signed-in dashboard user supplies a Firebase ID token. Session tokens can access `/api/me`, manage their own API keys through `/api/keys`, and manage their own links. The Worker verifies the token signature, issuer, audience, and time claims. Accounts with the `admin` claim are barred from the general-user link and key routes.

## Pendekin API key

Create a named API key from the signed-in dashboard. Its full token is shown only once. Store it server-side; never place it in URLs or browser code. API keys can access the owner's four `/api/links` operations and equivalent MCP tools. They cannot access `/api/me` or `/api/keys`. Revoking a key makes the next request fail with 401. Disabling or deleting a Firebase account outside Pendekin does not automatically revoke its API keys.

A missing, malformed, unknown, or revoked key receives the same generic 401 response. Every link action is restricted to the key owner's links; another user's slug behaves as not found.

`GET /api/health`, `GET /r/{slug}`, `/openapi.json`, `/llms.txt`, and `/docs/*.md` are public.
