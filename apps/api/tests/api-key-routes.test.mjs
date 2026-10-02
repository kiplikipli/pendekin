import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { test } from 'node:test'
import { createApp } from '../src/index.ts'

function testEnvironment() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  return {
    FIREBASE_PROJECT_ID: 'test-project',
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      project_id: 'test-project',
      client_email: 'api-key-routes-test@example.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      private_key_id: crypto.randomUUID(),
    }),
  }
}

function linkDocument(slug, ownerId, active = true) {
  return {
    name: 'projects/test-project/databases/(default)/documents/pendekin/data/links/' + slug,
    updateTime: '2026-10-01T00:00:00Z',
    fields: {
      ownerId: { stringValue: ownerId },
      slug: { stringValue: slug },
      targetUrl: { stringValue: 'https://' + ownerId + '.example/path' },
      active: { booleanValue: active },
      createdAt: { timestampValue: '2026-10-01T00:00:00Z' },
    },
  }
}

function mockFirestore(seed = []) {
  const originalFetch = globalThis.fetch
  const documents = new Map(seed)
  const writes = []
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input)
    if (url.hostname === 'oauth2.googleapis.com') {
      return Response.json({ access_token: 'test-token', expires_in: 3600 })
    }
    const method = init.method ?? 'GET'
    const basePath = '/v1/projects/test-project/databases/(default)/documents/'
    const documentPath = url.pathname.slice(basePath.length)
    if (documentPath === 'pendekin/data:runQuery') {
      const query = JSON.parse(init.body).structuredQuery
      const collection = query.from[0].collectionId
      const ownerId = query.where.fieldFilter.value.stringValue
      return Response.json([...documents.entries()]
        .filter(([path, document]) => path.startsWith('pendekin/data/' + collection + '/') &&
          document.fields.ownerId.stringValue === ownerId)
        .map(([, document]) => ({ document })))
    }

    const pathParts = documentPath.split('/')
    const collection = pathParts.at(-1) === 'links' || pathParts.at(-1) === 'apiKeys'
      ? pathParts.at(-1)
      : pathParts.at(-2)
    const id = pathParts.at(-1)
    if (method === 'POST' && (collection === 'links' || collection === 'apiKeys')) {
      const documentId = url.searchParams.get('documentId')
      const key = 'pendekin/data/' + collection + '/' + documentId
      if (documents.has(key)) return Response.json({}, { status: 409 })
      const document = {
        name: 'projects/test-project/databases/(default)/documents/' + key,
        updateTime: '2026-10-01T00:00:00Z',
        fields: JSON.parse(init.body).fields,
      }
      documents.set(key, document)
      writes.push({ method, key })
      return Response.json(document)
    }

    const key = 'pendekin/data/' + collection + '/' + id
    const existing = documents.get(key)
    if (!existing) return Response.json({}, { status: 404 })
    if (method === 'PATCH') {
      existing.fields = { ...existing.fields, ...JSON.parse(init.body).fields }
      writes.push({ method, key })
      return Response.json(existing)
    }
    if (method === 'DELETE') {
      if (url.searchParams.get('currentDocument.updateTime') !== existing.updateTime) {
        return Response.json({}, { status: 409 })
      }
      documents.delete(key)
      writes.push({ method, key })
      return new Response(null, { status: 200 })
    }
    return Response.json(existing)
  }
  return {
    documents,
    writes,
    restore() { globalThis.fetch = originalFetch },
  }
}

function authHeader(token) {
  return { authorization: 'Bearer ' + token }
}

