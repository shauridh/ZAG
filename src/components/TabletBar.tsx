// Tombol layar penuh + indikator wake-lock untuk tablet kasir.
// Fullscreen butuh satu ketukan pengguna (kebijakan browser), jadi ini chip
// yang bisa ditekan — bukan sesuatu yang dipaksa saat aplikasi dibuka.
import { useEffect, useState, type ReactElement } from 'react'
import { Maximize, Minimize, Moon, Sun } from 'lucide-react'
import {
  enableWakeLock,
  disableWakeLock,
  wakeLockActive,
  isWakeLockSupported,
  isFullscreen,
  isFullscreenSupported,
  toggleFullscreen
} from '../lib/screen'

export function TabletBar(): ReactElement {
  const [fs, setFs] = useState(isFullscreen())
  const [awake, setAwake] = useState(wakeLockActive())
  const supported = isWakeLockSupported()

  useEffect(() => {
    const onFs = (): void => setFs(isFullscreen())
    document.addEventListener('fullscreenchange', onFs)
    // poll ringan: sentinel wake lock bisa berubah tanpa event yang bisa
    // diamati dari luar modul (release event dihandle internal)
    const iv = window.setInterval(() => setAwake(wakeLockActive()), 2000)
    return () => {
      document.removeEventListener('fullscreenchange', onFs)
      window.clearInterval(iv)
    }
  }, [])

  const toggleWake = (): void => {
    if (wakeLockActive()) {
      disableWakeLock()
      setAwake(false)
    } else {
      setAwake(true)
      void enableWakeLock().then((ok) => {
        if (!ok) {
          setAwake(false)
          // Feedback halus kalau browser menolak (mis. tab background)
          window.setTimeout(() => setAwake(wakeLockActive()), 600)
        }
        window.setTimeout(() => setAwake(wakeLockActive()), 1200)
      })
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      {supported && (
        <button
          type="button"
          onClick={toggleWake}
          className={`chip !min-h-0 px-2.5 py-1.5 text-xs ${awake ? 'bg-brand-gold' : 'border border-brand-line bg-brand-card'}`}
          aria-pressed={awake}
          title={awake ? 'Layar akan tetap menyala (wake lock aktif)' : 'Layar bisa mati sendiri — ketuk untuk biarkan menyala'}
        >
          {awake ? <Sun size={13} strokeWidth={2.5} className="mr-1 inline-block align-[-2px]" aria-hidden /> : <Moon size={13} strokeWidth={2.5} className="mr-1 inline-block align-[-2px]" aria-hidden />}
          {awake ? 'Layar menyala' : 'Layar boleh mati'}
        </button>
      )}
      {isFullscreenSupported() && (
        <button
          type="button"
          onClick={() => void toggleFullscreen()}
          className={`chip !min-h-0 px-2.5 py-1.5 text-xs ${fs ? 'bg-brand-btn text-white' : 'border border-brand-line bg-brand-card'}`}
          aria-pressed={fs}
          title={fs ? 'Keluar dari layar penuh' : 'Layar penuh — sembunyikan bilah browser untuk mode kasir'}
        >
          {fs ? <Minimize size={13} strokeWidth={2.5} className="mr-1 inline-block align-[-2px]" aria-hidden /> : <Maximize size={13} strokeWidth={2.5} className="mr-1 inline-block align-[-2px]" aria-hidden />}
          {fs ? 'Keluar layar penuh' : 'Layar penuh'}
        </button>
      )}
    </div>
  )
}
