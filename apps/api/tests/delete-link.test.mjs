import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { test } from 'node:test'
import { deleteUserLink } from '../src/firestore.ts'

test('deleteUserLink only deletes links owned by the caller', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const env = {
    FIREBASE_PROJECT_ID: 'test-project',
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      project_id: 'test-project',
      client_email: 'test@example.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    }),
  }
  const originalFetch = globalThis.fetch
  const requests = []
  let ownerId = 'owner'
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input)
    requests.push({ url, method: init.method ?? 'GET' })
    if (url.hostname === 'oauth2.googleapis.com') {
      return Response.json({ access_token: 'test-token', expires_in: 3600 })
    }
    if (init.method === 'DELETE') return new Response(null, { status: 200 })
    return Response.json({
      name: 'projects/test-project/databases/(default)/documents/pendekin/data/links/abcd1234',
      updateTime: '2026-10-01T00:00:00Z',
      fields: {
        ownerId: { stringValue: ownerId },
        targetUrl: { stringValue: 'https://example.com/page' },
      },
    })
  }
  try {
    assert.equal(await deleteUserLink(env, 'other-user', 'abcd1234'), false)
    assert.equal(requests.filter((request) => request.method === 'DELETE').length, 0)
    ownerId = 'owner'
    assert.equal(await deleteUserLink(env, 'owner', 'abcd1234'), true)
    const deletes = requests.filter((request) => request.method === 'DELETE')
    assert.equal(deletes.length, 1)
    assert.equal(deletes[0].url.searchParams.get('currentDocument.updateTime'), '2026-10-01T00:00:00Z')
  } finally {
    globalThis.fetch = originalFetch
  }
})
