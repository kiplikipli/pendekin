import { Link, Outlet, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { useAuth } from './auth'
import { AdminPage, DashboardPage, HomePage } from './pages'
import { useSignInDialog } from './sign-in-modal'

function AppShell() {
  const { user, profile, signOutUser } = useAuth()
  const { openSignIn } = useSignInDialog()
  return (
    <div className="shell">
      <header className="header">
        <Link to="/" className="brand" aria-label="Pendekin home"><span className="brand-mark" aria-hidden="true">✳</span> pendekin<span className="brand-period">.</span></Link>
        <nav aria-label="Main navigation">
          <Link to="/" activeProps={{ className: 'active' }}>Home</Link>
          {profile && <Link to={profile.role === 'admin' ? '/admin' : '/dashboard'} activeProps={{ className: 'active' }}>{profile.role === 'admin' ? 'Admin' : 'My links'}</Link>}
          {user ? <button className="nav-button" onClick={() => void signOutUser()}>Sign out</button> : <button className="nav-login" onClick={openSignIn}>Sign in <span aria-hidden="true">↗</span></button>}
        </nav>
      </header>
      <main><Outlet /></main>
      <footer><span>© {new Date().getFullYear()} Pendekin</span><span>Little links, lots of possibility <span aria-hidden="true">✦</span></span></footer>
    </div>
  )
}

const rootRoute = createRootRoute({ component: AppShell })
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomePage })
const dashboardRoute = createRoute({ getParentRoute: () => rootRoute, path: '/dashboard', component: DashboardPage })
const adminRoute = createRoute({ getParentRoute: () => rootRoute, path: '/admin', component: AdminPage })

const routeTree = rootRoute.addChildren([homeRoute, dashboardRoute, adminRoute])
export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
