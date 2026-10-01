import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate } from '@tanstack/react-router'
import { apiRequest, type Profile, type ShortLink } from './api'
import { useAuth } from './auth'
import { useSignInDialog } from './sign-in-modal'

export function HomePage() {
  const { profile } = useAuth()
  const { openSignIn } = useSignInDialog()
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">The tiny link club <span aria-hidden="true">✦</span></span>
          <h1>Big ideas.<br /><span className="highlight">Small links.</span></h1>
          <p className="lead">Turn a long, messy URL into a neat little link you can share anywhere. Keep every link in one cheerful place.</p>
          {profile
            ? <Link to={profile.role === 'admin' ? '/admin' : '/dashboard'} className="button button-primary">Go to your space <span aria-hidden="true">↗</span></Link>
            : <button className="button button-primary" onClick={openSignIn}>Get started with Google <span aria-hidden="true">↗</span></button>}
          <p className="hero-note">Shorter links. Bigger smiles. Zero fuss.</p>
        </div>
        <div className="hero-art" aria-label="Illustration of a long web address turning into a short link" role="img">
          <div className="burst burst-one">✳</div>
          <div className="burst burst-two">✦</div>
          <div className="art-caption">POOF!</div>
          <div className="art-long"><span className="mini-icon">↗</span> super-long-link.example.com/very/long/story...</div>
          <div className="art-arrow">➜</div>
          <div className="art-short"><span className="chain">🔗</span><strong>pdk.link/abc123</strong><span className="sparkle">✧</span></div>
          <div className="art-bubble">Much better!</div>
        </div>
      </section>
      <section className="feature-section" aria-labelledby="how-title">
        <div className="section-heading"><span className="eyebrow">How it works</span><h2 id="how-title">Link magic in three little steps.</h2></div>
        <div className="feature-grid">
          <article className="feature-card"><span className="feature-number">01</span><div className="feature-icon">✎</div><h3>Paste a link</h3><p>Drop in the URL you want to share.</p></article>
          <article className="feature-card"><span className="feature-number">02</span><div className="feature-icon">✦</div><h3>Make it tiny</h3><p>Get a short link ready in a snap.</p></article>
          <article className="feature-card"><span className="feature-number">03</span><div className="feature-icon">↗</div><h3>Share away</h3><p>Manage your links and pause them anytime.</p></article>
        </div>
      </section>
    </>
  )
}

