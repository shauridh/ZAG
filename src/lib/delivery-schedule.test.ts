import { describe, expect, it } from 'vitest'
import { checkSchedule, dayKeyNow, defaultDeliverySchedule, deliveryActive, nextOpen, normalizeSchedule, type DeliveryWeek } from './delivery-schedule'

// Selasa 12 Agustus 2025 (bukan hari libur spesifik; memakai waktu lokal mesin uji)
const TUE_MORNING = new Date(2025, 7, 12, 9, 0, 0)
const TUE_NIGHT = new Date(2025, 7, 12, 21, 30, 0)

const FULL = defaultDeliverySchedule()

function week(partial: Partial<Record<keyof DeliveryWeek, Partial<DeliveryWeek['mon']>>>): DeliveryWeek {
  return { ...FULL, ...partial } as DeliveryWeek
}

describe('normalizeSchedule', () => {
  it('jadwal tidak ada = null (fitur tidak dipakai, antar murni mengikuti saklar manual)', () => {
    expect(normalizeSchedule(undefined)).toBeNull()
    expect(normalizeSchedule(null)).toBeNull()
  })

  it('baris hari yang hilang dianggap tutup, bukan kebalikan buka', () => {
    const raw = { mon: { open: '09:00', close: '20:00', closed: false } }
    const s = normalizeSchedule(raw)!
    expect(s.mon).toEqual({ open: '09:00', close: '20:00', closed: false })
    expect(s.tue.closed).toBe(true)
    expect(s.sun.open).toBeNull()
  })

  it('jam rusak/kosong = tutup, bukan error', () => {
    const s = normalizeSchedule({ mon: { open: '9 saja', close: '', closed: false } })!
    expect(s.mon.closed).toBe(true)
  })
})

describe('checkSchedule', () => {
  it('jadwal null = tidak membuka/menutup apa pun', () => {
    expect(checkSchedule(null, TUE_MORNING)).toEqual({ openToday: false, range: null, offHours: false, next: null })
  })

  it('24 jam setiap hari: selalu dalam jam', () => {
    const c = checkSchedule(FULL, TUE_NIGHT)
    expect(c.openToday).toBe(true)
    expect(c.offHours).toBe(false)
    expect(c.range).toBe('00:00–24:00')
  })

  it('tutup di luar jam operasional + tawarkan hari buka berikutnya', () => {
    const s = week({ tue: { open: '09:00', close: '20:00', closed: false } })
    const night = checkSchedule(s, TUE_NIGHT)
    expect(night.openToday).toBe(true)
    expect(night.offHours).toBe(true)
    // hari lain buka 24 jam, jadi hari buka berikutnya adalah Rabu
    expect(night.next).toEqual({ day: 'wed', range: '00:00–24:00' })

    const morning = checkSchedule(s, TUE_MORNING)
    expect(morning.offHours).toBe(false)
  })

  it('hari libur: openToday false dan next melompat ke hari buka', () => {
    const s = week({ tue: { closed: true, open: null, close: null }, wed: { open: '08:00', close: '17:00', closed: false } })
    const c = checkSchedule(s, TUE_MORNING)
    expect(c.openToday).toBe(false)
    expect(c.range).toBeNull()
    expect(c.next).toEqual({ day: 'wed', range: '08:00–17:00' })
  })

  it('close 24:00 dihitung sampai detik terakhir hari itu', () => {
    // hanya Senin buka 24 jam; hari lain libur
    const s = week({
      tue: { closed: true, open: null, close: null },
      wed: { closed: true, open: null, close: null },
      thu: { closed: true, open: null, close: null },
      fri: { closed: true, open: null, close: null },
      sat: { closed: true, open: null, close: null },
      sun: { closed: true, open: null, close: null }
    })
    const late = checkSchedule(s, new Date(2025, 7, 11, 23, 59))
    expect(late.openToday).toBe(true)
    expect(late.offHours).toBe(false)
    expect(checkSchedule(s, new Date(2025, 7, 11, 0, 0)).offHours).toBe(false)
  })
})

describe('nextOpen', () => {
  it('mencari sampai 7 hari ke depan', () => {
    const s = week({ wed: { closed: true, open: null, close: null }, thu: { closed: true, open: null, close: null } })
    expect(nextOpen(s, TUE_MORNING)).toEqual({ day: 'fri', range: '00:00–24:00' })
  })
})

describe('dayKeyNow', () => {
  it('mengikuti getDay()', () => {
    expect(dayKeyNow(new Date(2025, 7, 12))).toBe('tue')
    expect(dayKeyNow(new Date(2025, 7, 17))).toBe('sun')
  })
})

describe('deliveryActive', () => {
  it('saklar manual off menutup apa pun jadwalnya', () => {
    const s = week({ tue: { open: '00:00', close: '24:00', closed: false } })
    expect(deliveryActive({ delivery_enabled: false, delivery_schedule: s }, TUE_MORNING)).toBe(false)
  })

  it('tanpa jadwal: cukup saklar manual', () => {
    expect(deliveryActive({ delivery_enabled: true, delivery_schedule: null }, TUE_NIGHT)).toBe(true)
    expect(deliveryActive({ delivery_enabled: true }, TUE_NIGHT)).toBe(true)
    expect(deliveryActive(null, TUE_NIGHT)).toBe(false)
  })

  it('dengan jadwal: gabungan saklar dan jam', () => {
    const s = week({ tue: { open: '09:00', close: '20:00', closed: false } })
    expect(deliveryActive({ delivery_enabled: true, delivery_schedule: s }, TUE_MORNING)).toBe(true)
    expect(deliveryActive({ delivery_enabled: true, delivery_schedule: s }, TUE_NIGHT)).toBe(false)
  })
})
