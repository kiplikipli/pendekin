import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { checkFirestoreConnection, LINKS_COLLECTION } from './firestore'

type Bindings = {
  FIREBASE_PROJECT_ID?: string
  FIREBASE_SERVICE_ACCOUNT_JSON?: string
}

const app = new Hono<{ Bindings: Bindings }>()

// These temporary smoke-test endpoints are public and return no database records.
app.use('/api/*', cors())

app.get('/api/health', (c) =>
  c.json({
    status: 'ok',
    service: 'pendekin-api',
    message: 'Hono is running on Cloudflare Workers.',
  }),
)

app.get('/api/firestore/status', async (c) => {
  if (!c.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return c.json({ status: 'not_configured', collection: LINKS_COLLECTION }, 503)
  }

  try {
    await checkFirestoreConnection(c.env)
    return c.json({ status: 'connected', collection: LINKS_COLLECTION })
  } catch {
    // Do not expose authentication or provider details to public callers.
    return c.json({ status: 'unavailable', collection: LINKS_COLLECTION }, 502)
  }
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

export default app
