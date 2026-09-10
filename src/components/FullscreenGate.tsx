// Kalau admin mengaktifkan "Mode layar penuh" di Pengaturan, browser tetap
// butuh satu ketukan pengguna untuk mengizinkan fullscreen (kebijakan
// keamanan). Banner ini muncul sekali setelah login untuk menangkap ketukan itu.
import { useEffect, useState, type ReactElement } from 'react'
import { loadSettings } from '../lib/db'
import { enterFullscreen, isFullscreen, isFullscreenSupported } from '../lib/screen'

const LS_FS_OFFERED = 'sabana-fs-offered'

export function FullscreenGate(): ReactElement | null {
  const [want, setWant] = useState(false)

  useEffect(() => {
    if (!isFullscreenSupported() || isFullscreen()) return
    void loadSettings()
      .then((s) => {
        if (s.tablet?.fullscreen && localStorage.getItem(LS_FS_OFFERED) !== '1') setWant(true)
      })
      .catch(() => {})
  }, [])

  if (!want) return null

  const dismiss = (): void => {
    localStorage.setItem(LS_FS_OFFERED, '1')
    setWant(false)
  }

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl border-[1.5px] border-brand-line bg-brand-card p-3 shadow-lg">
      <p className="flex-1 text-sm font-bold">Mode layar penuh tablet aktif di pengaturan — pamerkan kasir tanpa bilah browser?</p>
      <button
        type="button"
        className="btn-primary !min-h-0 !px-3 !py-2 text-xs"
        onClick={() => {
          void enterFullscreen()
          dismiss()
        }}
      >
        Buka layar penuh
      </button>
      <button type="button" className="btn-ghost !min-h-0 !px-3 !py-2 text-xs" onClick={dismiss}>
        Nanti
      </button>
    </div>
  )
}
