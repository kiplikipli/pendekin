# External API Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Let general users create and revoke named API keys that grant external applications full access to that user's existing short-link operations.

**Architecture:** Keep API key records in Firestore and authenticate them in the Hono Worker. Resolve a valid key to its owner UID before entering the existing link handlers, so their ownership checks continue to decide which links a caller can affect. Manage keys only with Firebase ID tokens.

**Tech Stack:** TypeScript, Hono on Cloudflare Workers, Firestore REST API, Firebase Authentication, React, TanStack Query, Node 22+ test runner.

## Global Constraints

- Follow the approved design in docs/superpowers/specs/2026-10-01-external-api-keys-design.md.
- Multiple named keys per general user; each key has all current link operations, no expiry, and no per-key scopes.
- Format: pk_<id>.<secret>, with independent 128-bit random ID and 256-bit random secret encoded as base64url. Store SHA-256 of the secret, never plaintext.
- Key management requires a Firebase ID token. Only GET and POST /api/links and PATCH and DELETE /api/links/:slug accept keys.
- Do not cache key lookups; the next request after revocation must fail. A request already authenticated may finish.
- Keep /api/me Firebase-only, /api/health and /r/:slug public, and future routes closed to API keys by default.
- All /api responses use Cache-Control: no-store. Do not accept keys in query parameters or URLs.
- Preserve the unrelated untracked .impeccable/ directory. Never stage it.
- Prefix shell commands with rtk. Never run the full test suite unless the user requests it.

## File map and interfaces

| File | Responsibility |
| --- | --- |
| apps/api/src/firestore-client.ts (new) | Service-account parsing, OAuth token cache, Firestore document URL helper shared by links and keys. |
| apps/api/src/firestore.ts | Existing link storage and ownership checks; import the shared client without changing link behavior. |
| apps/api/src/api-keys.ts (new) | Key generation, hashing, Firestore CRUD, owner lookup, and public metadata types. |
| apps/api/src/index.ts | Route-specific Firebase/API-key authentication and the three key-management routes. |
| apps/api/tests/api-keys.test.mjs (new) | Focused key-store tests with mocked Firestore/OAuth fetch. |
| apps/api/tests/api-key-routes.test.mjs (new) | Focused HTTP tests for route restrictions, lifecycle, and UID ownership. |
| apps/web/src/api.ts | Metadata and create-response types for the web client. |
| apps/web/src/api-keys.tsx (new) | Isolated API-key section: list, create, one-time reveal/copy, and revoke. |
| apps/web/src/pages.tsx | Mount the API-key section below the link dashboard. |
| apps/web/src/styles.css | API-key controls at desktop and narrow widths. |
| README.md | Key usage, Firestore client-rule denial, and manual revocation on external account changes. |

The stable key-store interface is:

~~~ts
export type ApiKeyMetadata = { id: string; name: string; createdAt: string }
export type IssuedApiKey = { key: ApiKeyMetadata; token: string }
export function createApiKey(env: FirestoreBindings, uid: string, name: string): Promise<IssuedApiKey>
export function listApiKeys(env: FirestoreBindings, uid: string): Promise<ApiKeyMetadata[]>
export function deleteApiKey(env: FirestoreBindings, uid: string, id: string): Promise<boolean>
export function resolveApiKey(env: FirestoreBindings, token: string): Promise<string | null>
~~~

---

### Task 1: Extract shared Firestore access

**Files:**
- Create: apps/api/src/firestore-client.ts
- Modify: apps/api/src/firestore.ts
- Test: apps/api/tests/delete-link.test.mjs (existing)

**Interfaces:**
- Produces: FirestoreBindings; getFirestoreAccess(env): Promise<{ projectId: string; token: string }>; firestoreDocumentUrl(projectId, documentPath): string.
- Consumes: existing FIREBASE_PROJECT_ID and FIREBASE_SERVICE_ACCOUNT_JSON Worker bindings.

