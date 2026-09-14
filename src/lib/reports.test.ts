import { describe, expect, it } from 'vitest'
import { byPayment, endOfDayReport, txCashNet } from './reports'
import type { Transaction } from './types'

/**
 * Regresi kembalian: payments menyimpan UANG DITERIMA, bukan porsi bayar.
 * Nota 27rb dibayar tunai 50rb → kas masuk 27rb (kembalian 23rb bukan penjualan).
 * Laporan per metode bayar (Laporan X, Akhir Hari, Dashboard) wajib konsisten.
 */

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 1,
  receipt_no: 'SB1',
  shift_id: 1,
  user_id: null,
  order_type: 'dinein',
  subtotal: 27000,
  discount: 0,
  total: 27000,
  channel_fee: 0,
  hpp: 10000,
  status: 'normal',
  note: null,
  created_at: '2026-09-14T10:00:00.000Z',
  items: [{ name: 'Ayam', qty: 1, price: 27000, hpp: 10000 }],
  payments: [{ method: 'cash', amount: 50000 }],
  ...over
})

describe('txCashNet', () => {
  it('kas tunai = total nota, bukan uang diterima', () => {
    expect(txCashNet(tx({}))).toBe(27000)
    expect(txCashNet(tx({ payments: [{ method: 'qris', amount: 27000 }] }))).toBe(0)
  })
})

describe('byPayment: kembalian dikoreksi di semua pemakai (Laporan X, Dashboard)', () => {
  it('nota tunai uang lebih: tunai = total, bukan uang diterima', () => {
    const pays = byPayment([tx({})])
    expect(pays).toEqual([{ method: 'cash', amount: 27000 }])
  })

  it('uang pas & campuran tunai+qris: kembalian hanya ditarik dari tunai', () => {
    // tunai 30rb + qris 10rb utk nota 38rb → kembalian 2rb dari tunai
    const pays = byPayment([tx({ total: 38000, payments: [{ method: 'cash', amount: 30000 }, { method: 'qris', amount: 10000 }] })])
    expect(pays).toEqual([
      { method: 'cash', amount: 28000 },
      { method: 'qris', amount: 10000 }
    ])
  })

  it('uang kurang (dp) tidak menggeser apa pun', () => {
    const pays = byPayment([tx({ payments: [{ method: 'cash', amount: 20000 }] })])
    expect(pays).toEqual([{ method: 'cash', amount: 20000 }])
  })
})

describe('endOfDayReport: konsisten dengan byPayment', () => {
  it('baris metode bayar sudah net kembalian', () => {
    const channels = { gofood: { fee: 10 }, grabfood: { fee: 10 }, shopeefood: { fee: 10 } } as never
    const rep = endOfDayReport([tx({})], channels)
    expect(rep.methods).toHaveLength(1)
    expect(rep.methods[0]).toMatchObject({ method: 'cash', amount: 27000, count: 1 })
  })
})
