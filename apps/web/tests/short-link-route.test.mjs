import assert from 'node:assert/strict'
import { test } from 'node:test'
import { onRequestGet } from '../../../functions/r/[slug].js'

test('web short-link route returns the Worker redirect without following it', async () => {
  const originalFetch = globalThis.fetch
  let requestedUrl
  let options
  globalThis.fetch = async (url, init) => {
    requestedUrl = url.toString()
    options = init
    return Response.redirect('https://example.com/page', 302)
  }
  try {
    const response = await onRequestGet({
      params: { slug: 'a1b2c3d4' },
      env: { API_REDIRECT_ORIGIN: 'https://api.example.test' },
    })
    assert.equal(requestedUrl, 'https://api.example.test/r/a1b2c3d4')
    assert.equal(options.redirect, 'manual')
    assert.equal(response.status, 302)
    assert.equal(response.headers.get('location'), 'https://example.com/page')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('web short-link route preserves missing-link responses', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('Link not found', { status: 404 })
  try {
    const response = await onRequestGet({ params: { slug: 'missing1' }, env: {} })
    assert.equal(response.status, 404)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('web short-link route rejects an invalid slug before fetching', async () => {
  const response = await onRequestGet({ params: { slug: 'bad' }, env: {} })
  assert.equal(response.status, 404)
})

test('web short-link route reports an unavailable API', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('Network unavailable') }
  try {
    const response = await onRequestGet({ params: { slug: 'a1b2c3d4' }, env: {} })
    assert.equal(response.status, 502)
  } finally {
    globalThis.fetch = originalFetch
  }
})
