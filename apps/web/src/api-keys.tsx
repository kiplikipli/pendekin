import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiBaseUrl, apiRequest, type ApiKeyMetadata, type IssuedApiKey } from './api'
import { CopyButton } from './copy-button'

type Props = {
  uid: string
  getToken: () => Promise<string>
}

export function ApiKeysSection({ uid, getToken }: Props) {
  const queryClient = useQueryClient()
  const queryKey = ['apiKeys', uid]
  const [name, setName] = useState('')
  const [issued, setIssued] = useState<IssuedApiKey | null>(null)
  const [revokeId, setRevokeId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [noticeError, setNoticeError] = useState(false)
  const tokenRef = useRef<HTMLInputElement>(null)
  const confirmationRef = useRef<HTMLButtonElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const revokeButtons = useRef(new Map<string, HTMLButtonElement>())

  const keysQuery = useQuery({
    queryKey,
    queryFn: async () => apiRequest<{ keys: ApiKeyMetadata[] }>('/api/keys', await getToken()),
  })

  const createKey = useMutation({
    mutationFn: async (keyName: string): Promise<ApiKeyMetadata> => {
      const result = await apiRequest<IssuedApiKey>('/api/keys', await getToken(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: keyName.trim() }),
      })
      // Keep the secret in component state only; mutation state retains metadata only.
      setIssued(result)
      return result.key
    },
    onSuccess: () => {
      setName('')
      setNotice('API key created. Copy it now; it will only be shown once.')
      setNoticeError(false)
      void queryClient.invalidateQueries({ queryKey })
    },
  })

  const revokeKey = useMutation({
    mutationFn: async (id: string) =>
      apiRequest<{ deleted: true }>('/api/keys/' + id, await getToken(), { method: 'DELETE' }),
    onSuccess: (_, id) => {
      setRevokeId(null)
      setNotice('API key revoked. Apps using it can no longer manage your links.')
      setNoticeError(false)
      queryClient.setQueryData<{ keys: ApiKeyMetadata[] }>(queryKey, (current) =>
        current ? { keys: current.keys.filter((key) => key.id !== id) } : current)
      void queryClient.invalidateQueries({ queryKey })
      requestAnimationFrame(() => sectionRef.current?.focus())
    },
  })

  useEffect(() => { if (issued) tokenRef.current?.focus() }, [issued])
  useEffect(() => { if (revokeId) confirmationRef.current?.focus() }, [revokeId])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!name.trim()) return
    setIssued(null)
    setNotice('')
    createKey.mutate(name.trim())
  }

  const cancelRevoke = () => {
    const id = revokeId
    setRevokeId(null)
    if (id) requestAnimationFrame(() => revokeButtons.current.get(id)?.focus())
  }

  const keys = keysQuery.data?.keys ?? []

  return (
    <section className="api-keys" aria-labelledby="api-keys-title" ref={sectionRef} tabIndex={-1}>
      <div className="api-keys-heading">
        <div>
          <span className="eyebrow">Connect an app</span>
          <h2 id="api-keys-title">API keys<span className="title-dot">.</span></h2>
          <p>Create a named key for each app. You can revoke a key at any time.</p>
        </div>
        <span className="api-keys-doodle" aria-hidden="true">✦</span>
      </div>

      <div className="api-key-docs" aria-labelledby="api-key-docs-title">
        <h3 id="api-key-docs-title">Build with your key</h3>
        <p>Use your key from a server-side app or an AI agent. It can manage only your links. Start with the link API guide, or give an agent the discovery index and OpenAPI contract.</p>
        <ul className="api-key-doc-links">
          <li><a href={`${apiBaseUrl ?? ''}/docs/links.md`} target="_blank" rel="noopener noreferrer">API docs <code>/docs/links.md</code></a></li>
          <li><a href={`${apiBaseUrl ?? ''}/llms.txt`} target="_blank" rel="noopener noreferrer">AI discovery <code>/llms.txt</code></a></li>
          <li><a href={`${apiBaseUrl ?? ''}/openapi.json`} target="_blank" rel="noopener noreferrer">OpenAPI contract <code>/openapi.json</code></a></li>
        </ul>
        <p className="api-key-docs-note">MCP tools for agents: <code>{apiBaseUrl ?? ''}/mcp</code>. Keep the key in the client’s secret storage, never in a URL.</p>
      </div>

      <form className="api-key-form" onSubmit={submit}>
        <label htmlFor="api-key-name">Give this key a name</label>
        <div className="api-key-form-row">
          <input
            id="api-key-name"
            type="text"
            maxLength={80}
            autoComplete="off"
            placeholder="For example, Link automation"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
          <button className="action-button" type="submit" disabled={createKey.isPending || !name.trim()}>
            {createKey.isPending ? 'Creating…' : 'Create API key'}
          </button>
        </div>
        {createKey.isError && <p className="form-message error" role="alert">{createKey.error.message}</p>}
      </form>

      {issued && <div className="api-key-issued">
        <p><strong>Your key is ready.</strong> Copy it now; it will not be shown again after you dismiss it.</p>
        <label htmlFor="new-api-key">New API key</label>
        <div className="api-key-token-row">
          <input
            id="new-api-key"
            ref={tokenRef}
            className="api-key-token"
            type="text"
            value={issued.token}
            readOnly
            autoComplete="off"
            spellCheck={false}
          />
          <CopyButton key={issued.key.id} value={issued.token} label="Copy key"
            onSuccess={() => { setNotice(''); setNoticeError(false) }}
            onError={() => { setNotice('Could not copy the API key. Select the field and copy it instead.'); setNoticeError(true) }} />
          <button className="action-button secondary" type="button" onClick={() => setIssued(null)}>Done</button>
        </div>
      </div>}

      {notice && <p className={'api-key-notice ' + (noticeError ? 'error' : '')} role={noticeError ? 'alert' : 'status'}>{notice}</p>}

      <div className="api-key-list-heading">
        <h3>Your keys</h3>
        {!keysQuery.isPending && !keysQuery.isError && <span>{keys.length} {keys.length === 1 ? 'key' : 'keys'}</span>}
      </div>
      {keysQuery.isPending ? <div className="api-key-empty">Loading your keys…</div>
        : keysQuery.isError ? <p className="api-key-empty error" role="alert">{keysQuery.error.message}</p>
        : keys.length === 0 ? <div className="api-key-empty">No API keys yet. Create one for an external app.</div>
        : <div className="api-key-list">{keys.map((key) => <article className="api-key-row" key={key.id}>
          <div className="api-key-details">
            <strong>{key.name}</strong>
            <small>Created {new Date(key.createdAt).toLocaleDateString()}</small>
          </div>
          {revokeId === key.id
            ? <div className="api-key-confirm">
              <p>Revoke <strong>{key.name}</strong>? Apps using this key will stop working.</p>
              <div className="api-key-actions">
                <button ref={confirmationRef} className="action-button secondary" type="button" disabled={revokeKey.isPending} onClick={cancelRevoke}>Keep key</button>
                <button className="action-button danger" type="button" disabled={revokeKey.isPending} onClick={() => revokeKey.mutate(key.id)}>
                  {revokeKey.isPending ? 'Revoking…' : 'Revoke key'}
                </button>
              </div>
              {revokeKey.isError && <p className="form-message error" role="alert">{revokeKey.error.message}</p>}
            </div>
            : <button
              ref={(button) => {
                if (button) revokeButtons.current.set(key.id, button)
                else revokeButtons.current.delete(key.id)
              }}
              className="action-button danger"
              type="button"
              disabled={revokeKey.isPending || createKey.isPending}
              onClick={() => { revokeKey.reset(); setNotice(''); setRevokeId(key.id) }}
              aria-label={'Revoke ' + key.name}
            >Revoke</button>}
        </article>)}</div>}
    </section>
  )
}
