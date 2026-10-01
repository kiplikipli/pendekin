# Pendekin

A pnpm workspace for a future URL shortener. The React SPA deploys to Cloudflare Pages and calls a Hono API on Cloudflare Workers. The Worker connects to Cloud Firestore through its REST API using a service account.

## Workspace

| App | Stack | Deploy target |
| --- | --- | --- |
| `apps/web` | Vite, React, TanStack Router, TanStack Query | Cloudflare Pages |
| `apps/api` | Hono, Firestore REST | Cloudflare Workers |

Firestore link documents will live in the `pendekin/data/links` collection, under the `pendekin/` namespace. The current app only checks connectivity; it does not create or resolve short links yet.

## Local development

Requires Node.js 22+ and pnpm 11.

```sh
pnpm install
pnpm dev
```

Open `http://localhost:5173/status`. Vite proxies `/api` to the Worker at `http://localhost:8787`. The Hono health endpoint works without Firebase credentials. Firestore status reports `not_configured` until a service account is supplied.

Run `pnpm build` and `pnpm typecheck` to verify both apps. The API build is a Wrangler dry run and does not deploy.

## Firebase setup

The provided Firebase client configuration identifies project `iseng-955ec`. The Worker project ID is already set in `apps/api/wrangler.jsonc`. A browser API key cannot authorize trusted server-side Firestore access, so the Worker needs a **service account JSON key**:

1. Enable Cloud Firestore for `iseng-955ec` in the Firebase console, if it is not already enabled.
2. Create a service account with Firestore access and download its JSON key.
3. For local development, create `apps/api/.dev.vars` from `apps/api/.dev.vars.example` and put the full JSON on one line in `FIREBASE_SERVICE_ACCOUNT_JSON`. This file is ignored by Git.
4. For the deployed Worker, set `FIREBASE_SERVICE_ACCOUNT_JSON` as a **Worker secret** in Cloudflare. You can use `pnpm --filter @pendekin/api exec wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON` after deploying the Worker, or add it in Workers & Pages → the Worker → Settings → Variables and Secrets.

The public Firebase web config is intentionally not used by the frontend. All Firestore requests go through the Worker, keeping the service account out of the browser. The temporary `/api/firestore/status` endpoint only checks the collection and returns no records.

## Cloudflare deployment

1. Deploy the Worker from the repo root with `pnpm --filter @pendekin/api deploy`. The Worker name is `pendekin-api`. Record its public `https://...workers.dev` origin. If using Cloudflare Workers Builds instead of local deployment, set its build variable `PNPM_VERSION=11.28.3` too.
2. Create a Cloudflare Pages project named `pendekin-web` connected to this repository. Use the repository root as the build root, `pnpm --filter @pendekin/web build` as the build command, and `apps/web/dist` as the build output directory. Set `PNPM_VERSION=11.28.3` in Pages build environment variables, and set `VITE_API_BASE_URL` to the Worker's public origin, without `/api` at the end. This is a build-time value, so redeploy Pages after changing it.
3. Open the Pages site's `/status` route. It should show `ok` for the Worker and either `Connected` for Firestore or the pending-credential message. Direct navigation to `/status` works because Pages serves SPA routes through `index.html`.

Alternatively, after creating the Pages project, deploy from your machine with `pnpm --filter @pendekin/web deploy`. Set `VITE_API_BASE_URL` in `apps/web/.env.local` before building; see `apps/web/.env.example`.

Never put a service account JSON key in the Pages project or a `VITE_` variable: Vite exposes those values to the browser.
