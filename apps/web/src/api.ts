const configuredUrl = import.meta.env.VITE_API_BASE_URL?.trim()
export const apiBaseUrl = configuredUrl
  ? configuredUrl.replace(/\/$/, '')
  : import.meta.env.DEV ? '' : null

export async function apiRequest<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  if (apiBaseUrl === null) throw new Error('API URL is not configured')
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      authorization: `Bearer ${token}`,
    },
  })
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
      ? data.error
      : `Request failed (HTTP ${response.status})`
    throw new Error(error)
  }
  return data as T
}

export type Profile = {
  uid: string
  email: string | null
  name: string | null
  role: 'admin' | 'user'
}

export type ApiKeyMetadata = {
  id: string
  name: string
  createdAt: string
}

export type IssuedApiKey = {
  key: ApiKeyMetadata
  token: string
}

export type ShortLink = {
  id: string
  slug: string
  targetUrl: string
  shortUrl: string
  active: boolean
  createdAt: string | null
}
