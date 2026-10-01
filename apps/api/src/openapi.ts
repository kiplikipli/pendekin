// Public contract for the small, unversioned Hono API. Keep paths and response
// shapes aligned with index.ts; route tests check the served document.
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const json = (description: string, schema: object) => ({
  description,
  content: { 'application/json': { schema } },
})
const error = (description: string) => json(description, ref('ApiError'))
const authErrors = {
  401: error('Bearer credential is missing or invalid (AUTHENTICATION_REQUIRED).'),
  403: error('Credential is not permitted for this route (FORBIDDEN).'),
  502: error('An upstream authentication or storage operation failed (UPSTREAM_ERROR).'),
  503: error('Required Worker configuration is missing (SERVICE_UNAVAILABLE).'),
}
const linkErrors = { ...authErrors, 400: error('Input is invalid (INVALID_INPUT).') }
const slug = {
  name: 'slug', in: 'path', required: true,
  description: 'Eight-character short code returned by createLink or listLinks. Never invent a slug.',
  schema: { type: 'string', pattern: '^[a-zA-Z0-9]{8}$' }, example: 'a1b2c3d4',
}
const keyId = {
  name: 'id', in: 'path', required: true,
  description: 'Opaque API key ID returned by createApiKey or listApiKeys, not the secret token.',
  schema: { type: 'string' },
}
const body = (description: string, schema: object, example?: object) => ({
  required: true, description,
  content: { 'application/json': { schema, ...(example ? { example } : {}) } },
})

