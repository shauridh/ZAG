// Wake Lock API + fullscreen untuk tablet kasir.
//
// Wake lock mencegah layar tablet mati saat jam jualan. Penanganan khusus:
// - saat tab di-background, OS melepas lock → ambil lagi saat visible kembali
// - rotasi layar juga melepas lock → tangani event 'screenchange'
// - fullscreen juga melepas wake lock saat keluar fullscreen → refresh
import { currentOnline, loadSettings } from './db'

// ---------- Wake Lock ----------

type SentinelLike = { released: boolean; release: () => Promise<void>; addEventListener?: (t: string, cb: () => void) => void }
let sentinel: SentinelLike | null = null
let enabled = false
let reassertTimer: number | null = null

export function isWakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator
}

export function wakeLockActive(): boolean {
  return sentinel !== null && !sentinel.released
}

async function requestLock(): Promise<boolean> {
  if (!isWakeLockSupported()) return false
  try {
    const nav = navigator as Navigator & {
      wakeLock: { request: (type: 'screen') => Promise<SentinelLike> }
    }
    const s = await nav.wakeLock.request('screen')
    s.addEventListener?.('release', () => {
      // lock hilang (tab hidden / rotasi / fullscreen keluar) → coba re-assert
      scheduleReassert()
    })
    sentinel = s
    return true
  } catch {
    // Bisa gagal: dokumen hidden, low battery, kebijakan browser — di-retry
    // oleh visibility handler saat kondisi memungkinkan.
    sentinel = null
    return false
  }
}

function scheduleReassert(): void {
  if (!enabled) return
  if (reassertTimer !== null) window.clearTimeout(reassertTimer)
  // delay kecil: OS kadang menolak request saat tepat setelah release
  reassertTimer = window.setTimeout(() => {
    reassertTimer = null
    if (enabled && !wakeLockActive() && document.visibilityState === 'visible') void requestLock()
  }, 400)
}

/** Aktifkan wake lock (idempotent). Returns true kalau lock aktif. */
export async function enableWakeLock(): Promise<boolean> {
  enabled = true
  if (wakeLockActive()) return true
  return requestLock()
}

/** Matikan wake lock. */
export function disableWakeLock(): void {
  enabled = false
  if (reassertTimer !== null) {
    window.clearTimeout(reassertTimer)
    reassertTimer = null
  }
  if (sentinel) {
    void sentinel.release().catch(() => {})
    sentinel = null
  }
}

// Re-assert otomatis saat tab kembali visible — lock selalu dipegang saat
// app terlihat, sesuai preferensi admin.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') scheduleReassert()
})
// Rotasi layar & fullscreen transition melepas lock → pegang lagi.
try {
  screen.orientation.addEventListener('change', () => scheduleReassert())
} catch {
  /* browser tanpa Screen Orientation API */
}
window.addEventListener('fullscreenchange', () => scheduleReassert())

// ---------- Fullscreen ----------

export function isFullscreen(): boolean {
  return document.fullscreenElement !== null
}

export function isFullscreenSupported(): boolean {
  return typeof document !== 'undefined' && document.fullscreenEnabled !== false
}

export async function enterFullscreen(): Promise<boolean> {
  if (!isFullscreenSupported() || isFullscreen()) return isFullscreen()
  try {
    await document.documentElement.requestFullscreen()
    return true
  } catch {
    return false
  }
}

export async function exitFullscreen(): Promise<boolean> {
  if (!isFullscreen()) return false
  try {
    await document.exitFullscreen()
    return true
  } catch {
    return false
  }
}

export async function toggleFullscreen(): Promise<boolean> {
  if (isFullscreen()) return !(await exitFullscreen())
  return enterFullscreen()
}

// ---------- Bootstrap ----------

/** Terapkan preferensi tablet dari settings saat app dibuka. */
export async function applyScreenPrefs(): Promise<void> {
  try {
    const s = await loadSettings()
    if (s.tablet?.keep_awake) void enableWakeLock()
    else disableWakeLock()
  } catch {
    // offline tanpa cache: preferensi default (keep_awake true) tetap aman
    // untuk tablet kasir — layar tetap menyala.
    if (currentOnline()) return
    void enableWakeLock()
  }
}
