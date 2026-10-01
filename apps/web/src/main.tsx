import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './router'
import { AuthProvider } from './auth'
import { SignInDialogProvider } from './sign-in-modal'
import './styles.css'

const queryClient = new QueryClient()
const root = document.getElementById('root')

if (!root) {
  throw new Error('Root element is missing')
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider><SignInDialogProvider><RouterProvider router={router} /></SignInDialogProvider></AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