test('Firebase users manage keys; API keys cannot manage keys or read /api/me', async () => {
  const env = testEnvironment()
  const firestore = mockFirestore()
  const app = createApp({
    verifySession: async (token) => token === 'firebase-admin'
      ? { uid: 'admin', email: null, name: null, role: 'admin' }
      : { uid: token === 'firebase-bob' ? 'bob' : 'alice', email: null, name: null, role: 'user' },
    resolveKey: async (_bindings, token) => token === 'pk_valid' ? 'alice' : null,
  })
  try {
    const createdResponse = await app.request('/api/keys', {
      method: 'POST', headers: { ...authHeader('firebase-alice'), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Automation' }),
    }, env)
    assert.equal(createdResponse.status, 201)
    const created = await createdResponse.json()
    assert.equal(firestore.documents.get('pendekin/data/apiKeys/' + created.key.id).fields.ownerId.stringValue, 'alice')

    const listResponse = await app.request('/api/keys', { headers: authHeader('firebase-alice') }, env)
    const listed = await listResponse.json()
    assert.deepEqual(listed.keys.map((key) => key.id), [created.key.id])
    assert.equal('token' in listed.keys[0], false)
    assert.equal('secretHash' in listed.keys[0], false)

    const otherOwnerDelete = await app.request('/api/keys/' + created.key.id, {
      method: 'DELETE', headers: authHeader('firebase-bob'),
    }, env)
    assert.equal(otherOwnerDelete.status, 404)

    const keyManage = await app.request('/api/keys', { headers: authHeader('pk_valid') }, env)
    const keyMe = await app.request('/api/me', { headers: authHeader('pk_valid') }, env)
    assert.equal(keyManage.status, 403)
    assert.equal(keyMe.status, 403)

    const adminCreate = await app.request('/api/keys', {
      method: 'POST', headers: { ...authHeader('firebase-admin'), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Admin key' }),
    }, env)
    assert.equal(adminCreate.status, 403)

    const deleted = await app.request('/api/keys/' + created.key.id, {
      method: 'DELETE', headers: authHeader('firebase-alice'),
    }, env)
    assert.equal(deleted.status, 200)
    assert.equal((await app.request('/api/health')).status, 200)
  } finally {
    firestore.restore()
  }
})

test('missing, malformed, unknown, and revoked API keys share a generic 401', async () => {
  const env = testEnvironment()
  const app = createApp({
    verifySession: async () => { throw new Error('Invalid Firebase token') },
    resolveKey: async (_bindings, token) => token === 'pk_valid' ? 'alice' : null,
  })
  const missing = await app.request('/api/links', {}, env)
  const malformed = await app.request('/api/links', { headers: authHeader('pk_bad') }, env)
  const unknown = await app.request('/api/links', { headers: authHeader('pk_unknown') }, env)
  assert.equal(missing.status, 401)
  assert.equal(malformed.status, 401)
  assert.equal(unknown.status, 401)
  const missingBody = await missing.json()
  const malformedBody = await malformed.json()
  const unknownBody = await unknown.json()
  assert.deepEqual(missingBody, malformedBody)
  assert.deepEqual(malformedBody, unknownBody)
})

test('key authentication returns service errors without falling back to an anonymous user', async () => {
  const env = testEnvironment()
  const failedLookupApp = createApp({
    verifySession: async () => { throw new Error('Invalid Firebase token') },
    resolveKey: async () => { throw new Error('Firestore unavailable') },
  })
  const failedLookup = await failedLookupApp.request('/api/links', {
    headers: authHeader('pk_valid'),
  }, env)
  assert.equal(failedLookup.status, 502)

  const missingStorage = await failedLookupApp.request('/api/links', {
    headers: authHeader('pk_valid'),
  }, { ...env, FIREBASE_SERVICE_ACCOUNT_JSON: undefined })
  assert.equal(missingStorage.status, 503)
})

test('API preflight responses also disable caching', async () => {
  const app = createApp()
  const response = await app.request('/api/keys', {
    method: 'OPTIONS',
    headers: {
      origin: 'https://external.example',
      'access-control-request-method': 'GET',
    },
  })
  assert.equal(response.status, 204)
  assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('API key link operations use the owner UID and cannot change another user links', async () => {
  const env = { ...testEnvironment(), SHORT_URL_ORIGIN: 'https://go.example' }
  const firestore = mockFirestore([
    ['pendekin/data/links/alice123', linkDocument('alice123', 'alice')],
    ['pendekin/data/links/bob12345', linkDocument('bob12345', 'bob')],
  ])
  const app = createApp({
    verifySession: async () => { throw new Error('Invalid Firebase token') },
    resolveKey: async (_bindings, token) => token === 'pk_valid' ? 'alice' : null,
  })
  try {
    const headers = authHeader('pk_valid')
    const list = await app.request('/api/links', { headers }, env)
    const listed = await list.json()
    assert.deepEqual(listed.links.map((link) => link.slug), ['alice123'])
    assert.equal(listed.links[0].shortUrl, 'https://go.example/r/alice123')

    const createdResponse = await app.request('/api/links', {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ targetUrl: 'https://example.com/new' }),
    }, env)
    assert.equal(createdResponse.status, 201)
    const created = await createdResponse.json()
    const createdDocument = [...firestore.documents.values()].find((document) =>
      document.fields.slug.stringValue === created.link.slug)
    assert.equal(createdDocument.fields.ownerId.stringValue, 'alice')
    assert.equal(created.link.shortUrl, 'https://go.example/r/' + created.link.slug)

    const writesBeforeForeignPatch = firestore.writes.length
    const foreignPatch = await app.request('/api/links/bob12345', {
      method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ active: false }),
    }, env)
    assert.equal(foreignPatch.status, 404)
    assert.equal(firestore.writes.length, writesBeforeForeignPatch)

    for (const active of [false, true]) {
      const updated = await app.request('/api/links/alice123', {
        method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ active }),
      }, env)
      assert.equal(updated.status, 200)
      const updatedLink = (await updated.json()).link
      assert.equal(updatedLink.active, active)
      assert.equal(updatedLink.shortUrl, 'https://go.example/r/alice123')
    }

    const foreignDelete = await app.request('/api/links/bob12345', { method: 'DELETE', headers }, env)
    assert.equal(foreignDelete.status, 404)
    const ownDelete = await app.request('/api/links/alice123', { method: 'DELETE', headers }, env)
    assert.equal(ownDelete.status, 200)
  } finally {
    firestore.restore()
  }
})

test('invalid short URL origin fails before creating a link', async () => {
  const env = { ...testEnvironment(), SHORT_URL_ORIGIN: 'https://go.example/path' }
  const firestore = mockFirestore()
  const app = createApp({ resolveKey: async () => 'alice' })
  try {
    const response = await app.request('/api/links', {
      method: 'POST', headers: { ...authHeader('pk_valid'), 'content-type': 'application/json' },
      body: JSON.stringify({ targetUrl: 'https://example.com' }),
    }, env)
    assert.equal(response.status, 503)
    assert.equal(firestore.writes.length, 0)
  } finally {
    firestore.restore()
  }
})
