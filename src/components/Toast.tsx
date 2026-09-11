import { createContext, useCallback, useContext, useRef, useState, type ReactElement, type ReactNode } from 'react'

interface ToastCtx {
  toast: (msg: string) => void
}

const Ctx = createContext<ToastCtx | null>(null)

/**
 * Toast konfirmasi ringan (mis. "Tersimpan."), satu baris di tengah bawah.
 * Non-interaktif dan hilang sendiri; dibaca screen reader via role="status".
 * Dipasang sekali di root (main.tsx) supaya dipakai halaman kasir dan portal.
 */
export function ToastProvider({ children }: { children: ReactNode }): ReactElement {
  const [msg, setMsg] = useState('')
  const timer = useRef<number | null>(null)

  const toast = useCallback((m: string) => {
    setMsg(m)
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMsg(''), 2500)
  }, [])

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      {msg && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4"
        >
          <p className="max-w-md rounded-lg border-[1.5px] border-brand-line bg-brand-card px-4 py-2.5 text-sm font-bold shadow-pop">
            {msg}
          </p>
        </div>
      )}
    </Ctx.Provider>
  )
}

export function useToast(): ToastCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useToast dipakai di luar ToastProvider')
  return c
}