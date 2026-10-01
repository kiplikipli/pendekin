import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { verifyFirebaseToken, type AuthenticatedUser } from './auth.ts'
import { createApiKey, deleteApiKey, listApiKeys, resolveApiKey, type ApiKeyMetadata } from './api-keys.ts'
import type { FirestoreBindings } from './firestore-client.ts'
import { createUserLink, deleteUserLink, listUserLinks, resolveShortLink, setUserLinkActive, type ShortLink } from './firestore.ts'

type Bindings = FirestoreBindings
type Variables = {
  user: AuthenticatedUser
}

type AuthDependencies = {
  verifySession: typeof verifyFirebaseToken
  resolveKey: typeof resolveApiKey
}

function acceptsApiKey(path: string, method: string): boolean {
  if (path === '/api/links') return method === 'GET' || method === 'POST'
  if (/^\/api\/links\/[^/]+$/.test(path)) return method === 'PATCH' || method === 'DELETE'
  return false
}

function linkWithUrl(c: { req: { url: string } }, link: ShortLink) {
  return { ...link, shortUrl: new URL('/r/' + link.slug, c.req.url).toString() }
}

export function createApp(dependencies: Partial<AuthDependencies> = {}) {
  const verifySession = dependencies.verifySession ?? verifyFirebaseToken
  const resolveKey = dependencies.resolveKey ?? resolveApiKey
  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    await next()
  })
  app.use('/api/*', cors())
  app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/health') return next()

    const bearer = c.req.header('authorization')?.match(/^Bearer (.+)$/i)?.[1]
    if (!bearer) return c.json({ error: 'Authentication required' }, 401)

    if (bearer.startsWith('pk_')) {
      if (!c.env.FIREBASE_PROJECT_ID) return c.json({ error: 'Authentication is not configured' }, 503)
      if (!c.env.FIREBASE_SERVICE_ACCOUNT_JSON) return c.json({ error: 'API key storage is not configured' }, 503)

      let uid: string | null
      try {
        uid = await resolveKey(c.env, bearer)
      } catch {
        return c.json({ error: 'Could not authenticate API key' }, 502)
      }
      if (!uid) return c.json({ error: 'Authentication required' }, 401)
      if (!acceptsApiKey(c.req.path, c.req.method)) {
        return c.json({ error: 'API keys cannot access this route' }, 403)
      }

      c.set('user', { uid, email: null, name: null, role: 'user' })
      return next()
    }

    if (!c.env.FIREBASE_PROJECT_ID) return c.json({ error: 'Authentication is not configured' }, 503)
    try {
      c.set('user', await verifySession(bearer, c.env.FIREBASE_PROJECT_ID))
    } catch {
      return c.json({ error: 'Invalid or expired session' }, 401)
    }
    return next()
  })

  app.get('/api/health', (c) => c.json({ status: 'ok', service: 'pendekin-api' }))
  app.get('/api/me', (c) => c.json(c.get('user')))

  app.get('/api/keys', async (c) => {
    const user = c.get('user')
    if (user.role === 'admin') return c.json({ error: 'User dashboard only' }, 403)
    if (!c.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      return c.json({ error: 'API key storage is not configured' }, 503)
    }
    try {
      const keys: ApiKeyMetadata[] = await listApiKeys(c.env, user.uid)
      return c.json({ keys })
    } catch {
      return c.json({ error: 'Could not load API keys' }, 502)
    }
  })

  app.post('/api/keys', async (c) => {
    const user = c.get('user')
    if (user.role === 'admin') return c.json({ error: 'User dashboard only' }, 403)
    const body: unknown = await c.req.json().catch(() => null)
    if (
      !body || typeof body !== 'object' || Array.isArray(body) ||
      !('name' in body) || typeof body.name !== 'string' ||
      !body.name.trim() || body.name.trim().length > 80
    ) {
      return c.json({ error: 'Enter a name up to 80 characters' }, 400)
    }
    if (!c.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      return c.json({ error: 'API key storage is not configured' }, 503)
    }
    try {
      const issued = await createApiKey(c.env, user.uid, body.name.trim())
      return c.json(issued, 201)
    } catch {
      return c.json({ error: 'Could not create API key' }, 502)
    }
  })

  app.delete('/api/keys/:id', async (c) => {
    const user = c.get('user')
    if (user.role === 'admin') return c.json({ error: 'User dashboard only' }, 403)
    if (!c.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      return c.json({ error: 'API key storage is not configured' }, 503)
    }
    try {
      const deleted = await deleteApiKey(c.env, user.uid, c.req.param('id'))
      if (!deleted) return c.json({ error: 'API key not found' }, 404)
      return c.json({ deleted: true })
    } catch {
      return c.json({ error: 'Could not delete API key' }, 502)
    }
  })

  app.get('/api/links', async (c) => {
    const user = c.get('user')
    if (user.role === 'admin') return c.json({ error: 'User dashboard only' }, 403)
    if (!c.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      return c.json({ error: 'Link storage is not configured' }, 503)
    }
    try {
      const links = await listUserLinks(c.env, user.uid)
      return c.json({ links: links.map((link) => linkWithUrl(c, link)) })
    } catch {
      return c.json({ error: 'Could not load links' }, 502)
    }
  })

  app.post('/api/links', async (c) => {
    const user = c.get('user')
    if (user.role === 'admin') return c.json({ error: 'User dashboard only' }, 403)
    const body: unknown = await c.req.json().catch(() => null)
    const candidate = body && typeof body === 'object' && 'targetUrl' in body ? body.targetUrl : null
    if (typeof candidate !== 'string' || candidate.length > 2048) {
      return c.json({ error: 'Enter a valid URL under 2048 characters' }, 400)
    }
    let targetUrl: string
    try {
      const parsed = new URL(candidate)
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
        throw new Error('Invalid URL')
      }
      targetUrl = parsed.toString()
    } catch {
      return c.json({ error: 'Enter a valid http or https URL' }, 400)
    }
    if (!c.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      return c.json({ error: 'Link storage is not configured' }, 503)
    }
    try {
      const link = await createUserLink(c.env, user.uid, targetUrl)
      return c.json({ link: linkWithUrl(c, link) }, 201)
    } catch {
      return c.json({ error: 'Could not create link' }, 502)
    }
  })

  app.patch('/api/links/:slug', async (c) => {
    const user = c.get('user')
    if (user.role === 'admin') return c.json({ error: 'User dashboard only' }, 403)
    const slug = c.req.param('slug')
    if (!/^[a-zA-Z0-9]{8}$/.test(slug)) return c.json({ error: 'Invalid link' }, 400)
    const body: unknown = await c.req.json().catch(() => null)
    const active = body && typeof body === 'object' && 'active' in body ? body.active : null
    if (typeof active !== 'boolean') return c.json({ error: 'Active must be a boolean' }, 400)
    if (!c.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      return c.json({ error: 'Link storage is not configured' }, 503)
    }
    try {
      const link = await setUserLinkActive(c.env, user.uid, slug, active)
      if (!link) return c.json({ error: 'Link not found' }, 404)
      return c.json({ link: linkWithUrl(c, link) })
    } catch {
      return c.json({ error: 'Could not update link' }, 502)
    }
  })

  app.delete('/api/links/:slug', async (c) => {
    const user = c.get('user')
    if (user.role === 'admin') return c.json({ error: 'User dashboard only' }, 403)
    const slug = c.req.param('slug')
    if (!/^[a-zA-Z0-9]{8}$/.test(slug)) return c.json({ error: 'Invalid link' }, 400)
    if (!c.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      return c.json({ error: 'Link storage is not configured' }, 503)
    }
    try {
      const deleted = await deleteUserLink(c.env, user.uid, slug)
      if (!deleted) return c.json({ error: 'Link not found' }, 404)
      return c.json({ deleted: true })
    } catch {
      return c.json({ error: 'Could not delete link' }, 502)
    }
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
    } catch {
      return c.text('Link unavailable', 502)
    }
  })

  app.notFound((c) => c.json({ error: 'Not found' }, 404))
  return app
}

export default createApp()
