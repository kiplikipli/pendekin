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
4. In the project's **existing** Firestore ruleset, deny client access to the Pendekin links path (and check that no broader match grants access):

   ```text
   match /pendekin/data/links/{code} {
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

Replace the email and supply `serviceAccountJson` securely in that trusted environment. Custom claim changes appear after the user signs in again or refreshes their ID token. The Worker verifies the signed token before trusting the role. Admin access is not based on a frontend flag.

## Firestore link records

Links live in `pendekin/data/links/{code}`. Each record has `ownerId` (Firebase UID), `slug`, `targetUrl`, `active`, and `createdAt`. The Worker scopes list and status changes to the verified UID. Generated short URLs use the Worker's public origin; connect a custom domain to the Worker later if you want a shorter branded domain.

## Cloudflare deployment

The existing projects are `pendekin-web.pages.dev` and `pendekin-api.muhammadzulkifli79.workers.dev`. Both are connected to `kiplikipli/pendekin` on `main`.

Deploy the Worker with `pnpm --filter @pendekin/api deploy` and set `FIREBASE_SERVICE_ACCOUNT_JSON` as a Worker secret. Build Pages from the repo root with `pnpm --filter @pendekin/web build`, output `apps/web/dist`, and set `VITE_API_BASE_URL` to the Worker's origin (without `/api`) using the committed Firebase web config (or set the four optional overrides). These are build-time values, so rebuild Pages when they change. Keep `PNPM_VERSION=11.28.3` in the Cloudflare build environment.
