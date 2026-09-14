import { useEffect, useRef, type ReactNode } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Modal dasar aplikasi.
 * Aksesibilitas (ux: modal focus trap — High):
 * - fokus dipindah ke dalam dialog saat terbuka & dikembalikan ke pemicu saat tutup
 * - Tab/Shift+Tab dipagari di dalam dialog (focus trap)
 * - Escape menutup, scroll body dikunci selama dialog terbuka
 */
export function Modal({
  open,
  title,
  onClose,
  children,
  wide
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  // onClose dipisah ke ref supaya efek fokus/trap HANYA bergantung pada `open`.
  // Kalau onClose inline (umum di pemanggil: onClose={() => setX(null)}), identitasnya
  // berubah tiap render — efek jalan ulang tiap ketikan dan fokus dipaksa kembali
  // ke input pertama (bug: "typing selalu kembali ke kode barang").
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    returnFocusRef.current = document.activeElement as HTMLElement | null

    // kunci scroll body selama dialog terbuka
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // fokus masuk ke panel HANYA sekali saat dialog terbuka (bukan tiap render):
    // input pertama kalau ada (langsung bisa ketik), kalau tidak ada baru ke
    // tombol pertama / panel itu sendiri
    const panel = panelRef.current
    if (panel) {
      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
      const first = focusable.find((el) => el.matches('input, select, textarea')) ?? focusable[0]
      ;(first ?? panel).focus()
    }

    const h = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      // pagar Tab di dalam dialog
      if (e.key === 'Tab' && panel) {
        const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
        if (items.length === 0) {
          e.preventDefault()
          panel.focus()
          return
        }
        const idx = items.indexOf(document.activeElement as HTMLElement)
        e.preventDefault()
        const next = e.shiftKey ? (idx <= 0 ? items.length - 1 : idx - 1) : idx === items.length - 1 ? 0 : idx + 1
        items[next].focus()
      }
    }
    window.addEventListener('keydown', h)
    return () => {
      window.removeEventListener('keydown', h)
      document.body.style.overflow = prevOverflow
      // kembalikan fokus ke pemicu pembukaan
      returnFocusRef.current?.focus?.()
    }
  }, [open])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`card max-h-[92vh] w-full overflow-y-auto rounded-b-none outline-none sm:rounded-card ${wide ? 'sm:max-w-3xl' : 'sm:max-w-md'}`}
      >
        <div className="strip sticky top-0 z-10 flex items-center justify-between border-b-[1.5px] border-brand-line bg-brand-card px-4 py-3">
          <h2 className="text-base font-extrabold">{title}</h2>
          <button
            type="button"
            className="btn-ghost !min-h-[44px] !w-[44px] !min-w-[44px] !px-0 text-lg"
            onClick={onClose}
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}
