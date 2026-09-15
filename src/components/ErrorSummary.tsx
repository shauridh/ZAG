import { useEffect, useRef, type ReactElement } from 'react'

/**
 * Ringkasan error yang fokus-dapat (ux: Focusable Error Summary — Medium/Web).
 * Muncul di atas form saat aksi gagal; fokus dipindah ke sini supaya
 * keyboard & screen reader langsung mendengar/menemukan masalahnya.
 */
export function ErrorSummary({ err, label = 'Terjadi masalah' }: { err: string; label?: string }): ReactElement | null {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (err) ref.current?.focus()
  }, [err])

  if (!err) return null
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      aria-labelledby="errsum-title"
      className="mb-2 rounded-lg border border-brand-redtext bg-brand-redtext/10 px-3 py-2 outline-none"
    >
      <h2 id="errsum-title" className="text-sm font-extrabold text-brand-redtext">
        {label}
      </h2>
      <p className="mt-0.5 text-sm font-bold text-brand-redtext">{err}</p>
    </div>
  )
}
