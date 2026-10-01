import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { test } from 'node:test'
import { getFirestoreAccess } from '../src/firestore-client.ts'

test('getFirestoreAccess exchanges the configured account for a Firestore token', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const env = {
    FIREBASE_PROJECT_ID: 'test-project',
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      project_id: 'test-project',
      client_email: 'test@example.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      private_key_id: 'test-key',
    }),
  }
  const originalFetch = globalThis.fetch
  let tokenRequests = 0
  globalThis.fetch = async (input, init = {}) => {
    assert.equal(new URL(input).hostname, 'oauth2.googleapis.com')
    assert.equal(init.method, 'POST')
    tokenRequests++
    return Response.json({ access_token: 'firestore-test-token', expires_in: 3600 })
  }

  try {
    const access = await getFirestoreAccess(env)
    assert.deepEqual(access, { projectId: 'test-project', token: 'firestore-test-token' })
    assert.equal(tokenRequests, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})