- [ ] **Step 1: Record the existing focused-test baseline.**

Run: rtk proxy node --test apps/api/tests/delete-link.test.mjs

Expected: 1 passing test. This command was verified while writing the plan.

- [ ] **Step 2: Move the account parser and OAuth token cache to the shared module.**

Move the existing ServiceAccount type, getServiceAccount, getAccessToken, and their imports/constants from firestore.ts into firestore-client.ts without changing validation or cache behavior. Export this wrapper and URL helper:

~~~ts
export type FirestoreBindings = {
  FIREBASE_PROJECT_ID?: string
  FIREBASE_SERVICE_ACCOUNT_JSON?: string
}

export async function getFirestoreAccess(env: FirestoreBindings): Promise<{ projectId: string; token: string }> {
  const account = getServiceAccount(env)
  return { projectId: account.project_id, token: await getAccessToken(account) }
}

export function firestoreDocumentUrl(projectId: string, path: string): string {
  return 'https://firestore.googleapis.com/v1/projects/' +
    encodeURIComponent(projectId) +
    '/databases/(default)/documents/' + path
}
~~~

In firestore.ts import these exports, preserve LINKS_COLLECTION, and replace each account/token acquisition with getFirestoreAccess(env). Keep getDocument's return shape local to firestore.ts as { projectId, token, document }; update the PATCH and DELETE callers to use projectId. Keep Firestore URL encoding of slug/document IDs.

- [ ] **Step 3: Check behavior and commit the extraction.**

Run: rtk proxy node --test apps/api/tests/delete-link.test.mjs

Run: rtk pnpm --filter @pendekin/api typecheck

Expected: focused test and API typecheck pass. Stage only the two API source files and commit with message "refactor: share Firestore access for API keys".

### Task 2: Add the key store and credential verification

**Files:**
- Create: apps/api/src/api-keys.ts
- Create: apps/api/tests/api-keys.test.mjs

**Interfaces:**
- Consumes: FirestoreBindings, getFirestoreAccess, firestoreDocumentUrl from Task 1.
- Produces: createApiKey, listApiKeys, deleteApiKey, resolveApiKey, ApiKeyMetadata, IssuedApiKey with the exact signatures in the file map.

- [ ] **Step 1: Write failing focused tests for credential and owner behavior.**

Use a fetch stub that answers the OAuth token request and stores Firestore API-key documents in a Map keyed by ID. Assert these outcomes in api-keys.test.mjs:

~~~js
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { createApiKey, deleteApiKey, listApiKeys, resolveApiKey } from '../src/api-keys.ts'

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const env = {
  FIREBASE_PROJECT_ID: 'test-project',
  FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
    project_id: 'test-project',
    client_email: 'test@example.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  }),
}
const issued = await createApiKey(env, 'alice', 'Automation')
assert.match(issued.token, /^pk_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/)
assert.equal(issued.key.name, 'Automation')
assert.equal(await resolveApiKey(env, issued.token), 'alice')
assert.equal(await resolveApiKey(env, issued.token.slice(0, -1) + '!'), null)
assert.deepEqual((await listApiKeys(env, 'alice')).map((key) => key.id), [issued.key.id])
assert.deepEqual(await listApiKeys(env, 'bob'), [])
assert.equal(await deleteApiKey(env, 'bob', issued.key.id), false)
assert.equal(await deleteApiKey(env, 'alice', issued.key.id), true)
assert.equal(await resolveApiKey(env, issued.token), null)
~~~

Also inspect the stored document: it has ownerId and secretHash, and contains neither the full token nor the secret component. Check trimmed names, invalid empty/over-80-character names, malformed IDs, unknown IDs, and a Firestore 500 that must throw rather than authenticate.

- [ ] **Step 2: Run only the new test and confirm failure.**

Run: rtk proxy node --test apps/api/tests/api-keys.test.mjs

Expected: failure because api-keys.ts or its exports do not yet exist.

