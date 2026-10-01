import { Hono, type MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'
import { verifyFirebaseToken, type AuthenticatedUser } from './auth.ts'
import { createApiKey, deleteApiKey, listApiKeys, resolveApiKey, type ApiKeyMetadata } from './api-keys.ts'
import type { FirestoreBindings } from './firestore-client.ts'
import { resolveShortLink } from './firestore.ts'
import { ApiError, createLink, listLinks, removeLink, updateLink } from './link-service.ts'
import { serveMcp } from './mcp.ts'
import { openApiDocument } from './openapi.ts'
import { documentation, llmsIndex } from './documentation.ts'

type Bindings = FirestoreBindings
type Variables = { user: AuthenticatedUser }
type AppEnvironment = { Bindings: Bindings; Variables: Variables }
type AuthDependencies = {
  verifySession: typeof verifyFirebaseToken
  resolveKey: typeof resolveApiKey
}

function acceptsApiKey(path: string, method: string): boolean {
  if (path === '/mcp') return method === 'POST' || method === 'GET' || method === 'DELETE'
  if (path === '/api/links') return method === 'GET' || method === 'POST'
  if (/^\/api\/links\/[^/]+$/.test(path)) return method === 'PATCH' || method === 'DELETE'
  return false
}

function failure(status: 400 | 401 | 403 | 404 | 502 | 503, code: string, message: string): Response {
  return Response.json({ error: message, code, retryable: status === 502 || status === 503 }, { status })
}

function serviceFailure(error: unknown): Response {
  if (error instanceof ApiError) return failure(error.status, error.code, error.message)
  return failure(502, 'UPSTREAM_ERROR', 'Could not complete request')
}

const origin = (url: string) => new URL(url).origin

export function createApp(dependencies: Partial<AuthDependencies> = {}) {
  const verifySession = dependencies.verifySession ?? verifyFirebaseToken
  const resolveKey = dependencies.resolveKey ?? resolveApiKey
  const app = new Hono<AppEnvironment>()

  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    await next()
  })
  app.use('/mcp', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    await next()
  })
  app.use('/api/*', cors())

  const authenticate: MiddlewareHandler<AppEnvironment> = async (c, next) => {
    if (c.req.path === '/api/health') return next()
    const bearer = c.req.header('authorization')?.match(/^Bearer (.+)$/i)?.[1]
    if (!bearer) return failure(401, 'AUTHENTICATION_REQUIRED', 'Authentication required')

    if (bearer.startsWith('pk_')) {
      if (!c.env.FIREBASE_PROJECT_ID) return failure(503, 'SERVICE_UNAVAILABLE', 'Authentication is not configured')
      if (!c.env.FIREBASE_SERVICE_ACCOUNT_JSON) return failure(503, 'SERVICE_UNAVAILABLE', 'API key storage is not configured')
      let uid: string | null
      try { uid = await resolveKey(c.env, bearer) }
      catch { return failure(502, 'UPSTREAM_ERROR', 'Could not authenticate API key') }
      if (!uid) return failure(401, 'AUTHENTICATION_REQUIRED', 'Authentication required')
      if (!acceptsApiKey(c.req.path, c.req.method)) return failure(403, 'FORBIDDEN', 'API keys cannot access this route')
      c.set('user', { uid, email: null, name: null, role: 'user' })
      return next()
    }

    if (!c.env.FIREBASE_PROJECT_ID) return failure(503, 'SERVICE_UNAVAILABLE', 'Authentication is not configured')
    try { c.set('user', await verifySession(bearer, c.env.FIREBASE_PROJECT_ID)) }
    catch { return failure(401, 'AUTHENTICATION_REQUIRED', 'Invalid or expired session') }
    return next()
  }
  app.use('/api/*', authenticate)
  app.use('/mcp', authenticate)

  app.get('/openapi.json', (c) => {
    c.header('Cache-Control', 'public, max-age=300')
    c.header('Access-Control-Allow-Origin', '*')
    return c.json(openApiDocument(origin(c.req.url)))
  })
  app.get('/llms.txt', (c) => {
    c.header('Cache-Control', 'public, max-age=300')
    c.header('Access-Control-Allow-Origin', '*')
    return c.text(llmsIndex(origin(c.req.url)), 200, { 'Content-Type': 'text/markdown; charset=utf-8' })
  })
  app.get('/docs/*', (c) => {
    const match = /^\/docs\/([a-z-]+)\.md$/.exec(c.req.path)
    const body = match && Object.hasOwn(documentation, match[1]) ? documentation[match[1] as keyof typeof documentation] : null
    if (!body) return c.notFound()
    c.header('Cache-Control', 'public, max-age=300')
    c.header('Access-Control-Allow-Origin', '*')
    return c.text(body, 200, { 'Content-Type': 'text/markdown; charset=utf-8' })
  })
  app.all('/mcp', (c) => serveMcp(c.req.raw, c.env, c.get('user')))

  app.get('/api/health', (c) => c.json({ status: 'ok', service: 'pendekin-api' }))
  app.get('/api/me', (c) => c.json(c.get('user')))

  app.get('/api/keys', async (c) => {
    const user = c.get('user')
    if (user.role === 'admin') return failure(403, 'FORBIDDEN', 'User dashboard only')
    if (!c.env.FIREBASE_SERVICE_ACCOUNT_JSON) return failure(503, 'SERVICE_UNAVAILABLE', 'API key storage is not configured')
    try {
      const keys: ApiKeyMetadata[] = await listApiKeys(c.env, user.uid)
      return c.json({ keys })
    } catch { return failure(502, 'UPSTREAM_ERROR', 'Could not load API keys') }
  })

  app.post('/api/keys', async (c) => {
    const user = c.get('user')
    if (user.role === 'admin') return failure(403, 'FORBIDDEN', 'User dashboard only')
    const body: unknown = await c.req.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        !('name' in body) || typeof body.name !== 'string' ||
        !body.name.trim() || body.name.trim().length > 80) {
      return failure(400, 'INVALID_INPUT', 'Enter a name up to 80 characters')
    }
    if (!c.env.FIREBASE_SERVICE_ACCOUNT_JSON) return failure(503, 'SERVICE_UNAVAILABLE', 'API key storage is not configured')
    try { return c.json(await createApiKey(c.env, user.uid, body.name.trim()), 201) }
    catch { return failure(502, 'UPSTREAM_ERROR', 'Could not create API key') }
  })

  app.delete('/api/keys/:id', async (c) => {
    const user = c.get('user')
    if (user.role === 'admin') return failure(403, 'FORBIDDEN', 'User dashboard only')
    if (!c.env.FIREBASE_SERVICE_ACCOUNT_JSON) return failure(503, 'SERVICE_UNAVAILABLE', 'API key storage is not configured')
    try {
      const deleted = await deleteApiKey(c.env, user.uid, c.req.param('id'))
      if (!deleted) return failure(404, 'NOT_FOUND', 'API key not found')
      return c.json({ deleted: true })
    } catch { return failure(502, 'UPSTREAM_ERROR', 'Could not delete API key') }
  })

  app.get('/api/links', async (c) => {
    try { return c.json(await listLinks(c.env, c.get('user'), origin(c.req.url))) }
    catch (error) { return serviceFailure(error) }
  })
  app.post('/api/links', async (c) => {
    const body: unknown = await c.req.json().catch(() => null)
    try { return c.json(await createLink(c.env, c.get('user'), origin(c.req.url), body), 201) }
    catch (error) { return serviceFailure(error) }
  })
  app.patch('/api/links/:slug', async (c) => {
    const body: unknown = await c.req.json().catch(() => null)
    try { return c.json(await updateLink(c.env, c.get('user'), origin(c.req.url), c.req.param('slug'), body)) }
    catch (error) { return serviceFailure(error) }
  })
  app.delete('/api/links/:slug', async (c) => {
    try { return c.json(await removeLink(c.env, c.get('user'), c.req.param('slug'))) }
    catch (error) { return serviceFailure(error) }
  })

  app.get('/r/:slug', async (c) => {
    const slug = c.req.param('slug')
    if (!/^[a-zA-Z0-9]{8}$/.test(slug)) return c.text('Link not found', 404)
    if (!c.env.FIREBASE_SERVICE_ACCOUNT_JSON) return c.text('Link storage unavailable', 503)
    try {
      const targetUrl = await resolveShortLink(c.env, slug)
      if (!targetUrl) return c.text('Link not found or inactive', 404)
      c.header('Cache-Control', 'no-store')
      return c.redirect(targetUrl, 302)
    } catch { return c.text('Link unavailable', 502) }
  })

  app.notFound((c) => c.json({ error: 'Not found', code: 'NOT_FOUND', retryable: false }, 404))
  return app
}

export default createApp()
