import { describe, expect, it } from 'vitest'
import { bundleComponentTotal, bundleMaxQty, bundleSavings, bundleSummary, expandBundle, mergeCartLines, splitDiscount } from './combo'
import type { Bundle } from './types'

/**
 * Kasus nyata: Paket Combo Paha = 2× Ayam Paha Bawah (9.000) + Nasi Putih
 * (5.000) + Sambal Geprek cup (4.000) → total komponen 27.000, dijual 25.000
 * → hemat 2.000, dipecah pro-rata utk laporan per menu.
 */

const byId = new Map([
  [1, { name: 'Ayam Paha Bawah', price: 9000 }],
  [2, { name: 'Nasi Putih', price: 5000 }],
  [3, { name: 'Sambal Geprek (cup)', price: 4000 }]
])
const ITEMS = [
  { product_id: 1, qty: 2 },
  { product_id: 2, qty: 1 },
  { product_id: 3, qty: 1 }
]

describe('bundleComponentTotal & bundleSavings', () => {
  it('total komponen = Σ qty × harga', () => {
    expect(bundleComponentTotal(ITEMS, byId)).toBe(27000)
  })
  it('hemat = total komponen − harga paket', () => {
    expect(bundleSavings(25000, ITEMS, byId)).toBe(2000)
  })
  it('harga paket di atas total komponen → hemat 0 (tidak minus)', () => {
    expect(bundleSavings(30000, ITEMS, byId)).toBe(0)
  })
  it('komponen tak dikenal dihitung 0, tidak meledakkan', () => {
    expect(bundleComponentTotal([{ product_id: 99, qty: 1 }], byId)).toBe(0)
  })
})

describe('bundleMaxQty', () => {
  it('dibatasi komponen paling ketat: 2 paha per paket, sisa paha 6 → 3 paket', () => {
    expect(bundleMaxQty(ITEMS, (pid) => (pid === 1 ? 6 : 99))).toBe(3)
  })
  it('komponen habis → 0 paket', () => {
    expect(bundleMaxQty(ITEMS, (pid) => (pid === 2 ? 0 : 99))).toBe(0)
  })
  it('paket kosong → 0', () => {
    expect(bundleMaxQty([], () => 10)).toBe(0)
  })
})

describe('bundleSummary', () => {
  it('ringkas isi paket dgn qty ganda', () => {
    expect(bundleSummary(ITEMS, byId)).toBe('2× Ayam Paha Bawah + Nasi Putih + Sambal Geprek (cup)')
  })
  it('lebih dari maxNames → "+N lain"', () => {
    const items = [
      { product_id: 1, qty: 1 },
      { product_id: 2, qty: 1 },
      { product_id: 3, qty: 1 },
      { product_id: 1, qty: 1 }
    ]
    expect(bundleSummary(items, byId, 3)).toBe('Ayam Paha Bawah + Nasi Putih + Sambal Geprek (cup) +1 lain')
  })
})

describe('expandBundle', () => {
  const b: Bundle = { id: 7, name: 'Paket Combo Paha', price: 25000, is_active: true, items: ITEMS }
  it('qty paket 1 → baris komponen dgn asal paket', () => {
    const lines = expandBundle(b, 1)
    expect(lines.map((l) => l.qty)).toEqual([2, 1, 1])
    expect(lines.every((l) => l.via === 'Paket Combo Paha')).toBe(true)
  })
  it('qty paket 2 → qty komponen ikut dua kali', () => {
    expect(expandBundle(b, 2).map((l) => l.qty)).toEqual([4, 2, 2])
  })
})

describe('mergeCartLines', () => {
  type L = { product_id: number; name: string; qty: number; price: number; max: number }
  const cart: L[] = [{ product_id: 2, name: 'Nasi Putih', qty: 1, price: 5000, max: 5 }]
  it('produk sama → qty dijumlah, bukan baris baru', () => {
    const { lines, rejected } = mergeCartLines(cart, [{ product_id: 2, name: 'Nasi Putih', qty: 2, price: 5000, max: 5 }])
    expect(lines).toHaveLength(1)
    expect(lines[0].qty).toBe(3)
    expect(rejected).toEqual([])
  })
  it('melebihi max → dipotong ke max & dilaporkan', () => {
    const { lines, rejected } = mergeCartLines(cart, [{ product_id: 2, name: 'Nasi Putih', qty: 9, price: 5000, max: 5 }])
    expect(lines[0].qty).toBe(5)
    expect(rejected).toEqual(['Nasi Putih'])
  })
  it('produk baru masuk sebagai baris tambahan (max longgar dipertahankan)', () => {
    const { lines } = mergeCartLines<L>([], [{ product_id: 1, name: 'Paha', qty: 2, price: 9000, max: 2 }])
    expect(lines[0].max).toBe(2)
  })
})

describe('splitDiscount (regresi laporan per menu)', () => {
  it('hemat 2.000 atas 18rb+5rb+4rb → pecahan bulat, total pas 2.000', () => {
    const parts = splitDiscount([18000, 5000, 4000], 2000)
    expect(parts.reduce((s, v) => s + v, 0)).toBe(2000)
    expect(parts.every((v) => Number.isInteger(v))).toBe(true)
    expect(parts).toEqual([1333, 370, 297]) // pro-rata 2/3, 5/27, 4/27
  })
  it('diskon 0 atau nilai kosong → semua nol', () => {
    expect(splitDiscount([18000], 0)).toEqual([0])
    expect(splitDiscount([], 2000)).toEqual([])
  })
  it('sisa pembulatan ditampung baris terakhir', () => {
    const parts = splitDiscount([100, 100, 100], 1)
    expect(parts.reduce((s, v) => s + v, 0)).toBe(1)
  })
})