- [ ] **Step 3: Implement credential helpers and Firestore operations.**

Use getRandomValues for 16 ID bytes and 32 secret bytes. Encode them as base64url; parse credentials with this exact shape:

~~~ts
const TOKEN_PATTERN = /^pk_([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/
const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/
const KEY_COLLECTION = 'pendekin/data/apiKeys'

function keyName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 80) throw new Error('Invalid API key name')
  return trimmed
}

async function digestSecret(secret: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
~~~

Implement a byte-wise fixed-length comparison of the stored and computed 64-character hex digests without returning on the first differing byte. Reject malformed stored records. Create with Firestore POST documentId and retry an ID collision (HTTP 409) up to three times. Store ownerId, name, secretHash, createdAt; return { key: metadata, token: fullCredential }. List with Firestore runQuery filtered by ownerId, parse only owner-matching records, sort by createdAt descending, and omit hash/token. Delete with a prior document read, owner check, and currentDocument.updateTime precondition. Resolve with a direct GET by ID, returning null for 404 or bad credentials and throwing on other Firestore failures. Do not cache key records.

- [ ] **Step 4: Verify and commit the key store.**

Run: rtk proxy node --test apps/api/tests/api-keys.test.mjs

Run: rtk pnpm --filter @pendekin/api typecheck

Expected: tests and typecheck pass. Stage only api-keys.ts and api-keys.test.mjs; commit with message "feat: store and verify user API keys".

### Task 3: Authenticate link requests and expose key management

**Files:**
- Modify: apps/api/src/index.ts
- Create: apps/api/tests/api-key-routes.test.mjs

**Interfaces:**
- Consumes: Task 2 key-store functions and existing verifyFirebaseToken.
- Produces: GET /api/keys -> { keys: ApiKeyMetadata[] }; POST /api/keys -> IssuedApiKey, status 201; DELETE /api/keys/:id -> { deleted: true }; key-enabled existing link routes.

- [ ] **Step 1: Write failing route tests.**

Export createApp from index.ts with optional authentication dependencies for focused tests, while keeping the default export as createApp() for Wrangler:

~~~ts
type AuthDependencies = {
  verifySession: typeof verifyFirebaseToken
  resolveKey: typeof resolveApiKey
}
export function createApp(deps: Partial<AuthDependencies> = {}) {
  const verifySession = deps.verifySession ?? verifyFirebaseToken
  const resolveKey = deps.resolveKey ?? resolveApiKey
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()
  return app
}
export default createApp()
~~~

The actual implementation must register the existing middleware and routes inside createApp before returning. In tests inject deterministic authentication and stub the Firestore HTTP responses. For example:

~~~js
import { createApp } from '../src/index.ts'

const app = createApp({
  verifySession: async () => ({ uid: 'alice', email: null, name: null, role: 'user' }),
  resolveKey: async (_env, token) => token === 'pk_valid' ? 'alice' : null,
})
const response = await app.request('/api/me', {
  headers: { authorization: 'Bearer pk_valid' },
}, env)
assert.equal(response.status, 403)
~~~

Use a Firestore fetch stub for key/link records. Assert:
- Firebase token can create/list/revoke Alice's keys; an admin Firebase user gets 403.
- A valid API key on /api/keys or /api/me gets 403; /api/health stays public.
- Missing, malformed, unknown, and revoked keys get the same 401 body on link routes.
- Key-created links contain ownerId='alice'; list returns Alice's links; PATCH and DELETE of Bob's link return 404 and issue no Firestore write.
- A valid key can PATCH and DELETE Alice's link, including active=false and active=true.
- Firestore lookup failure returns 502 and missing storage configuration returns 503.

- [ ] **Step 2: Run only the new route test and confirm failure.**

Run: rtk proxy node --test apps/api/tests/api-key-routes.test.mjs

Expected: failure because createApp and the key routes do not yet meet the assertions.

- [ ] **Step 3: Add explicit route-scoped authentication.**

Keep CORS and no-store middleware. In the authentication middleware, parse the Authorization bearer value. When it begins with pk_, resolve it, then allow only the two collection methods and two item methods; set user context to { uid: ownerId, email: null, name: null, role: 'user' }. An invalid key returns the generic 401 body; a valid key on any other protected route returns 403. Firebase JWTs continue through verifySession. Use an explicit route check:

~~~ts
function acceptsApiKey(path: string, method: string): boolean {
  if (path === '/api/links') return method === 'GET' || method === 'POST'
  if (/^\/api\/links\/[^/]+$/.test(path)) return method === 'PATCH' || method === 'DELETE'
  return false
}
~~~

Check FIREBASE_PROJECT_ID for both auth modes and FIREBASE_SERVICE_ACCOUNT_JSON before key lookup. Catch credential mismatches separately from Firestore errors so a backend outage cannot become a 401 or bypass authentication. Preserve existing admin guards in link handlers.

- [ ] **Step 4: Add Firebase-only key-management handlers.**

After authentication, reject admin users on key routes. Validate POST JSON is an object with a string name whose trimmed length is 1-80; respond 400 otherwise. Use these calls and responses:

~~~ts
const keys = await listApiKeys(c.env, c.get('user').uid)
return c.json({ keys })

const issued = await createApiKey(c.env, c.get('user').uid, name.trim())
return c.json(issued, 201)

const deleted = await deleteApiKey(c.env, c.get('user').uid, c.req.param('id'))
if (!deleted) return c.json({ error: 'API key not found' }, 404)
return c.json({ deleted: true })
~~~

Return 503 when storage configuration is absent, 502 for Firestore failures, and generic 401 for invalid credentials. Keep existing /api/links request and response bodies unchanged.

- [ ] **Step 5: Verify and commit HTTP behavior.**

Run: rtk proxy node --test apps/api/tests/api-key-routes.test.mjs apps/api/tests/api-keys.test.mjs apps/api/tests/delete-link.test.mjs

Run: rtk pnpm --filter @pendekin/api typecheck

Expected: the three focused API test files and API typecheck pass. Stage only index.ts and api-key-routes.test.mjs; commit with message "feat: accept API keys for user link routes".

### Task 4: Add dashboard key management and usage documentation

**Files:**
- Modify: apps/web/src/api.ts
- Create: apps/web/src/api-keys.tsx
- Modify: apps/web/src/pages.tsx
- Modify: apps/web/src/styles.css
- Modify: README.md

**Interfaces:**
- Consumes: GET/POST/DELETE /api/keys from Task 3 and existing apiRequest(path, FirebaseToken, init).
- Produces: an API keys section within the general-user dashboard; no admin UI.

- [ ] **Step 1: Define the web response types.**

In api.ts add the exact API contract:

~~~ts
export type ApiKeyMetadata = {
  id: string
  name: string
  createdAt: string
}
export type IssuedApiKey = {
  key: ApiKeyMetadata
  token: string
}
~~~

- [ ] **Step 2: Add the API-key list query.**

Create api-keys.tsx with ApiKeysSection({ uid, getToken }: { uid: string; getToken: () => Promise<string> }). Use the existing apiRequest helper and a user-scoped query:

~~~ts
const queryClient = useQueryClient()
const queryKey = ['apiKeys', uid]
const keysQuery = useQuery({
  queryKey,
  queryFn: async () => apiRequest<{ keys: ApiKeyMetadata[] }>('/api/keys', await getToken()),
})
~~~

Render name, creation date, loading, empty, and error states. No response other than metadata enters the query cache.

- [ ] **Step 3: Add creation and one-time reveal.**

Add a required name input with maxLength=80. Keep the issued result only in local component state:

~~~ts
const [name, setName] = useState('')
const [issued, setIssued] = useState<IssuedApiKey | null>(null)
const createKey = useMutation({
  mutationFn: async (name: string) => apiRequest<IssuedApiKey>('/api/keys', await getToken(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: name.trim() }),
  }),
  onSuccess: (result) => {
    setIssued(result)
    setName('')
    void queryClient.invalidateQueries({ queryKey })
  },
})
~~~

