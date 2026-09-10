export interface DeliveryDayHours {
  /** Jam buka layanan antar hari ini, "HH:MM" lokal. null = tutup. */
  open: string | null
  /** Jam tutup layanan antar hari ini, "HH:MM" lokal. null = tutup. */
  close: string | null
  /** true kalau hari ini diluar jam layanan antar. */
  closed: boolean
}

export type DeliveryWeek = Record<DeliveryDayKey, DeliveryDayHours>

export type DeliveryDayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'

export const DAY_LABELS: Record<DeliveryDayKey, string> = {
  sun: 'Min',
  mon: 'Sen',
  tue: 'Sel',
  wed: 'Rab',
  thu: 'Kam',
  fri: 'Jum',
  sat: 'Sab'
}

export const DAY_ORDER: DeliveryDayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

/** Jadwal default: 24 jam setiap hari (perilaku lama, tanpa batasan jam). */
export function defaultDeliverySchedule(): DeliveryWeek {
  return {
    mon: { open: '00:00', close: '24:00', closed: false },
    tue: { open: '00:00', close: '24:00', closed: false },
    wed: { open: '00:00', close: '24:00', closed: false },
    thu: { open: '00:00', close: '24:00', closed: false },
    fri: { open: '00:00', close: '24:00', closed: false },
    sat: { open: '00:00', close: '24:00', closed: false },
    sun: { open: '00:00', close: '24:00', closed: false }
  }
}

/**
 * Jadwal tersimpan di DB boleh parsial (baris hilang / field kosong):
 * baris yang hilang dianggap tutup supaya salah setting tidak membuka layanan diam-diam.
 */
export function normalizeSchedule(raw: unknown): DeliveryWeek | null {
  const def = defaultDeliverySchedule()
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, Partial<DeliveryDayHours> | undefined>
  const out = {} as DeliveryWeek
  for (const key of Object.keys(def) as DeliveryDayKey[]) {
    const r = rec[key]
    if (!r) {
      out[key] = { open: null, close: null, closed: true }
      continue
    }
    out[key] = {
      open: isValidOpen(r.open) ? r.open! : null,
      close: isValidClose(r.close) ? r.close! : null,
      closed: !isValidOpen(r.open) || !isValidClose(r.close) || r.closed === true
    }
  }
  return out
}

/** Jam buka: 00:00–23:59. Jam tutup tambahan boleh "24:00" (tengah malam). */
const RE_HM = /^([01]?\d|2[0-3]):[0-5]\d$/

function isValidOpen(v: unknown): v is string {
  return typeof v === 'string' && RE_HM.test(v)
}

function isValidClose(v: unknown): v is string {
  return typeof v === 'string' && (v === '24:00' || RE_HM.test(v))
}

export function dayKeyOf(dow: number): DeliveryDayKey {
  // JS: 0=Minggu..6=Sabtu
  return (['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as DeliveryDayKey[])[dow % 7]
}

export function dayKeyNow(now: Date): DeliveryDayKey {
  return dayKeyOf(now.getDay())
}

function minutesOf(hm: string): number {
  const [h, m] = hm.split(':').map((x) => parseInt(x, 10))
  return h * 60 + m
}

function minutesNow(now: Date): number {
  return now.getHours() * 60 + now.getMinutes()
}

export interface ScheduleCheck {
  /** true kalau hari ini ada jam layanan antar. */
  openToday: boolean
  /** Label rentang hari ini, contoh "09:00–20:00"; null kalau tutup seharian. */
  range: string | null
  /** true kalau jam sekarang di luar rentang (hanya relevan saat openToday). */
  offHours: boolean
  /** Rentang hari berikutnya yang buka, untuk pesan "buka lagi di...". */
  next: { day: DeliveryDayKey; range: string } | null
}

/** Cek jadwal antar pada satu titik waktu. schedule null = fitur jadwal tidak dipakai. */
export function checkSchedule(schedule: DeliveryWeek | null, now: Date): ScheduleCheck {
  if (!schedule) return { openToday: false, range: null, offHours: false, next: null }
  // baris hari yang hilang dianggap tutup (gagal aman)
  const today = schedule[dayKeyNow(now)] ?? { open: null, close: null, closed: true }
  const range = today.closed || today.open === null || today.close === null ? null : `${today.open}–${today.close}`
  const cur = minutesNow(now)
  let offHours = false
  if (range) {
    const end = minutesOf(today.close!)
    // close "24:00" = 1440 menit: berlaku sampai detik terakhir hari itu (23:59 masih masuk)
    offHours = cur < minutesOf(today.open!) || (cur >= end && end !== 1440)
  }
  return {
    openToday: range !== null,
    range,
    offHours,
    next: nextOpen(schedule, now)
  }
}

/** Hari berikutnya (mulai besok) yang punya jam buka, maks 7 hari ke depan. */
export function nextOpen(schedule: DeliveryWeek, now: Date): ScheduleCheck['next'] {
  for (let i = 1; i <= 7; i++) {
    const key = dayKeyOf((now.getDay() + i) % 7)
    const d = schedule[key]
    if (d && !d.closed && d.open && d.close) {
      return { day: key, range: `${d.open}–${d.close}` }
    }
  }
  return null
}

/**
 * Status gabungan yang menentukan portal: saklar manual harus on DAN
 * (jadwal null ATAU jam sekarang masuk jadwal).
 */
export function deliveryActive(settings: { delivery_enabled?: boolean; delivery_schedule?: DeliveryWeek | null } | null | undefined, now: Date): boolean {
  if (!settings?.delivery_enabled) return false
  const sched = settings.delivery_schedule ?? null
  if (!sched) return true
  const c = checkSchedule(sched, now)
  return c.openToday && !c.offHours
}