export function openApiDocument(baseUrl: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Pendekin API', version: '1.0.0',
      description: 'Create and manage short links owned by the authenticated user. Routes are currently unversioned under /api. API keys can use link routes; Firebase ID tokens can also manage keys and read the current user.',
    },
    servers: [{ url: baseUrl, description: 'Origin serving this contract' }],
    tags: [
      { name: 'Links', description: 'Owner-scoped short-link management.' },
      { name: 'API keys', description: 'Firebase-session-only key management.' },
      { name: 'Session', description: 'Signed-in user information.' },
      { name: 'Public', description: 'Health and public redirects.' },
    ],
    paths: {
      '/api/health': { get: {
        operationId: 'getHealth', summary: 'Check API health',
        description: 'Check that the Worker is responding. This does not prove Firestore is available.',
        tags: ['Public'], security: [],
        responses: { 200: json('Worker is responding.', ref('Health')) },
      } },
      '/api/me': { get: {
        operationId: 'getCurrentUser', summary: 'Get the current signed-in user',
        description: 'Return the identity and role from a verified Firebase ID token. Use this for dashboard session information. Pendekin API keys cannot call this route.',
        tags: ['Session'], security: [{ bearerAuth: [] }],
        responses: { 200: json('Authenticated user.', ref('User')), ...authErrors },
      } },
      '/api/keys': {
        get: {
          operationId: 'listApiKeys', summary: 'List the current user’s API keys',
          description: 'List key metadata newest first. Secret tokens and hashes are never returned. Requires a Firebase ID token; Pendekin API keys cannot call this route. The array is unpaginated.',
          tags: ['API keys'], security: [{ bearerAuth: [] }],
          responses: { 200: json('Named keys without secret tokens.', ref('ApiKeyList')), ...authErrors },
        },
        post: {
          operationId: 'createApiKey', summary: 'Create an API key',
          description: 'Issue an owner-scoped API key for external link integrations. The full token appears only in this response; store it as a server-side secret. Requires a Firebase ID token. This operation is not idempotent.',
          tags: ['API keys'], security: [{ bearerAuth: [] }],
          requestBody: body('A human-readable key name, one to 80 non-whitespace characters after trimming.', ref('CreateApiKeyInput'), { name: 'Automation' }),
          responses: { 201: json('New key metadata and one-time secret token.', ref('IssuedApiKey')), ...authErrors, 400: error('Name is missing or invalid (INVALID_INPUT).') },
        },
      },
      '/api/keys/{id}': { delete: {
        operationId: 'revokeApiKey', summary: 'Revoke an API key',
        description: 'Revoke an owned key. Its next request fails authentication. Requires a Firebase ID token; a key cannot revoke itself through this route. Other-owner keys behave as not found.',
        tags: ['API keys'], security: [{ bearerAuth: [] }], parameters: [keyId],
        responses: { 200: json('Key revoked.', ref('Deleted')), ...authErrors, 404: error('Key is missing or not owned by the caller (NOT_FOUND).') },
      } },
      '/api/links': {
        get: {
          operationId: 'listLinks', summary: 'List owned short links',
          description: 'List links owned by the bearer credential, newest first. Use this when a slug is unknown; there is no get-by-slug or search operation. The array is currently unpaginated.',
          tags: ['Links'], security: [{ bearerAuth: [] }],
          responses: { 200: json('Owned links in an array.', ref('LinkList')), ...authErrors },
        },
        post: {
          operationId: 'createLink', summary: 'Create an active short link',
          description: 'Create an active short link for the bearer credential’s owner. The server generates the slug and normalizes the destination URL. This is not idempotent and idempotency keys are not supported; inspect listLinks before retrying after an uncertain result.',
          tags: ['Links'], security: [{ bearerAuth: [] }],
          requestBody: body('Absolute HTTP or HTTPS URL to shorten, at most 2,048 characters, with no embedded credentials.', ref('CreateLinkInput'), { targetUrl: 'https://example.com/page' }),
          responses: { 201: json('New active link and generated short URL.', ref('SingleLink')), ...linkErrors },
        },
      },
      '/api/links/{slug}': {
        patch: {
          operationId: 'setLinkActive', summary: 'Activate or pause an owned link',
          description: 'Set the redirect state of an owned link. Use a slug returned by listLinks or createLink. Repeating the same active value has the same effect. A paused link remains stored but redirects return 404.',
          tags: ['Links'], security: [{ bearerAuth: [] }], parameters: [slug],
          requestBody: body('Desired redirect state.', ref('SetLinkActiveInput'), { active: false }),
          responses: { 200: json('Updated link.', ref('SingleLink')), ...linkErrors, 404: error('Link is missing or not owned by the caller (NOT_FOUND).') },
        },
        delete: {
          operationId: 'deleteLink', summary: 'Delete an owned link',
          description: 'Permanently delete an owned short link. Use a slug returned by listLinks. A repeated deletion returns 404. This operation changes data and cannot be undone.',
          tags: ['Links'], security: [{ bearerAuth: [] }], parameters: [slug],
          responses: { 200: json('Link deleted.', ref('Deleted')), ...linkErrors, 404: error('Link is missing or not owned by the caller (NOT_FOUND).') },
        },
      },
      '/r/{slug}': { get: {
        operationId: 'redirectLink', summary: 'Follow an active short link',
        description: 'Public redirect for an active link. Paused, invalid, and missing slugs return a plain-text 404. Use the shortUrl returned by link operations when possible.',
        tags: ['Public'], security: [], parameters: [slug],
        responses: {
          302: { description: 'Redirect to the link target.', headers: { Location: { description: 'Destination URL.', schema: { type: 'string', format: 'uri' } } } },
          404: { description: 'Link is missing, invalid, or paused.', content: { 'text/plain': { schema: { type: 'string' } } } },
          502: { description: 'Link storage failed.', content: { 'text/plain': { schema: { type: 'string' } } } },
          503: { description: 'Link storage is not configured.', content: { 'text/plain': { schema: { type: 'string' } } } },
        },
      } },
    },
    components: {
      securitySchemes: { bearerAuth: {
        type: 'http', scheme: 'bearer',
        description: 'Firebase ID token for signed-in routes. Pendekin API keys are restricted to /api/links and equivalent MCP tools.',
      } },
      schemas: {
        ApiError: { type: 'object', additionalProperties: false, required: ['error', 'code', 'retryable'], properties: {
          error: { type: 'string', description: 'Human-readable message retained for existing clients.' },
          code: { type: 'string', enum: ['AUTHENTICATION_REQUIRED', 'FORBIDDEN', 'INVALID_INPUT', 'NOT_FOUND', 'UPSTREAM_ERROR', 'SERVICE_UNAVAILABLE'] },
          retryable: { type: 'boolean', description: 'Whether a later retry may succeed without changing the request.' },
        }, example: { error: 'Link not found', code: 'NOT_FOUND', retryable: false } },
        Health: { type: 'object', additionalProperties: false, required: ['status', 'service'], properties: {
          status: { type: 'string', enum: ['ok'] }, service: { type: 'string', enum: ['pendekin-api'] },
        } },
        User: { type: 'object', additionalProperties: false, required: ['uid', 'email', 'name', 'role'], properties: {
          uid: { type: 'string' }, email: { type: ['string', 'null'] }, name: { type: ['string', 'null'] }, role: { type: 'string', enum: ['user', 'admin'] },
        } },
        Link: { type: 'object', additionalProperties: false, required: ['id', 'slug', 'targetUrl', 'shortUrl', 'active', 'createdAt'], properties: {
          id: { type: 'string', description: 'Storage ID; use slug in API paths.' },
          slug: { type: 'string', pattern: '^[a-zA-Z0-9]{8}$', description: 'Generated short code.' },
          targetUrl: { type: 'string', format: 'uri', description: 'Normalized destination.' },
          shortUrl: { type: 'string', format: 'uri', description: 'Public redirect URL on this Worker origin.' },
          active: { type: 'boolean', description: 'Whether the redirect is enabled.' },
          createdAt: { type: ['string', 'null'], format: 'date-time', description: 'Null for legacy records without a creation timestamp.' },
        } },
        LinkList: { type: 'object', additionalProperties: false, required: ['links'], properties: { links: { type: 'array', items: ref('Link') } } },
        SingleLink: { type: 'object', additionalProperties: false, required: ['link'], properties: { link: ref('Link') } },
        Deleted: { type: 'object', additionalProperties: false, required: ['deleted'], properties: { deleted: { type: 'boolean', enum: [true] } } },
        CreateLinkInput: { type: 'object', additionalProperties: true, required: ['targetUrl'], properties: {
          targetUrl: { type: 'string', maxLength: 2048, format: 'uri', description: 'Absolute HTTP or HTTPS URL without embedded credentials.' },
        } },
        SetLinkActiveInput: { type: 'object', additionalProperties: true, required: ['active'], properties: { active: { type: 'boolean' } } },
        ApiKey: { type: 'object', additionalProperties: false, required: ['id', 'name', 'createdAt'], properties: {
          id: { type: 'string' }, name: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' },
        } },
        ApiKeyList: { type: 'object', additionalProperties: false, required: ['keys'], properties: { keys: { type: 'array', items: ref('ApiKey') } } },
        CreateApiKeyInput: { type: 'object', additionalProperties: true, required: ['name'], properties: {
          name: { type: 'string', maxLength: 80, description: 'Name shown in the dashboard.' },
        } },
        IssuedApiKey: { type: 'object', additionalProperties: false, required: ['key', 'token'], properties: {
          key: ref('ApiKey'), token: { type: 'string', description: 'One-time full API key token. Never returned again.' },
        } },
      },
    },
  }
}
