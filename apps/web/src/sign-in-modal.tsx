import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuth } from './auth'

type SignInDialogContextValue = {
  openSignIn: () => void
}

const SignInDialogContext = createContext<SignInDialogContextValue | null>(null)

function SignInModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const { configured, error: sessionError, signIn, loading } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    if (open) setError(null)
  }, [open])

  const handleSignIn = async () => {
    setError(null)
    setPending(true)
    try {
      await signIn()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign in')
    } finally {
      setPending(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="sign-in-dialog"
      aria-labelledby="sign-in-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="sign-in-modal-body">
        <button className="modal-close" type="button" onClick={onClose} aria-label="Close sign-in dialog">×</button>
        <div className="modal-art" aria-hidden="true"><span>✳</span><strong>Hey, you!</strong></div>
        <span className="eyebrow">Your link corner</span>
        <h2 id="sign-in-title">Come on in!</h2>
        <p>Sign in to make and manage your short links.</p>
        <button className="button button-primary sign-in-button" type="button" onClick={handleSignIn} disabled={!configured || pending || loading}>
          <span className="google-mark" aria-hidden="true">G</span> {pending ? 'Opening Google…' : loading ? 'Checking your session…' : 'Continue with Google'}
        </button>
        {!configured && <p className="form-message error">Firebase web config is missing.</p>}
        {(error || sessionError) && <p className="form-message error" role="alert">{error || sessionError}</p>}
        <p className="fine-print">One sign-in, all your links in one place.</p>
      </div>
    </dialog>
  )
}

export function SignInDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const { profile } = useAuth()
  const openSignIn = useCallback(() => setOpen(true), [])
  const closeSignIn = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (profile) closeSignIn()
  }, [profile, closeSignIn])

  return (
    <SignInDialogContext.Provider value={{ openSignIn }}>
      {children}
      <SignInModal open={open} onClose={closeSignIn} />
    </SignInDialogContext.Provider>
  )
}

export function useSignInDialog(): SignInDialogContextValue {
  const value = useContext(SignInDialogContext)
  if (!value) throw new Error('SignInDialogProvider is missing')
  return value
}
