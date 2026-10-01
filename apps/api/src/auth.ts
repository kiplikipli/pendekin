import { decodeProtectedHeader, importX509, jwtVerify } from 'jose'

const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'

type Certificates = Record<string, string>
type CachedCertificates = { values: Certificates; expiresAt: number }

let cachedCertificates: CachedCertificates | undefined

export type AuthenticatedUser = {
  uid: string
  email: string | null
  name: string | null
  role: 'admin' | 'user'
}

async function getCertificates(): Promise<Certificates> {
  if (cachedCertificates && cachedCertificates.expiresAt > Date.now()) {
    return cachedCertificates.values
  }

  const response = await fetch(CERTS_URL)
  if (!response.ok) throw new Error('Firebase public keys are unavailable')

  const values: unknown = await response.json()
  if (!values || typeof values !== 'object') throw new Error('Invalid Firebase public keys')

  const maxAge = Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] ?? 300)
  cachedCertificates = {
    values: values as Certificates,
    expiresAt: Date.now() + Math.max(0, maxAge - 60) * 1000,
  }
  return cachedCertificates.values
}

export async function verifyFirebaseToken(token: string, projectId: string): Promise<AuthenticatedUser> {
  const header = decodeProtectedHeader(token)
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Invalid Firebase token header')

  const certificate = (await getCertificates())[header.kid]
  if (typeof certificate !== 'string') throw new Error('Unknown Firebase signing key')

  const key = await importX509(certificate, 'RS256')
  const { payload } = await jwtVerify(token, key, {
    algorithms: ['RS256'],
    audience: projectId,
    issuer: `https://securetoken.google.com/${projectId}`,
  })

  if (
    typeof payload.sub !== 'string' || !payload.sub ||
    typeof payload.iat !== 'number' || payload.iat > Date.now() / 1000 ||
    typeof payload.auth_time !== 'number' || payload.auth_time > Date.now() / 1000
  ) {
    throw new Error('Invalid Firebase token claims')
  }

  return {
    uid: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
    name: typeof payload.name === 'string' ? payload.name : null,
    role: payload.admin === true ? 'admin' : 'user',
  }
}
