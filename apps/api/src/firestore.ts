import { SignJWT, importPKCS8 } from 'jose'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore'
export const LINKS_COLLECTION = 'pendekin/data/links'

export type FirestoreBindings = {
  FIREBASE_PROJECT_ID?: string
  FIREBASE_SERVICE_ACCOUNT_JSON?: string
}

type ServiceAccount = {
  project_id: string
  client_email: string
  private_key: string
  private_key_id?: string
}

type AccessToken = {
  value: string
  expiresAt: number
  identity: string
}

let cachedToken: AccessToken | undefined

function getServiceAccount(env: FirestoreBindings): ServiceAccount {
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error('Firestore credentials are not configured')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON)
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON')
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('project_id' in parsed) ||
    !('client_email' in parsed) ||
    !('private_key' in parsed) ||
    typeof parsed.project_id !== 'string' ||
    typeof parsed.client_email !== 'string' ||
    typeof parsed.private_key !== 'string' ||
    parsed.project_id !== env.FIREBASE_PROJECT_ID
  ) {
    throw new Error('Firebase service account does not match FIREBASE_PROJECT_ID')
  }

  return parsed as ServiceAccount
}

async function getAccessToken(account: ServiceAccount): Promise<string> {
  const identity = `${account.client_email}:${account.private_key_id ?? ''}`
  if (cachedToken?.identity === identity && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value
  }

  const key = await importPKCS8(account.private_key, 'RS256')
  const assertion = await new SignJWT({ scope: FIRESTORE_SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(account.client_email)
    .setAudience(TOKEN_URL)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key)

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })

  if (!response.ok) {
    throw new Error(`Google token request failed with HTTP ${response.status}`)
  }

  const data: unknown = await response.json()
  if (
    typeof data !== 'object' ||
    data === null ||
    !('access_token' in data) ||
    !('expires_in' in data) ||
    typeof data.access_token !== 'string' ||
    typeof data.expires_in !== 'number'
  ) {
    throw new Error('Google token response is missing required fields')
  }

  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    identity,
  }
  return data.access_token
}

export type ShortLink = {
  id: string
  slug: string
  targetUrl: string
  active: boolean
  createdAt: string | null
}

type FirestoreValue = { stringValue?: string; booleanValue?: boolean; timestampValue?: string }
type FirestoreDocument = { name?: string; fields?: Record<string, FirestoreValue> }
type QueryResult = { document?: FirestoreDocument }

export async function listUserLinks(env: FirestoreBindings, uid: string): Promise<ShortLink[]> {
  const account = getServiceAccount(env)
  const token = await getAccessToken(account)
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/databases/(default)/documents/pendekin/data:runQuery`

  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'links' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'ownerId' },
            op: 'EQUAL',
            value: { stringValue: uid },
          },
        },
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`Firestore request failed with HTTP ${response.status}`)
  }

  const results: QueryResult[] = await response.json()
  if (!Array.isArray(results)) throw new Error('Invalid Firestore query response')

  return results.flatMap(({ document }) => {
    const link = document ? parseLink(document) : null
    return link ? [link] : []
  }).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}

function documentUrl(projectId: string, slug: string): string {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${LINKS_COLLECTION}/${encodeURIComponent(slug)}`
}

function parseLink(document: FirestoreDocument): ShortLink | null {
  if (!document.name || !document.fields?.targetUrl?.stringValue) return null
  const id = document.name.split('/').at(-1) ?? ''
  return {
    id,
    slug: document.fields.slug?.stringValue ?? id,
    targetUrl: document.fields.targetUrl.stringValue,
    active: document.fields.active?.booleanValue === true,
    createdAt: document.fields.createdAt?.timestampValue ?? null,
  }
}

export async function createUserLink(env: FirestoreBindings, uid: string, targetUrl: string): Promise<ShortLink> {
  const account = getServiceAccount(env)
  const token = await getAccessToken(account)
  const createdAt = new Date().toISOString()

  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = crypto.randomUUID().replaceAll('-', '').slice(0, 8)
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/databases/(default)/documents/${LINKS_COLLECTION}?documentId=${slug}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        fields: {
          ownerId: { stringValue: uid },
          slug: { stringValue: slug },
          targetUrl: { stringValue: targetUrl },
          active: { booleanValue: true },
          createdAt: { timestampValue: createdAt },
        },
      }),
    })
    if (response.status === 409) continue
    if (!response.ok) throw new Error(`Firestore create failed with HTTP ${response.status}`)
    const link = parseLink(await response.json())
    if (!link) throw new Error('Invalid Firestore create response')
    return link
  }
  throw new Error('Could not allocate a short code')
}

async function getDocument(env: FirestoreBindings, slug: string): Promise<{ account: ServiceAccount; token: string; document: FirestoreDocument & { updateTime?: string } } | null> {
  const account = getServiceAccount(env)
  const token = await getAccessToken(account)
  const response = await fetch(documentUrl(account.project_id, slug), {
    headers: { authorization: `Bearer ${token}` },
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Firestore read failed with HTTP ${response.status}`)
  return { account, token, document: await response.json() }
}

export async function setUserLinkActive(env: FirestoreBindings, uid: string, slug: string, active: boolean): Promise<ShortLink | null> {
  const existing = await getDocument(env, slug)
  if (!existing || existing.document.fields?.ownerId?.stringValue !== uid) return null
  const url = new URL(documentUrl(existing.account.project_id, slug))
  url.searchParams.set('updateMask.fieldPaths', 'active')
  if (existing.document.updateTime) url.searchParams.set('currentDocument.updateTime', existing.document.updateTime)
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${existing.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ fields: { active: { booleanValue: active } } }),
  })
  if (!response.ok) throw new Error(`Firestore update failed with HTTP ${response.status}`)
  return parseLink(await response.json())
}

export async function resolveShortLink(env: FirestoreBindings, slug: string): Promise<string | null> {
  const existing = await getDocument(env, slug)
  if (!existing || existing.document.fields?.active?.booleanValue !== true) return null
  const targetUrl = existing.document.fields.targetUrl?.stringValue
  if (!targetUrl) return null
  try {
    const parsed = new URL(targetUrl)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}
