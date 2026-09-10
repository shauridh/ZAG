let ctx: AudioContext | null = null
let loopTimer: number | null = null

function getCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      ctx = new AC()
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function tone(freq: number, start: number, dur: number) {
  const c = getCtx()
  if (!c) return
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = 'square'
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0.12, c.currentTime + start)
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + start + dur)
  osc.connect(gain)
  gain.connect(c.destination)
  osc.start(c.currentTime + start)
  osc.stop(c.currentTime + start + dur)
}

/** Beep dobel "ting-ting" kasir. */
export function beepRegister(): void {
  tone(1568, 0, 0.09)
  tone(2093, 0.12, 0.14)
}

/** Bunyi pesanan masuk, diulang sampai dihentikan. */
export function startOrderAlert(): void {
  if (loopTimer !== null) return
  const ring = () => {
    tone(988, 0, 0.12)
    tone(1319, 0.15, 0.12)
    tone(988, 0.3, 0.12)
  }
  ring()
  loopTimer = window.setInterval(ring, 2200)
}

export function stopOrderAlert(): void {
  if (loopTimer !== null) {
    window.clearInterval(loopTimer)
    loopTimer = null
  }
}

/** Lepas kunci autoplay audio dari gesture pertama pengguna. */
export function primeAudio(): void {
  const c = getCtx()
  if (c && c.state === 'suspended') void c.resume()
}
