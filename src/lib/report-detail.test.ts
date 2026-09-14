import { describe, expect, it } from 'vitest'
import { applyDetailFilters, detailCsv, detailRangeOf, type DetailFilters } from './report-detail'
import type { Transaction } from './types'

/**
 * Laporan Detail: filter gabungan (waktu × channel × metode × kategori/menu ×
 * status × shift × no. nota) + scoped total saat filter menu/kategori aktif.
 */

const tx = (over: Partial<Transaction>): Transaction => ({
  id: 1,
  receipt_no: 'SB260914-001',
  shift_id: 1,
  user_id: null,
  order_type: 'dinein',
  channel_fee: 0,
  subtotal: 20000,
  discount: 0,
  total: 20000,
  hpp: 8000,
  note: null,
  created_at: '2026-09-14T10:00:00',
  items: [
    { name: 'Ayam Goreng', qty: 1, price: 11000, hpp: 5000 },
    { name: 'Nasi Putih', qty: 2, price: 5000, hpp: 3000 }
  ],
  payments: [{ method: 'cash', amount: 20000 }],
  ...over
})

const baseFilters: DetailFilters = {
  period: 'custom',
  customFrom: '2026-09-14',
  customTo: '2026-09-14',
  channel: '',
  method: '',
  status: '',
  productId: null,
  categoryId: null,
  shiftId: null,
  q: ''
}

const nameToId = new Map([['Ayam Goreng', 1], ['Nasi Putih', 2], ['Teh Botol', 3]])
const idToCat = new Map<number, number | null>([[1, 10], [2, 20], [3, 30]])

describe('detailRangeOf', () => {
  it('preset menghasilkan rentang inklusif yang benar', () => {
    expect(detailRangeOf({ period: 'today', customFrom: '', customTo: '' }, '2026-09-14')).toEqual({ from: '2026-09-14', to: '2026-09-14' })
    expect(detailRangeOf({ period: 'week7', customFrom: '', customTo: '' }, '2026-09-14').from).toBe('2026-09-08')
    expect(detailRangeOf({ period: 'month', customFrom: '', customTo: '' }, '2026-09-14')).toEqual({ from: '2026-09-01', to: '2026-09-14' })
    expect(detailRangeOf({ period: 'custom', customFrom: '2026-09-01', customTo: '2026-09-10' }, '2026-09-14')).toEqual({ from: '2026-09-01', to: '2026-09-10' })
  })
})

describe('applyDetailFilters', () => {
  const txs = [
    tx({ id: 1, receipt_no: 'SB260914-001', order_type: 'dinein', total: 21000, subtotal: 21000, payments: [{ method: 'cash', amount: 25000 }] }),
    tx({ id: 2, receipt_no: 'SB260914-002', order_type: 'gofood', channel_fee: 2100, total: 16000, subtotal: 16000, created_at: '2026-09-14T15:30:00', payments: [{ method: 'qris', amount: 16000 }], items: [{ name: 'Nasi Putih', qty: 1, price: 5000, hpp: 1500 }, { name: 'Teh Botol', qty: 1, price: 5000, hpp: 2000 }] }),
    tx({ id: 3, receipt_no: 'SB260913-009', order_type: 'takeaway', total: 11000, subtotal: 11000, created_at: '2026-09-13T12:00:00' }),
    tx({ id: 4, receipt_no: 'SB260914-004', order_type: 'dinein', total: 21000, status: 'refund', refund_amount: 21000, created_at: '2026-09-14T18:00:00' })
  ]

  it('filter waktu saja: nota di luar rentang dibuang', () => {
    const r = applyDetailFilters(txs, baseFilters, { from: '2026-09-14', to: '2026-09-14' }, nameToId, idToCat)
    expect(r.filteredCount).toBe(3)
    expect(r.totals.revenue).toBe(21000 + 16000 + 21000)
  })

  it('filter channel & metode AND', () => {
    const r = applyDetailFilters(txs, { ...baseFilters, channel: 'gofood', method: 'qris' }, { from: '2026-09-13', to: '2026-09-14' }, nameToId, idToCat)
    expect(r.filteredCount).toBe(1)
    expect(r.rows[0].tx.id).toBe(2)
  })

  it('filter status refund hanya nota refund', () => {
    const r = applyDetailFilters(txs, { ...baseFilters, status: 'refund' }, { from: '2026-09-13', to: '2026-09-14' }, nameToId, idToCat)
    expect(r.filteredCount).toBe(1)
    expect(r.rows[0].tx.status).toBe('refund')
  })

  it('filter menu: nota cocok bila memuat menu, total ter-scope ke porsi menu itu', () => {
    const r = applyDetailFilters(txs, { ...baseFilters, productId: 2 }, { from: '2026-09-13', to: '2026-09-14' }, nameToId, idToCat)
    // semua 4 nota memuat Nasi Putih (fixture default items = ayam+nasi); scoped:
    // nota 1 (2 nasi = 10rb), nota 2 (1 nasi = 5rb), nota 3 & 4 (2 nasi = 10rb masing-masing)
    expect(r.filteredCount).toBe(4)
    expect(r.filteredRevenue).toBe(10000 + 5000 + 10000 + 10000)
    expect(r.rows[0].scopedItems).toEqual([{ name: 'Nasi Putih', qty: 2, price: 5000 }])
  })

  it('filter kategori: sama seperti menu tapi lintas menu dalam kategori', () => {
    // kategori 20 = Nasi Putih saja di fixture
    const r = applyDetailFilters(txs, { ...baseFilters, categoryId: 20 }, { from: '2026-09-13', to: '2026-09-14' }, nameToId, idToCat)
    expect(r.filteredCount).toBe(4)
    expect(r.filteredRevenue).toBe(35000)
  })

  it('cari nomor nota bersifat substring & case-insensitive', () => {
    const r = applyDetailFilters(txs, { ...baseFilters, q: 'sb260913' }, { from: '2026-09-01', to: '2026-09-14' }, nameToId, idToCat)
    expect(r.filteredCount).toBe(1)
    expect(r.rows[0].tx.id).toBe(3)
  })

  it('urutan hasil terbaru dulu', () => {
    const r = applyDetailFilters(txs, baseFilters, { from: '2026-09-13', to: '2026-09-14' }, nameToId, idToCat)
    // 14 Sep 18:00 > 14 Sep 15:30 > 14 Sep 10:00 > 13 Sep 12:00
    expect(r.rows.map((x) => x.tx.id)).toEqual([4, 2, 1, 3])
  })
})

describe('detailCsv', () => {
  it('tanpa scope: satu baris per nota', () => {
    const t1 = tx({})
    const csv = detailCsv([{ tx: t1, scopedItems: null, scopedTotal: t1.total }], false)
    expect(csv[0]).toEqual(['Nota', 'Tanggal', 'Jam', 'Channel', 'Metode', 'Status', 'Total'])
    expect(csv[1][0]).toBe('SB260914-001')
    expect(csv[1][6]).toBe(20000)
  })

  it('dengan scope menu: baris per item ter-filter + kolom subtotal ter-filter', () => {
    const t1 = tx({})
    const csv = detailCsv([{ tx: t1, scopedItems: [{ name: 'Nasi Putih', qty: 2, price: 5000 }], scopedTotal: 10000 }], true)
    expect(csv[0]).toContain('Menu (ter-filter)')
    expect(csv[1][6]).toBe('Nasi Putih')
    expect(csv[1][8]).toBe(10000)
    expect(csv[1][9]).toBe(20000)
  })
})
