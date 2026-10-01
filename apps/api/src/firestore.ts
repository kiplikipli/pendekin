import { getFirestoreAccess, firestoreDocumentUrl, type FirestoreBindings } from './firestore-client.ts'

export const LINKS_COLLECTION = 'pendekin/data/links'

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
  const { projectId, token } = await getFirestoreAccess(env)
  const url = firestoreDocumentUrl(projectId, 'pendekin/data:runQuery')

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
  const { projectId, token } = await getFirestoreAccess(env)
  const createdAt = new Date().toISOString()

  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = crypto.randomUUID().replaceAll('-', '').slice(0, 8)
    const url = new URL(firestoreDocumentUrl(projectId, LINKS_COLLECTION))
    url.searchParams.set('documentId', slug)
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

async function getDocument(env: FirestoreBindings, slug: string): Promise<{ projectId: string; token: string; document: FirestoreDocument & { updateTime?: string } } | null> {
  const { projectId, token } = await getFirestoreAccess(env)
  const path = LINKS_COLLECTION + '/' + encodeURIComponent(slug)
  const response = await fetch(firestoreDocumentUrl(projectId, path), {
    headers: { authorization: `Bearer ${token}` },
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Firestore read failed with HTTP ${response.status}`)
  return { projectId, token, document: await response.json() }
}

export async function setUserLinkActive(env: FirestoreBindings, uid: string, slug: string, active: boolean): Promise<ShortLink | null> {
  const existing = await getDocument(env, slug)
  if (!existing || existing.document.fields?.ownerId?.stringValue !== uid) return null
  const url = new URL(firestoreDocumentUrl(existing.projectId, LINKS_COLLECTION + '/' + encodeURIComponent(slug)))
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

export async function deleteUserLink(env: FirestoreBindings, uid: string, slug: string): Promise<boolean> {
  const existing = await getDocument(env, slug)
  if (!existing || existing.document.fields?.ownerId?.stringValue !== uid) return false
  const url = new URL(firestoreDocumentUrl(existing.projectId, LINKS_COLLECTION + '/' + encodeURIComponent(slug)))
  if (existing.document.updateTime) url.searchParams.set('currentDocument.updateTime', existing.document.updateTime)
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${existing.token}` },
  })
  if (!response.ok) throw new Error(`Firestore delete failed with HTTP ${response.status}`)
  return true
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
