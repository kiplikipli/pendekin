# External application API keys

## Purpose and scope

Let a signed-in Pendekin user connect external applications with API keys. A key identifies the Firebase UID of the user who created it. Requests made with that key can list, create, activate, pause, and delete that user's short links through the existing `/api/links` routes. Existing link ownership checks remain the authority for every operation.

Users can create multiple named keys and revoke them independently. Each key grants the full set of user link operations. This version has no per-key permissions or expiration. API keys do not grant access to key management or future API routes automatically.

## Approach

Store key records in the existing Cloud Firestore database and authenticate them in the Cloudflare Worker. This reuses the current persistence and link routes. Cloudflare KV was considered, but its eventual consistency makes prompt revocation harder to guarantee. D1 would add a second database and deployment setup for a small credential store.

## Components and data flow

1. The dashboard adds an **API keys** section for authenticated general users. It shows each key's name and creation date, offers Create and Revoke actions, and displays the full new key once with a Copy action. Dismissing the result or leaving the page clears the displayed secret from React state. Reloading cannot recover it.
2. Key management requests use the existing Firebase ID token. The Worker rejects API keys on `/api/keys` and rejects admin Firebase sessions there, matching the general-user dashboard's current restriction.
3. A generated credential has the form `pk_<id>.<secret>`, with an independent 128-bit random ID and 256-bit random secret, encoded as URL-safe text. The ID is used for a direct Firestore lookup. The Worker stores only a SHA-256 digest of the secret and compares digests in constant time. The complete credential is returned only by the create response.
4. External applications send `Authorization: Bearer <key>` to the existing `/api/links` routes. The Worker parses and validates the credential, looks up its record, compares the digest, and places its `ownerId` in the same request user context used by Firebase authentication. The current link handlers and Firestore ownership checks then run unchanged in behavior.

Key records live at `pendekin/data/apiKeys/{id}` with `ownerId`, `name`, `secretHash`, and `createdAt`. The ID is a random, URL-safe document ID. The Worker alone reads or writes this collection through its service account. The existing Firestore rules documentation will add an explicit browser-access denial for this collection, as it does for links. Key names are trimmed, required, and limited to 80 characters.

## HTTP contract

| Route | Authentication | Behavior |
| --- | --- | --- |
| `GET /api/keys` | Firebase ID token | List only the caller's key IDs, names, and creation dates. Never return secrets or hashes. |
| `POST /api/keys` | Firebase ID token | Accept `{ "name": string }`; create a key and return its metadata plus the complete credential once. |
| `DELETE /api/keys/:id` | Firebase ID token | Check ownership and delete the key record. Return `{ "deleted": true }`; an unknown or other user's ID returns 404. |
| `GET /api/links` | Firebase ID token or API key | List the credential owner's links. |
| `POST /api/links` | Firebase ID token or API key | Create a link owned by the credential owner. |
| `PATCH /api/links/:slug` | Firebase ID token or API key | Activate or pause an owned link. |
| `DELETE /api/links/:slug` | Firebase ID token or API key | Delete an owned link. |

`/api/me` remains Firebase-session-only, `/api/health` remains public, and `/r/:slug` remains public. Key authentication is explicitly enabled on the four link routes, so new routes do not inherit it accidentally. Existing request and response shapes for link operations stay the same. The README will include a short example of creating and using a key.

## Failure and lifecycle behavior

Missing, malformed, unknown, or revoked credentials receive the same generic 401 response; the response does not reveal whether an ID exists. A valid key used on a route that requires Firebase authentication receives 403. Invalid names receive 400. Firestore failures return 502, while missing Worker storage configuration returns 503; neither falls back to unauthenticated access. All API responses continue to use `Cache-Control: no-store`. Keys are accepted only in the Authorization header, never in a URL or query string.

Revocation deletes the key record, so the next lookup rejects it. Key records are read on every API-key request rather than cached. A request that already authenticated before revocation may finish. If a user loses a key, they revoke it and create a replacement; the original secret cannot be recovered. Changing an account's Firebase admin claim or deleting or disabling the Firebase account outside Pendekin does not automatically revoke its keys. The operator must revoke those keys as part of that account change; the README's admin procedure will state this. Admin-only endpoints, if added later, must require Firebase authentication and never accept these keys.

## Verification

Add focused API tests for key generation and one-time disclosure, malformed and incorrect credentials, revoked keys, key ownership on list and delete, and link creation under the correct UID. Check that key-authenticated list, update, and delete operations cannot affect another user's links. Check the dashboard's create, copy, and revoke states manually or with focused component tests where useful. Run API typecheck and the relevant focused tests; do not run the full test suite unless requested.
