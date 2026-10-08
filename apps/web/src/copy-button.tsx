import { useRef, useState } from 'react'

export function CopyButton({ value, label, ariaLabel = label, onSuccess, onError }: {
  value: string
  label: string
  ariaLabel?: string
  onSuccess: () => void
  onError: () => void
}) {
  const [copiedValue, setCopiedValue] = useState<string | null>(null)
  const [copying, setCopying] = useState(false)
  const copyingRef = useRef(false)
  const copied = copiedValue === value

  const copy = async () => {
    if (copied || copyingRef.current) return
    copyingRef.current = true
    setCopying(true)
    try {
      await navigator.clipboard.writeText(value)
      setCopiedValue(value)
      onSuccess()
    } catch {
      onError()
    } finally {
      copyingRef.current = false
      setCopying(false)
    }
  }

  return (
    <button className={'action-button copy-button' + (copied ? ' is-copied' : '')} type="button"
      aria-label={copied ? 'Copied to clipboard' : ariaLabel} title={copied ? 'Copied to clipboard' : ariaLabel}
      disabled={copied || copying} onClick={() => void copy()}>
      <span className="copy-button-label" aria-hidden="true" style={{ visibility: copied ? 'hidden' : 'visible' }}>{label}</span>
      {copied && <svg className="copy-check" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>}
    </button>
  )
}
