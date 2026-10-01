import { firestoreDocumentUrl, getFirestoreAccess, type FirestoreBindings } from './firestore-client.ts'

const KEY_COLLECTION = 'pendekin/data/apiKeys'
const TOKEN_PATTERN = /^pk_([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/
const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/
const HASH_PATTERN = /^[0-9a-f]{64}$/

export type ApiKeyMetadata = {
  id: string
  name: string
  createdAt: string
}

export type IssuedApiKey = {
  key: ApiKeyMetadata
  token: string
}

type FirestoreValue = { stringValue?: string; timestampValue?: string }
type FirestoreDocument = {
  name?: string
  updateTime?: string
  fields?: Record<string, FirestoreValue>
}
type QueryResult = { document?: FirestoreDocument }

function normalizedName(name: string): string {
  const value = name.trim()
  if (!value || value.length > 80) throw new Error('Invalid API key name')
  return value
}

function randomBase64Url(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

async function digestSecret(secret: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function constantTimeDigestEqual(expected: string, actual: string): boolean {
  if (!HASH_PATTERN.test(expected) || !HASH_PATTERN.test(actual)) return false
  let difference = 0
  for (let index = 0; index < expected.length; index++) {
    difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index)
  }
  return difference === 0
}

function documentId(document: FirestoreDocument): string | null {
  if (typeof document.name !== 'string') return null
  const id = document.name.split('/').at(-1) ?? ''
  return ID_PATTERN.test(id) ? id : null
}

function parseMetadata(document: FirestoreDocument, ownerId: string): ApiKeyMetadata | null {
  const id = documentId(document)
  const fields = document.fields
  const name = fields?.name?.stringValue
  const createdAt = fields?.createdAt?.timestampValue
  if (
    !id || fields?.ownerId?.stringValue !== ownerId ||
    typeof name !== 'string' || !name || name.length > 80 ||
    typeof createdAt !== 'string'
  ) return null
  return { id, name, createdAt }
}

function keyDocumentUrl(projectId: string, id: string): string {
  return firestoreDocumentUrl(projectId, KEY_COLLECTION + '/' + encodeURIComponent(id))
}

export async function createApiKey(env: FirestoreBindings, uid: string, name: string): Promise<IssuedApiKey> {
  const ownerId = uid.trim()
  if (!ownerId) throw new Error('API key owner is required')
  const keyName = normalizedName(name)
  const { projectId, token: accessToken } = await getFirestoreAccess(env)
  const createdAt = new Date().toISOString()

  for (let attempt = 0; attempt < 3; attempt++) {
    const id = randomBase64Url(16)
    const secret = randomBase64Url(32)
    const fullToken = 'pk_' + id + '.' + secret
    const secretHash = await digestSecret(secret)
    const url = new URL(firestoreDocumentUrl(projectId, KEY_COLLECTION))
    url.searchParams.set('documentId', id)
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + accessToken, 'content-type': 'application/json' },
      body: JSON.stringify({
        fields: {
          ownerId: { stringValue: ownerId },
          name: { stringValue: keyName },
          secretHash: { stringValue: secretHash },
          createdAt: { timestampValue: createdAt },
        },
      }),
    })
    if (response.status === 409) continue
    if (!response.ok) throw new Error('Firestore API key create failed with HTTP ' + response.status)
    return { key: { id, name: keyName, createdAt }, token: fullToken }
  }

  throw new Error('Could not allocate an API key ID')
}

export async function listApiKeys(env: FirestoreBindings, uid: string): Promise<ApiKeyMetadata[]> {
  const { projectId, token } = await getFirestoreAccess(env)
  const url = firestoreDocumentUrl(projectId, 'pendekin/data:runQuery')
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'apiKeys' }],
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
  if (!response.ok) throw new Error('Firestore API key list failed with HTTP ' + response.status)

  const results: QueryResult[] = await response.json()
  if (!Array.isArray(results)) throw new Error('Invalid Firestore API key query response')
  return results.flatMap(({ document }) => {
    const metadata = document ? parseMetadata(document, uid) : null
    return metadata ? [metadata] : []
  }).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export async function deleteApiKey(env: FirestoreBindings, uid: string, id: string): Promise<boolean> {
  if (!ID_PATTERN.test(id)) return false
  const { projectId, token } = await getFirestoreAccess(env)
  const url = keyDocumentUrl(projectId, id)
  const existingResponse = await fetch(url, {
    headers: { authorization: 'Bearer ' + token },
  })
  if (existingResponse.status === 404) return false
  if (!existingResponse.ok) throw new Error('Firestore API key read failed with HTTP ' + existingResponse.status)
  const existing: FirestoreDocument = await existingResponse.json()
  if (existing.fields?.ownerId?.stringValue !== uid) return false
  if (typeof existing.updateTime !== 'string') throw new Error('Firestore API key is missing updateTime')

  const deleteUrl = new URL(url)
  deleteUrl.searchParams.set('currentDocument.updateTime', existing.updateTime)
  const response = await fetch(deleteUrl, {
    method: 'DELETE',
    headers: { authorization: 'Bearer ' + token },
  })
  if (response.status === 404) return false
  if (!response.ok) throw new Error('Firestore API key delete failed with HTTP ' + response.status)
  return true
}

export async function resolveApiKey(env: FirestoreBindings, tokenValue: string): Promise<string | null> {
  const match = TOKEN_PATTERN.exec(tokenValue)
  if (!match) return null
  const [, id, secret] = match
  const { projectId, token } = await getFirestoreAccess(env)
  const response = await fetch(keyDocumentUrl(projectId, id), {
    headers: { authorization: 'Bearer ' + token },
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error('Firestore API key lookup failed with HTTP ' + response.status)
  const document: FirestoreDocument = await response.json()
  const ownerId = document.fields?.ownerId?.stringValue
  const storedHash = document.fields?.secretHash?.stringValue
  if (typeof ownerId !== 'string' || !ownerId || typeof storedHash !== 'string') return null

  const actualHash = await digestSecret(secret)
  return constantTimeDigestEqual(storedHash, actualHash) ? ownerId : null
}