Render issued.token in a selectable readonly field with Copy and Done actions. Copy uses navigator.clipboard.writeText and shows explicit success or failure text. Done calls setIssued(null). Never put the token in the query cache, URL, localStorage, or sessionStorage. Focus the revealed field after creation.

- [ ] **Step 4: Add revocation with confirmation.**

Store the selected key ID in local state and render an inline confirmation naming that key. On confirmation call:

~~~ts
const [revokeId, setRevokeId] = useState<string | null>(null)
const revokeKey = useMutation({
  mutationFn: async (id: string) => apiRequest<{ deleted: true }>(
    '/api/keys/' + id, await getToken(), { method: 'DELETE' }),
  onSuccess: () => {
    setRevokeId(null)
    void queryClient.invalidateQueries({ queryKey })
  },
})
~~~

Disable duplicate submissions while pending. Show errors with role=alert and success/copy notices with role=status. Focus the confirmation control when it opens, and restore focus to the selected key's Revoke button if canceled.

- [ ] **Step 5: Mount and style the section.**

Import ApiKeysSection from ./api-keys in pages.tsx and render it after the link list inside LinkDashboard:

~~~tsx
<ApiKeysSection uid={profile.uid} getToken={() => user!.getIdToken()} />
~~~

Keep DashboardPage's existing admin redirect. In styles.css reuse the dashboard's card, button, notice, and error visual language; add api-key-specific selectors. Ensure the token field and action buttons fit narrow viewports:

