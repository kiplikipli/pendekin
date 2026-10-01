import { useQuery } from '@tanstack/react-query'

type HealthResponse = {
  status: string
  service: string
  message: string
}

type FirestoreStatus = {
  status: 'connected' | 'not_configured' | 'unavailable'
  collection: string
}

const configuredUrl = import.meta.env.VITE_API_BASE_URL?.trim()
const apiBaseUrl = configuredUrl ? configuredUrl.replace(/\/$/, '') : (import.meta.env.DEV ? '' : null)

async function getHealth(): Promise<HealthResponse> {
  const response = await fetch(`${apiBaseUrl}/api/health`)
  if (!response.ok) throw new Error(`API returned HTTP ${response.status}`)
  return response.json() as Promise<HealthResponse>
}

async function getFirestoreStatus(): Promise<FirestoreStatus> {
  const response = await fetch(`${apiBaseUrl}/api/firestore/status`)
  if (![200, 502, 503].includes(response.status)) {
    throw new Error(`API returned HTTP ${response.status}`)
  }
  return response.json() as Promise<FirestoreStatus>
}

export function ApiStatus() {
  const health = useQuery({
    queryKey: ['api-health', apiBaseUrl],
    queryFn: getHealth,
    enabled: apiBaseUrl !== null,
    retry: false,
  })
  const firestore = useQuery({
    queryKey: ['firestore-status', apiBaseUrl],
    queryFn: getFirestoreStatus,
    enabled: health.isSuccess,
    retry: false,
  })

  return (
    <section className="status-page">
      <p className="eyebrow">Deployment smoke test</p>
      <h1>Service status</h1>
      {apiBaseUrl === null ? (
        <div className="card"><strong>API URL needed</strong><p>Set VITE_API_BASE_URL in your Cloudflare Pages build settings, then redeploy.</p></div>
      ) : health.isPending ? (
        <div className="card">Connecting to the Worker…</div>
      ) : health.isError ? (
        <div className="card"><strong>Connection failed</strong><p>{health.error.message}</p></div>
      ) : (
        <>
          <div className="card"><span className="badge">{health.data.status}</span><h2>{health.data.service}</h2><p>{health.data.message}</p></div>
          <div className="card">
            <h2>Firestore</h2>
            {firestore.isPending ? <p>Checking connection…</p>
              : firestore.isError ? <p>{firestore.error.message}</p>
              : <p>{firestore.data.status === 'connected' ? 'Connected' : firestore.data.status === 'not_configured' ? 'Waiting for the Worker service account secret' : 'Connection unavailable'} · {firestore.data.collection}</p>}
          </div>
        </>
      )}
    </section>
  )
}
