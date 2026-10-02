const defaultApiOrigin = 'https://pendekin-api.muhammadzulkifli79.workers.dev'

export async function onRequestGet(context) {
  const slug = context.params.slug
  if (typeof slug !== 'string' || !/^[a-zA-Z0-9]{8}$/.test(slug)) {
    return new Response('Link not found', { status: 404 })
  }

  const apiOrigin = context.env.API_REDIRECT_ORIGIN || defaultApiOrigin
  try {
    const url = new URL('/r/' + slug, apiOrigin)
    return await fetch(url, { redirect: 'manual' })
  } catch {
    return new Response('Link unavailable', { status: 502 })
  }
}
