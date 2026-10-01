import { documentation } from './documentation.generated.ts'

export { documentation }

export function llmsIndex(baseUrl: string): string {
  const docs = Object.keys(documentation).map((name) => `- [${name.replaceAll('-', ' ')}](${baseUrl}/docs/${name}.md)`).join('\n')
  return `# Pendekin API

> Public API for creating and managing a user's short links.

Base URL: ${baseUrl}/api
OpenAPI: ${baseUrl}/openapi.json
API version: 1.0.0 (unversioned /api routes)

## Authentication

Bearer Firebase ID tokens support signed-in user routes. Bearer Pendekin API keys support only the owner's link operations and equivalent MCP tools. Keep keys server-side. See ${baseUrl}/docs/authentication.md.

## Documentation

${docs}

## Important usage rules

- Use list links when the slug is unknown; never invent a slug.
- Use a returned slug to update or delete an owned link.
- Creating a link is not idempotent; list links before retrying after an uncertain result.
- Pausing a link retains it; deletion removes it.
- There is no API-level pagination or defined rate limit. Back off on transient 502/503 responses and respect Retry-After if present.

## Machine-readable interfaces

OpenAPI: ${baseUrl}/openapi.json
MCP (Streamable HTTP): ${baseUrl}/mcp
`
}
