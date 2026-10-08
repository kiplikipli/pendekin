import { useRef, useState } from 'react'
import { ActionIcon } from './action-icon'

export function CopyButton({ value, label, ariaLabel = label, iconOnly = false, onSuccess, onError }: {
  value: string
  label: string
  ariaLabel?: string
  iconOnly?: boolean
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
    <button className={'action-button copy-button' + (iconOnly ? ' icon-button' : '') + (copied ? ' is-copied' : '')} type="button"
      aria-label={copied ? 'Copied to clipboard' : ariaLabel} title={copied ? 'Copied to clipboard' : ariaLabel}
      disabled={copied || copying} onClick={() => void copy()}>
      {iconOnly ? <ActionIcon name={copied ? 'check' : 'copy'} /> : <>
        <span className="copy-button-label" aria-hidden="true" style={{ visibility: copied ? 'hidden' : 'visible' }}>{label}</span>
        {copied && <ActionIcon name="check" className="copy-check" />}
      </>}
    </button>
  )
}