function LinkCard({ link, queryKey, onDeleted }: { link: ShortLink; queryKey: string[]; onDeleted: (message: string) => void }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [notice, setNotice] = useState('')
  const [noticeError, setNoticeError] = useState(false)
  const moreRef = useRef<HTMLDetailsElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (confirmDelete) confirmRef.current?.focus() }, [confirmDelete])
  let hostname = link.targetUrl
  try {
    hostname = new URL(link.targetUrl).hostname
  } catch {
    // Keep the stored destination visible if an older link is malformed.
  }

  const updateLink = useMutation({
    mutationFn: async (active: boolean) =>
      apiRequest<{ link: ShortLink }>('/api/links/' + link.slug, await user!.getIdToken(), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active }),
      }),
    onSuccess: ({ link: updated }) => {
      queryClient.setQueryData<{ links: ShortLink[] }>(queryKey, (current) =>
        current ? { links: current.links.map((item) => item.id === updated.id ? { ...updated, shortUrl: link.shortUrl } : item) } : current)
      setNotice(updated.active ? 'Link active. Visitors can open it again.' : 'Link paused. Visitors can no longer open it.')
      setNoticeError(false)
      void queryClient.invalidateQueries({ queryKey })
    },
  })
  const deleteLink = useMutation({
    mutationFn: async () =>
      apiRequest<{ deleted: boolean }>('/api/links/' + link.slug, await user!.getIdToken(), { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.setQueryData<{ links: ShortLink[] }>(queryKey, (current) =>
        current ? { links: current.links.filter((item) => item.id !== link.id) } : current)
      onDeleted('Deleted ' + link.shortUrl + '. It no longer redirects.')
      void queryClient.invalidateQueries({ queryKey })
    },
  })

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link.shortUrl)
      setNotice('Short link copied.')
      setNoticeError(false)
    } catch {
      setNotice('Could not copy the short link. Select the address above and copy it instead.')
      setNoticeError(true)
    }
  }

  return (
    <article className="link-card">
      <div className="link-main">
        <div className="link-title-row">
          {link.active
            ? <a href={link.shortUrl} target="_blank" rel="noreferrer" className="short-url">{link.shortUrl}</a>
            : <span className="short-url">{link.shortUrl}</span>}
          <span className={'status-pill ' + (link.active ? 'is-active' : 'is-paused')}>{link.active ? 'Active' : 'Paused'}</span>
        </div>
        <div className="destination">
          <span className="destination-host">{hostname}</span>
          <p id={'destination-' + link.slug} className={'target-url ' + (expanded ? 'is-expanded' : '')}>{link.targetUrl}</p>
          <button className="text-button" type="button" aria-controls={'destination-' + link.slug} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Hide full URL' : 'Show full URL'}
          </button>
        </div>
        {link.active ? <small>{link.createdAt ? new Date(link.createdAt).toLocaleDateString() : 'Date unavailable'}</small>
          : <small>Paused links do not redirect · {link.createdAt ? new Date(link.createdAt).toLocaleDateString() : 'Date unavailable'}</small>}
      </div>
      <div className="link-actions">
        <button className="action-button" type="button" aria-label={'Copy ' + link.shortUrl} onClick={() => void copy()}>Copy</button>
        <button className="action-button secondary" type="button"
          aria-label={(link.active ? 'Pause ' : 'Activate ') + link.shortUrl}
          disabled={updateLink.isPending || deleteLink.isPending || confirmDelete}
          onClick={() => { setNotice(''); updateLink.mutate(!link.active) }}>
          {updateLink.isPending ? (link.active ? 'Pausing…' : 'Activating…') : (link.active ? 'Pause' : 'Activate')}
        </button>
        <details className="link-more" ref={moreRef}>
          <summary className="action-button secondary" aria-label={'More actions for ' + link.shortUrl}>More</summary>
          <div className="link-more-menu">
            <button type="button" disabled={updateLink.isPending || deleteLink.isPending} onClick={() => { moreRef.current?.removeAttribute('open'); setConfirmDelete(true); setNotice('') }}>Delete link</button>
          </div>
        </details>
      </div>
      {(notice || updateLink.isError) && <p className={'link-feedback ' + (noticeError || updateLink.isError ? 'error' : '')}
        role={noticeError || updateLink.isError ? 'alert' : 'status'}>
        {updateLink.isError ? 'Could not change this link. Try again.' : notice}
      </p>}
      {confirmDelete && <div className="delete-confirm">
        <p><strong>Delete this link permanently?</strong> {link.shortUrl} will stop redirecting to {hostname}. This cannot be undone.</p>
        <div className="delete-confirm-actions">
          <button ref={confirmRef} className="action-button secondary" type="button" disabled={deleteLink.isPending} onClick={() => { setConfirmDelete(false); moreRef.current?.querySelector('summary')?.focus() }}>Keep link</button>
          <button className="action-button danger" type="button" aria-label={'Delete ' + link.shortUrl + ' permanently'} disabled={deleteLink.isPending} onClick={() => deleteLink.mutate()}>
            {deleteLink.isPending ? 'Deleting…' : 'Delete permanently'}
          </button>
        </div>
        {deleteLink.isError && <p className="form-message error" role="alert">Could not delete this link. Try again.</p>}
      </div>}
    </article>
  )
}

