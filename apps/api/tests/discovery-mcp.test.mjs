import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createApp } from '../src/index.ts'

const base = 'https://api.example.test'

test('machine-readable discovery endpoints return raw Markdown and the public OpenAPI contract', async () => {
  const app = createApp()
  const specResponse = await app.request(base + '/openapi.json')
  assert.equal(specResponse.status, 200)
  assert.match(specResponse.headers.get('content-type'), /application\/json/)
  assert.match(specResponse.headers.get('cache-control'), /max-age=300/)
  assert.equal(specResponse.headers.get('access-control-allow-origin'), '*')
  const spec = await specResponse.json()
  assert.equal(spec.openapi, '3.1.0')
  assert.equal(spec.servers[0].url, base)
  assert.equal(spec.paths['/api/links'].get.operationId, 'listLinks')
  assert.equal(spec.paths['/api/links'].post.operationId, 'createLink')
  assert.equal(spec.paths['/api/links'].get.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/LinkList')
  assert.deepEqual(spec.paths['/api/links'].get.security, [{ bearerAuth: [] }])
  assert.equal(spec.paths['/api/keys'].get.description.includes('API keys cannot call'), true)
  const ids = Object.values(spec.paths).flatMap((path) => Object.values(path).map((operation) => operation.operationId))
  assert.equal(ids.length, new Set(ids).size)

  const llms = await app.request(base + '/llms.txt')
  assert.equal(llms.status, 200)
  assert.match(llms.headers.get('content-type'), /^text\/markdown/)
  const index = await llms.text()
  assert.match(index, /https:\/\/api\.example\.test\/openapi\.json/)
  assert.match(index, /https:\/\/api\.example\.test\/mcp/)
  assert.doesNotMatch(index, /<html|<script/i)
  for (const name of ['getting-started', 'authentication', 'errors', 'links', 'rate-limits', 'pagination']) {
    const response = await app.request(base + '/docs/' + name + '.md')
    assert.equal(response.status, 200, name)
    assert.match(response.headers.get('content-type'), /^text\/markdown/)
    const markdown = await response.text()
    assert.match(markdown, /^# /)
    const source = name === 'links' ? new URL('../../../docs/api.md', import.meta.url) : new URL('../docs/' + name + '.md', import.meta.url)
    assert.equal(markdown, await readFile(source, 'utf8'))
    assert.doesNotMatch(markdown, /<html|<script/i)
    assert.match(index, new RegExp('/docs/' + name + '\\.md'))
  }
})

test('official MCP HTTP client connects, lists schemas, reads links, and gets structured input errors', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const env = {
    FIREBASE_PROJECT_ID: 'test-project',
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      project_id: 'test-project', client_email: 'test@example.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    }),
  }
  const app = createApp({ resolveKey: async (_env, token) => token === 'pk_test' ? 'alice' : null })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input)
    if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'test-token', expires_in: 3600 })
    if (url.hostname === 'firestore.googleapis.com' && url.pathname.endsWith('/pendekin/data:runQuery')) {
      return Response.json([{ document: {
        name: 'projects/test-project/databases/(default)/documents/pendekin/data/links/alice123',
        fields: { ownerId: { stringValue: 'alice' }, slug: { stringValue: 'alice123' },
          targetUrl: { stringValue: 'https://example.com/' }, active: { booleanValue: true },
          createdAt: { timestampValue: '2026-10-01T00:00:00Z' } },
      } }])
    }
    throw new Error('Unexpected outbound fetch: ' + url)
  }
  const client = new Client({ name: 'discovery-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
    requestInit: { headers: { authorization: 'Bearer pk_test' } },
    fetch: (input, init) => app.fetch(new Request(input, init), env),
  })
  try {
    await client.connect(transport)
    const listed = await client.listTools()
    assert.deepEqual(listed.tools.map((tool) => tool.name), ['list_links', 'create_link', 'set_link_active', 'delete_link'])
    assert.equal(listed.tools.find((tool) => tool.name === 'create_link').inputSchema.properties.targetUrl.type, 'string')
    const read = await client.callTool({ name: 'list_links', arguments: {} })
    assert.equal(read.isError, undefined)
    assert.equal(read.structuredContent.links[0].slug, 'alice123')
    assert.equal(read.structuredContent.links[0].shortUrl, base + '/r/alice123')
    const invalid = await client.callTool({ name: 'set_link_active', arguments: { slug: 'bad', active: false } })
    assert.equal(invalid.isError, true)
    assert.equal(invalid.structuredContent.error.code, 'INVALID_INPUT')
    assert.equal(invalid.structuredContent.error.retryable, false)
    const forbidden = await app.request(base + '/api/me', { headers: { authorization: 'Bearer pk_test' } }, env)
    assert.equal(forbidden.status, 403)
  } finally {
    await client.close()
    globalThis.fetch = originalFetch
  }
})
