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

export async function checkFirestoreConnection(env: FirestoreBindings): Promise<void> {
  const account = getServiceAccount(env)
  const token = await getAccessToken(account)
  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/databases/(default)/documents/${LINKS_COLLECTION}`,
  )
  url.searchParams.set('pageSize', '1')

  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  })

  if (!response.ok) {
    throw new Error(`Firestore request failed with HTTP ${response.status}`)
  }
}
