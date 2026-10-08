export function ActionIcon({ name, className }: {
  name: 'copy' | 'check' | 'pause' | 'play' | 'trash'
  className?: string
}) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {name === 'copy' && <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>}
      {name === 'check' && <path d="m5 12 4 4L19 6" />}
      {name === 'pause' && <><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></>}
      {name === 'play' && <path d="m8 4 12 8-12 8Z" />}
      {name === 'trash' && <><path d="M3 6h18M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M5 6l1 14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-14M10 10v7M14 10v7" /></>}
    </svg>
  )
}
