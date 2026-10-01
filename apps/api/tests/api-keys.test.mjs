import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { test } from 'node:test'
import { createApiKey, deleteApiKey, listApiKeys, resolveApiKey } from '../src/api-keys.ts'

function testEnvironment() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  return {
    FIREBASE_PROJECT_ID: 'test-project',
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      project_id: 'test-project',
      client_email: 'api-keys-test@example.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      private_key_id: crypto.randomUUID(),
    }),
  }
}

function mockFirestore({ status = 200 } = {}) {
  const documents = new Map()
  const originalFetch = globalThis.fetch
  const collectionPath = '/v1/projects/test-project/databases/(default)/documents/pendekin/data/apiKeys'
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input)
    if (url.hostname === 'oauth2.googleapis.com') {
      return Response.json({ access_token: 'test-token', expires_in: 3600 })
    }
    if (status !== 200) return Response.json({ error: 'Firestore unavailable' }, { status })
    assert.equal(init.headers?.authorization, 'Bearer test-token')
    if (url.pathname.endsWith('/pendekin/data:runQuery')) {
      const query = JSON.parse(init.body)
      const ownerId = query.structuredQuery.where.fieldFilter.value.stringValue
      const results = [...documents.values()]
        .filter((document) => document.fields.ownerId.stringValue === ownerId)
        .map((document) => ({ document }))
      return Response.json(results)
    }

    const id = url.pathname.slice(collectionPath.length + 1)
    const method = init.method ?? 'GET'
    if (method === 'POST') {
      const documentId = url.searchParams.get('documentId')
      if (documents.has(documentId)) return Response.json({}, { status: 409 })
      const document = {
        name: collectionPath + '/' + documentId,
        updateTime: '2026-10-01T00:00:00Z',
        fields: JSON.parse(init.body).fields,
      }
      documents.set(documentId, document)
      return Response.json(document)
    }
    if (method === 'DELETE') {
      const document = documents.get(id)
      if (!document) return Response.json({}, { status: 404 })
      assert.equal(url.searchParams.get('currentDocument.updateTime'), document.updateTime)
      documents.delete(id)
      return new Response(null, { status: 200 })
    }
    const document = documents.get(id)
    return document ? Response.json(document) : Response.json({}, { status: 404 })
  }
  return {
    documents,
    restore() { globalThis.fetch = originalFetch },
  }
}

test('createApiKey stores only a digest and resolves to its owner', async () => {
  const env = testEnvironment()
  const firestore = mockFirestore()
  try {
    const issued = await createApiKey(env, 'alice', 'Automation')
    assert.match(issued.token, /^pk_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/)
    assert.equal(issued.key.name, 'Automation')
    assert.equal(await resolveApiKey(env, issued.token), 'alice')
    assert.equal(await resolveApiKey(env, issued.token.slice(0, -1) + '!'), null)

    const stored = firestore.documents.get(issued.key.id)
    assert.equal(stored.fields.ownerId.stringValue, 'alice')
    assert.match(stored.fields.secretHash.stringValue, /^[0-9a-f]{64}$/)
    assert.equal(JSON.stringify(stored).includes(issued.token), false)
    assert.equal(JSON.stringify(stored).includes(issued.token.split('.')[1]), false)

    assert.deepEqual((await listApiKeys(env, 'alice')).map((key) => key.id), [issued.key.id])
    assert.deepEqual(await listApiKeys(env, 'bob'), [])
  } finally {
    firestore.restore()
  }
})

test('deleteApiKey requires ownership and revokes the key immediately', async () => {
  const env = testEnvironment()
  const firestore = mockFirestore()
  try {
    const issued = await createApiKey(env, 'alice', 'Automation')
    assert.equal(await deleteApiKey(env, 'bob', issued.key.id), false)
    assert.equal(await deleteApiKey(env, 'alice', 'invalid-id'), false)
    assert.equal(await deleteApiKey(env, 'alice', issued.key.id), true)
    assert.equal(await resolveApiKey(env, issued.token), null)
  } finally {
    firestore.restore()
  }
})

test('createApiKey rejects invalid names and resolveApiKey propagates Firestore failures', async () => {
  const env = testEnvironment()
  const firestore = mockFirestore()
  try {
    await assert.rejects(createApiKey(env, 'alice', '   '), /Invalid API key name/)
    await assert.rejects(createApiKey(env, 'alice', 'x'.repeat(81)), /Invalid API key name/)
    const issued = await createApiKey(env, 'alice', 'Automation')
    firestore.restore()
    const failing = mockFirestore({ status: 500 })
    try {
      await assert.rejects(resolveApiKey(env, issued.token), /HTTP 500/)
    } finally {
      failing.restore()
    }
  } finally {
    firestore.restore()
  }
})
