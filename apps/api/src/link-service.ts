import type { AuthenticatedUser } from './auth.ts'
import type { FirestoreBindings } from './firestore-client.ts'
import { createUserLink, deleteUserLink, listUserLinks, setUserLinkActive, type ShortLink } from './firestore.ts'

export class ApiError extends Error {
  readonly status: 400 | 403 | 404 | 502 | 503
  readonly code: 'INVALID_INPUT' | 'FORBIDDEN' | 'NOT_FOUND' | 'UPSTREAM_ERROR' | 'SERVICE_UNAVAILABLE'

  constructor(
    status: 400 | 403 | 404 | 502 | 503,
    code: 'INVALID_INPUT' | 'FORBIDDEN' | 'NOT_FOUND' | 'UPSTREAM_ERROR' | 'SERVICE_UNAVAILABLE',
    message: string,
  ) {
    super(message)
    this.status = status
    this.code = code
  }

  get retryable() { return this.status === 502 || this.status === 503 }
}

function requireLinkRole(user: AuthenticatedUser) {
  if (user.role === 'admin') throw new ApiError(403, 'FORBIDDEN', 'User dashboard only')
}

function requireLinkStorage(env: FirestoreBindings) {
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Link storage is not configured')
}

function withShortUrl(origin: string, link: ShortLink) {
  return { ...link, shortUrl: new URL('/r/' + link.slug, origin).toString() }
}

export async function listLinks(env: FirestoreBindings, user: AuthenticatedUser, origin: string) {
  requireLinkRole(user)
  requireLinkStorage(env)
  try {
    const links = await listUserLinks(env, user.uid)
    return { links: links.map((link) => withShortUrl(origin, link)) }
  } catch { throw new ApiError(502, 'UPSTREAM_ERROR', 'Could not load links') }
}

export async function createLink(env: FirestoreBindings, user: AuthenticatedUser, origin: string, input: unknown) {
  requireLinkRole(user)
  if (!input || typeof input !== 'object' || !('targetUrl' in input) ||
      typeof input.targetUrl !== 'string' || input.targetUrl.length > 2048) {
    throw new ApiError(400, 'INVALID_INPUT', 'Enter a valid URL under 2048 characters')
  }
  let targetUrl: string
  try {
    const parsed = new URL(input.targetUrl)
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
      throw new Error('Invalid URL')
    }
    targetUrl = parsed.toString()
  } catch { throw new ApiError(400, 'INVALID_INPUT', 'Enter a valid http or https URL') }
  requireLinkStorage(env)
  try {
    const link = await createUserLink(env, user.uid, targetUrl)
    return { link: withShortUrl(origin, link) }
  } catch { throw new ApiError(502, 'UPSTREAM_ERROR', 'Could not create link') }
}

function validateSlug(slug: string) {
  if (!/^[a-zA-Z0-9]{8}$/.test(slug)) throw new ApiError(400, 'INVALID_INPUT', 'Invalid link')
}

export async function updateLink(env: FirestoreBindings, user: AuthenticatedUser, origin: string, slug: string, input: unknown) {
  requireLinkRole(user)
  validateSlug(slug)
  const active = input && typeof input === 'object' && 'active' in input ? input.active : null
  if (typeof active !== 'boolean') throw new ApiError(400, 'INVALID_INPUT', 'Active must be a boolean')
  requireLinkStorage(env)
  try {
    const link = await setUserLinkActive(env, user.uid, slug, active)
    if (!link) throw new ApiError(404, 'NOT_FOUND', 'Link not found')
    return { link: withShortUrl(origin, link) }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(502, 'UPSTREAM_ERROR', 'Could not update link')
  }
}

export async function removeLink(env: FirestoreBindings, user: AuthenticatedUser, slug: string) {
  requireLinkRole(user)
  validateSlug(slug)
  requireLinkStorage(env)
  try {
    const deleted = await deleteUserLink(env, user.uid, slug)
    if (!deleted) throw new ApiError(404, 'NOT_FOUND', 'Link not found')
    return { deleted: true as const }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(502, 'UPSTREAM_ERROR', 'Could not delete link')
  }
}
