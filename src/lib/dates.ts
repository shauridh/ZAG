export const fmtDate = (iso: string | Date): string =>
  new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })

export const fmtTime = (iso: string | Date): string =>
  new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })

export const fmtDateTime = (iso: string | Date): string => `${fmtDate(iso)} ${fmtTime(iso)}`

export const todayISO = (): string => {
  const d = new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}

/** YYYY-MM-DD dalam waktu lokal (bukan UTC) dari Date atau ISO timestamp. */
export const localDateISO = (d: Date | string): string => {
  const x = typeof d === 'string' ? new Date(d) : d
  return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

export const startOfMonthISO = (): string => todayISO().slice(0, 8) + '01'

export const addDaysISO = (iso: string, days: number): string => {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return todayFrom(d)
}

const todayFrom = (d: Date): string => {
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}

/** Awal hari lokal sebagai UTC ISO — aman utk string-compare created_at.
 *  Dulu 'T00:00:00' polos dibaca UTC: transaksi 00.00–06.59 WIB melompat hari. */
export const dayStart = (iso: string): string => new Date(iso + 'T00:00:00').toISOString()
export const dayEnd = (iso: string): string => new Date(iso + 'T23:59:59.999').toISOString()
