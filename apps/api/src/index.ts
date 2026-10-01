import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { verifyFirebaseToken, type AuthenticatedUser } from './auth'
import { createUserLink, deleteUserLink, listUserLinks, resolveShortLink, setUserLinkActive, type ShortLink } from './firestore'

type Bindings = {
  FIREBASE_PROJECT_ID?: string
  FIREBASE_SERVICE_ACCOUNT_JSON?: string
}

type Variables = {
  user: AuthenticatedUser
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

app.use('/api/*', cors())
app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  if (c.req.path === '/api/health') return next()
  const token = c.req.header('authorization')?.match(/^Bearer (.+)$/i)?.[1]
  if (!token) return c.json({ error: 'Authentication required' }, 401)
  if (!c.env.FIREBASE_PROJECT_ID) return c.json({ error: 'Authentication is not configured' }, 503)
  try {
    c.set('user', await verifyFirebaseToken(token, c.env.FIREBASE_PROJECT_ID))
  } catch {
    return c.json({ error: 'Invalid or expired session' }, 401)
  }
  return next()
})

app.get('/api/health', (c) => c.json({ status: 'ok', service: 'pendekin-api' }))
app.get('/api/me', (c) => c.json(c.get('user')))

function linkWithUrl(c: { req: { url: string } }, link: ShortLink) {
  return { ...link, shortUrl: `${new URL(c.req.url).origin}/r/${link.slug}` }
}

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

export default app
