import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { AuthenticatedUser } from './auth.ts'
import type { FirestoreBindings } from './firestore-client.ts'
import { ApiError, createLink, listLinks, removeLink, updateLink } from './link-service.ts'

function result(value: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: value }
}

function toolError(error: unknown) {
  const value = error instanceof ApiError
    ? { code: error.code, message: error.message, retryable: error.retryable }
    : { code: 'UPSTREAM_ERROR', message: 'Could not complete request', retryable: true }
  return { ...result({ error: value }), isError: true }
}

export async function serveMcp(request: Request, env: FirestoreBindings, user: AuthenticatedUser): Promise<Response> {
  // Browser MCP clients must originate from this Worker. Server-side clients omit Origin.
  const requestOrigin = request.headers.get('origin')
  if (requestOrigin && requestOrigin !== new URL(request.url).origin) {
    return Response.json({ error: 'Origin is not allowed', code: 'FORBIDDEN', retryable: false }, { status: 403 })
  }
  const baseUrl = new URL(request.url).origin
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: 'pendekin-api', version: '1.0.0' })
    server.registerTool('list_links', {
      description: 'List short links owned by the authenticated user, newest first. Use this when a link slug is unknown. This list is currently unpaginated.',
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true },
    }, async () => {
      try { return result(await listLinks(env, user, baseUrl)) }
      catch (error) { return toolError(error) }
    })
    server.registerTool('create_link', {
      description: 'Create a new active short link owned by the authenticated user. This writes data and is not idempotent; avoid repeating a call after an uncertain result.',
      inputSchema: z.object({
        targetUrl: z.string().describe('Absolute http or https destination URL, at most 2,048 characters, with no username or password.'),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    }, async ({ targetUrl }) => {
      try { return result(await createLink(env, user, baseUrl, { targetUrl })) }
      catch (error) { return toolError(error) }
    })
    server.registerTool('set_link_active', {
      description: 'Activate or pause a short link owned by the authenticated user. This changes the redirect state and is idempotent for the same active value. Get a real slug from list_links or create_link.',
      inputSchema: z.object({
        slug: z.string().describe('Eight-character slug returned by list_links or create_link.'),
        active: z.boolean().describe('True to activate redirects; false to pause them.'),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    }, async ({ slug, active }) => {
      try { return result(await updateLink(env, user, baseUrl, slug, { active })) }
      catch (error) { return toolError(error) }
    })
    server.registerTool('delete_link', {
      description: 'Permanently delete a short link owned by the authenticated user. This modifies data; a repeated deletion returns NOT_FOUND. Get a real slug from list_links.',
      inputSchema: z.object({
        slug: z.string().describe('Eight-character slug of an owned link.'),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    }, async ({ slug }) => {
      try { return result(await removeLink(env, user, slug)) }
      catch (error) { return toolError(error) }
    })
    return server
  })
  return handler.fetch(request)
}
