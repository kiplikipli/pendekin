# Pendekin

A comic-style URL shortener with a React frontend on Cloudflare Pages, a Hono API on Cloudflare Workers, Firebase Authentication, and Cloud Firestore.

## What is implemented

- Google sign-in in an accessible modal with Firebase Authentication.
- A general-user dashboard to create, copy, list, activate, and pause short links.
- A deliberately empty admin page. The API recognizes the Firebase `admin: true` custom claim and prevents admins from using the general-user link endpoints.
- Public redirects at `https://<worker-origin>/r/<code>`. Paused links return 404.
- All Firestore queries and writes run in the Worker with its service account. The browser never imports or calls Firestore.
- The former `/status` page and temporary Firestore status endpoint are removed. `/api/health` remains for operational checks.

## Local development

Requires Node.js 22+ and pnpm 11.

```sh
pnpm install
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.dev.vars.example apps/api/.dev.vars
pnpm dev
```

The provided public Firebase web app config is already in `apps/web/src/firebase.ts`. Set `VITE_API_BASE_URL` in `apps/web/.env.local` if you are not using Vite's local proxy, and put the Worker service account JSON in `apps/api/.dev.vars`. Open `http://localhost:5173`. Vite proxies `/api` and `/r` to the local Worker at `http://localhost:8787`.

Run `pnpm build` and `pnpm typecheck` for focused build and TypeScript checks. The API build is a Wrangler dry run.

## Firebase setup

1. The Firebase web app config for project `iseng-955ec` is in `apps/web/src/firebase.ts`. Its identifiers are public and can be overridden with `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, and `VITE_FIREBASE_APP_ID` for another project.
2. Enable **Google** under Authentication → Sign-in method. Add `localhost` and your Pages hostname to Authentication → Settings → Authorized domains. Use hostnames without protocol or port.
3. Enable Cloud Firestore. Create a service account with Firestore access and set its full JSON as the **Worker secret** `FIREBASE_SERVICE_ACCOUNT_JSON`. The Worker project ID is already `iseng-955ec` in `apps/api/wrangler.jsonc`. For local development, put the JSON on one line in `apps/api/.dev.vars`.
4. In the project's **existing** Firestore ruleset, deny client access to both Pendekin's link and API-key paths (and check that no broader match grants access):

   ```text
   match /pendekin/data/links/{code} {
     allow read, write: if false;
   }

   match /pendekin/data/apiKeys/{id} {
     allow read, write: if false;
   }
   ```

   Merge this into the existing `service cloud.firestore` block. Do not replace the project's entire ruleset if it serves other apps. The Worker service account uses IAM and is unaffected by Firestore client rules.

The Firebase web config is public identification for the web app; it does **not** grant read or write permission by itself. Firestore security rules control browser SDK access. This app uses the browser SDK only for Authentication and sends ID tokens to the Worker. Never put the service account JSON in Pages or any `VITE_` variable.

### Assign an admin

After a user signs in once, use a trusted environment with the Firebase Admin SDK and a service account to set the custom claim on that user's UID:

```js
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

initializeApp({ credential: cert(serviceAccountJson) })
const user = await getAuth().getUserByEmail('admin@example.com')
await getAuth().setCustomUserClaims(user.uid, {
  ...user.customClaims,
  admin: true,
})
```

Replace the email and supply `serviceAccountJson` securely in that trusted environment. Custom claim changes appear after the user signs in again or refreshes their ID token. The Worker verifies the signed token before trusting the role. Admin access is not based on a frontend flag. Revoke that user's API keys before changing their admin claim. If a Firebase account is disabled or deleted outside Pendekin, its API keys remain active until revoked. If the user can no longer sign in, use trusted Firestore admin tooling to delete that user's records from `pendekin/data/apiKeys` by matching `ownerId` to their UID.

## External API keys

For the complete integration contract, see [Link management API](docs/api.md).

Create a named key from the **API keys** section of the signed-in dashboard. Pendekin shows the full key only once. Copy it into the external app's server-side secret storage; the dashboard can list or revoke keys but cannot recover their secret. Every key can list, create, activate, pause, and delete links owned by its user. Revoking a key makes the next request with it fail.

Set the copied value as `PENDEKIN_API_KEY` in the external app's server-side environment. Send it in the Authorization header:

```sh
curl -H "Authorization: Bearer $PENDEKIN_API_KEY" "https://pendekin-api.muhammadzulkifli79.workers.dev/api/links"

curl -X POST "https://pendekin-api.muhammadzulkifli79.workers.dev/api/links" -H "Authorization: Bearer $PENDEKIN_API_KEY" -H "Content-Type: application/json" -d '{"targetUrl":"https://example.com"}'
```

Use the same header with `PATCH /api/links/{slug}` and `DELETE /api/links/{slug}` to activate, pause, or delete an owned link. Do not put API keys in URLs or query parameters.

## Firestore link records

Links live in `pendekin/data/links/{code}`. Each record has `ownerId` (Firebase UID), `slug`, `targetUrl`, `active`, and `createdAt`. The Worker scopes list and status changes to the verified UID. Generated short URLs use the Worker's public origin; connect a custom domain to the Worker later if you want a shorter branded domain.

## Cloudflare deployment

The existing projects are `pendekin-web.pages.dev` and `pendekin-api.muhammadzulkifli79.workers.dev`. Both are connected to `kiplikipli/pendekin` on `main`.

Deploy the Worker with `pnpm --filter @pendekin/api deploy` and set `FIREBASE_SERVICE_ACCOUNT_JSON` as a Worker secret. Build Pages from the repo root with `pnpm --filter @pendekin/web build`, output `apps/web/dist`, and set `VITE_API_BASE_URL` to the Worker's origin (without `/api`) using the committed Firebase web config (or set the four optional overrides). These are build-time values, so rebuild Pages when they change. Keep `PNPM_VERSION=11.28.3` in the Cloudflare build environment.

## AI / Agent Integration

The Worker serves its public API contract and guidance directly, without requiring clients to parse a documentation page:

- `/openapi.json` — OpenAPI 3.1 contract with operation IDs, schemas, auth requirements, and error responses.
- `/llms.txt` — lightweight discovery index with absolute URLs for the current Worker origin.
- `/docs/*.md` — raw Markdown guides for getting started, authentication, links, errors, rate limits, and pagination. The source files are `apps/api/docs/*.md`; the link guide reuses `docs/api.md`. The API build embeds these sources into the Worker.
- `/mcp` — official MCP Streamable HTTP endpoint with `list_links`, `create_link`, `set_link_active`, and `delete_link` tools. Send the same `Authorization: Bearer` credential used for REST. API keys remain limited to their owner's links; Firebase admin sessions remain barred from general-user link actions.

For local verification, run `pnpm --filter @pendekin/api dev` and request `http://localhost:8787/openapi.json`, `http://localhost:8787/llms.txt`, or `http://localhost:8787/docs/getting-started.md`. Use `pnpm --filter @pendekin/api build` to regenerate embedded Markdown and check the Worker bundle. The unversioned `/api` routes are currently described as contract version `1.0.0`; no API-level pagination, rate limit, or idempotency key support is defined.
