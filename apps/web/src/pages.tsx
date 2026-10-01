import { useEffect, useState, type FormEvent } from 'react'
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

function LinkDashboard({ profile }: { profile: Profile }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [targetUrl, setTargetUrl] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
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
    onSuccess: () => {
      setTargetUrl('')
      void queryClient.invalidateQueries({ queryKey })
    },
  })
  const updateLink = useMutation({
    mutationFn: async ({ slug, active }: { slug: string; active: boolean }) =>
      apiRequest<{ link: ShortLink }>(`/api/links/${slug}`, await user!.getIdToken(), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active }),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
  })

  const links = linksQuery.data?.links ?? []
  const activeCount = links.filter((link) => link.active).length
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (targetUrl.trim()) createLink.mutate(targetUrl.trim())
  }
  const copy = async (link: ShortLink) => {
    try {
      await navigator.clipboard.writeText(link.shortUrl)
      setCopied(link.slug)
      window.setTimeout(() => setCopied(null), 1800)
    } catch {
      setCopied(null)
    }
  }

  return (
    <section className="dashboard">
      <div className="dashboard-heading"><div><span className="eyebrow">Your link space</span><h1>My tiny links<span className="title-dot">.</span></h1><p>Make a link, share it, or put it on pause.</p></div><div className="dashboard-sticker" aria-hidden="true">YOUR<br />LINKS! <span>✦</span></div></div>
      <form className="create-form" onSubmit={submit}>
        <label htmlFor="target-url">Have a long link? Paste it here!</label>
        <div className="create-row"><input id="target-url" type="url" placeholder="https://example.com/a-really-long-link" value={targetUrl} onChange={(event) => setTargetUrl(event.target.value)} required /><button className="button button-primary" disabled={createLink.isPending}>{createLink.isPending ? 'Making…' : 'Make it tiny ↗'}</button></div>
        {createLink.isError && <p className="form-message error" role="alert">{createLink.error.message}</p>}
      </form>
      <div className="list-heading"><div><h2>All your links</h2><p>{links.length} total · {activeCount} active</p></div><span className="list-doodle" aria-hidden="true">✳</span></div>
      {linksQuery.isPending ? <div className="empty-state">Gathering your links…</div>
        : linksQuery.isError ? <div className="empty-state error" role="alert">{linksQuery.error.message}</div>
        : links.length === 0 ? <div className="empty-state"><span aria-hidden="true">✦</span><h3>Nothing here yet!</h3><p>Your first tiny link will show up right here.</p></div>
        : <div className="link-list">{links.map((link) => (
          <article className="link-card" key={link.id}>
            <div className="link-main"><div className="link-title-row"><a href={link.shortUrl} target="_blank" rel="noreferrer" className="short-url">{link.shortUrl}</a><span className={`status-pill ${link.active ? 'is-active' : 'is-paused'}`}>{link.active ? '● Active' : 'Ⅱ Paused'}</span></div><p className="target-url" title={link.targetUrl}>{link.targetUrl}</p><small>{link.createdAt ? new Date(link.createdAt).toLocaleDateString() : 'Recently made'}</small></div>
            <div className="link-actions"><button className="action-button" onClick={() => void copy(link)}>{copied === link.slug ? 'Copied!' : 'Copy'}</button><button className="action-button secondary" disabled={updateLink.isPending} onClick={() => updateLink.mutate({ slug: link.slug, active: !link.active })}>{link.active ? 'Pause' : 'Activate'}</button></div>
          </article>
        ))}</div>}
      {updateLink.isError && <p className="form-message error" role="alert">{updateLink.error.message}</p>}
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
