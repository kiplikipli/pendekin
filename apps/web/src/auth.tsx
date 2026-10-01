import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { GoogleAuthProvider, onIdTokenChanged, signInWithPopup, signOut, type User } from 'firebase/auth'
import { apiRequest, type Profile } from './api'
import { auth, firebaseConfigured } from './firebase'

type AuthState = {
  user: User | null
  profile: Profile | null
  loading: boolean
  error: string | null
  configured: boolean
  signIn: () => Promise<void>
  signOutUser: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(firebaseConfigured)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!auth) return
    let current = true
    const unsubscribe = onIdTokenChanged(auth, async (nextUser) => {
      setLoading(true)
      setUser(nextUser)
      setProfile(null)
      setError(null)
      if (!nextUser) {
        setLoading(false)
        return
      }
      try {
        const token = await nextUser.getIdToken()
        const nextProfile = await apiRequest<Profile>('/api/me', token)
        if (current) setProfile(nextProfile)
      } catch (cause) {
        if (current) setError(cause instanceof Error ? cause.message : 'Could not verify your session')
      } finally {
        if (current) setLoading(false)
      }
    })
    return () => {
      current = false
      unsubscribe()
    }
  }, [])

  const value: AuthState = {
    user,
    profile,
    loading,
    error,
    configured: firebaseConfigured,
    signIn: async () => {
      if (!auth) throw new Error('Firebase web config is missing')
      await signInWithPopup(auth, new GoogleAuthProvider())
    },
    signOutUser: async () => {
      if (auth) await signOut(auth)
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext)
  if (!value) throw new Error('AuthProvider is missing')
  return value
}
