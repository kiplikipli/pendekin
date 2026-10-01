import { Link, Outlet, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { ApiStatus } from './status'

const rootRoute = createRootRoute({
  component: () => (
    <div className="shell">
      <header className="header">
        <Link to="/" className="brand">pendekin</Link>
        <nav aria-label="Main navigation">
          <Link to="/" activeProps={{ className: 'active' }}>Home</Link>
          <Link to="/status" activeProps={{ className: 'active' }}>Status</Link>
        </nav>
      </header>
      <main><Outlet /></main>
      <footer>Short links are coming soon.</footer>
    </div>
  ),
})

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => (
    <section className="hero">
      <p className="eyebrow">A small start for shorter links</p>
      <h1>Make every link easier to share.</h1>
      <p className="lead">The app shell is ready. Link creation and Firebase storage come next.</p>
      <Link to="/status" className="button">Check API connection</Link>
    </section>
  ),
})

const statusRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/status',
  component: ApiStatus,
})

const routeTree = rootRoute.addChildren([homeRoute, statusRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