function LinkDashboard({ profile }: { profile: Profile }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [targetUrl, setTargetUrl] = useState('')
  const [createdLink, setCreatedLink] = useState<ShortLink | null>(null)
  const [createdCopyMessage, setCreatedCopyMessage] = useState('')
  const [listNotice, setListNotice] = useState('')
  const listNoticeRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => { if (listNotice) listNoticeRef.current?.focus() }, [listNotice])
  const queryKey = ['links', profile.uid]

  const linksQuery = useQuery({
    queryKey,
    queryFn: async () => apiRequest<{ links: ShortLink[] }>('/api/links', await user!.getIdToken()),
  })
  const createLink = useMutation({
    mutationFn: async (url: string) => apiRequest<{ link: ShortLink }>('/api/links', await user!.getIdToken(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetUrl: url }),
    }),
    onSuccess: ({ link }) => {
      setTargetUrl('')
      setCreatedLink(link)
      setCreatedCopyMessage('')
      queryClient.setQueryData<{ links: ShortLink[] }>(queryKey, (current) =>
        current ? { links: [link, ...current.links] } : current)
      void queryClient.invalidateQueries({ queryKey })
    },
  })

  const links = linksQuery.data?.links ?? []
  const activeCount = links.filter((link) => link.active).length
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (targetUrl.trim()) {
      setCreatedLink(null)
      createLink.mutate(targetUrl.trim())
    }
  }
  const copyCreated = async () => {
    if (!createdLink) return
    try {
      await navigator.clipboard.writeText(createdLink.shortUrl)
      setCreatedCopyMessage('Copied!')
    } catch {
      setCreatedCopyMessage('Could not copy. Select the short link and copy it instead.')
    }
  }

  return (
    <section className="dashboard">
      <div className="dashboard-heading"><div><span className="eyebrow">Your link space</span><h1>My tiny links<span className="title-dot">.</span></h1><p>Make a link, share it, or put it on pause.</p></div><div className="dashboard-sticker" aria-hidden="true">YOUR<br />LINKS! <span>✦</span></div></div>
      <form className="create-form" onSubmit={submit}>
        <label htmlFor="target-url">Have a long link? Paste it here!</label>
        <div className="create-row"><input id="target-url" type="url" maxLength={2048} placeholder="https://example.com/a-really-long-link" value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)} required /><button className="button button-primary" disabled={createLink.isPending}>{createLink.isPending ? 'Making…' : 'Make it tiny ↗'}</button></div>
        {createLink.isError && <p className="form-message error" role="alert">{createLink.error.message}</p>}
        {createdLink && <div className="created-link" role="status">
          <div><strong>Your link is ready</strong><a href={createdLink.shortUrl} target="_blank" rel="noreferrer">{createdLink.shortUrl}</a></div>
          <button className="action-button" type="button" onClick={() => void copyCreated()}>Copy link</button>
          {createdCopyMessage && <p>{createdCopyMessage}</p>}
        </div>}
      </form>
      <div className="list-heading"><div><h2>All your links</h2><p>{links.length} total · {activeCount} active</p></div><span className="list-doodle" aria-hidden="true">✳</span></div>
      {listNotice && <p ref={listNoticeRef} tabIndex={-1} className="list-notice" role="status">{listNotice}</p>}
      {linksQuery.isPending ? <div className="empty-state">Gathering your links…</div>
        : linksQuery.isError ? <div className="empty-state error" role="alert">{linksQuery.error.message}</div>
        : links.length === 0 ? <div className="empty-state"><span aria-hidden="true">✦</span><h3>Nothing here yet!</h3><p>Your first tiny link will show up right here.</p></div>
        : <div className="link-list">{links.map((link) => <LinkCard key={link.id} link={link} queryKey={queryKey} onDeleted={setListNotice} />)}</div>}
    </section>
  )
}

function SignInRequired() {
  const { openSignIn } = useSignInDialog()
  useEffect(() => openSignIn(), [openSignIn])
  return <div className="page-message"><h2>Let's get you signed in.</h2><p>Your links are waiting.</p><button className="button button-primary" onClick={openSignIn}>Continue with Google ↗</button></div>
}

export function DashboardPage() {
  const { loading, user, profile, error } = useAuth()
  if (loading) return <div className="page-message">Checking your session…</div>
  if (!user) return <SignInRequired />
  if (error || !profile) return <div className="page-message error" role="alert">{error ?? 'Could not load your account'}</div>
  if (profile.role === 'admin') return <Navigate to="/admin" />
  return <LinkDashboard profile={profile} />
}

export function AdminPage() {
  const { loading, user, profile, error } = useAuth()
  if (loading) return <div className="page-message">Checking your session…</div>
  if (!user) return <SignInRequired />
  if (error || !profile) return <div className="page-message error" role="alert">{error ?? 'Could not load your account'}</div>
  if (profile.role !== 'admin') return <Navigate to="/dashboard" />
  return <section className="admin-page"><span className="eyebrow">Admin corner</span><h1>Coming soon<span className="title-dot">.</span></h1><div className="admin-empty"><span aria-hidden="true">✳</span><p>This space is ready for what comes next.</p></div></section>
}