~~~css
.api-key-token { width: 100%; min-width: 0; }
.api-key-actions { display: flex; flex-wrap: wrap; gap: 8px; }
~~~

- [ ] **Step 6: Document client usage and lifecycle.**

In README.md, add a short section showing a dashboard-created key used as a bearer token for GET /api/links and POST /api/links; state that PATCH /api/links/:slug and DELETE /api/links/:slug work with the same key. Tell readers to set PENDEKIN_API_KEY to the key copied from the dashboard. Use that variable in examples, and explain one-time display, named keys, and revocation:

~~~sh
curl -H "Authorization: Bearer $PENDEKIN_API_KEY" "https://pendekin-api.muhammadzulkifli79.workers.dev/api/links"
curl -X POST "https://pendekin-api.muhammadzulkifli79.workers.dev/api/links" \
  -H "Authorization: Bearer $PENDEKIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"targetUrl":"https://example.com"}'
~~~

Add this rule beside the existing links denial inside the same Firestore service block:

~~~text
match /pendekin/data/apiKeys/{id} {
  allow read, write: if false;
}
~~~

In the existing "Assign an admin" section, say to revoke that user's API keys when changing claims. Also say Firebase user deletion/disablement performed outside Pendekin does not revoke keys automatically; the operator must delete those users' key documents through a trusted Firestore process if the users cannot sign in.

- [ ] **Step 7: Run focused verification and commit.**

Run: rtk pnpm --filter @pendekin/web typecheck

Run: rtk pnpm --filter @pendekin/web build

Expected: both pass. In a configured local session, manually create a key, copy it, dismiss the one-time token, reload to confirm it is not shown again, use it to list/create/pause/activate/delete owned links, revoke it, and confirm the next request returns 401. Check narrow viewport and admin redirect. If local Firebase credentials are unavailable, record that the browser check could not be completed; do not claim it passed. Stage only the five files in this task and commit with message "feat: manage API keys in dashboard".

## Final focused review

Compare each task with the approved spec: all key lifecycle rules, HTTP responses, route restrictions, ownership checks, Firestore rules, and documentation must be covered. Run rtk git diff --check and inspect rtk git status --short. Do not run the full test suite. Report any browser verification that could not be performed.
