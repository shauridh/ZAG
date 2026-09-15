import { describe, expect, it } from 'vitest'
import { breakdownMismatch, fromSmallQty, originQtyLabel, toSmallQty } from './units'

/**
 * Regresi konversi satuan pack↔kecil di output batch produksi (form manual &
 * templat 1 klik). Konvensi: stok selalu satuan KECIL; mode 'buy' hanya cara
 * input dapur — bug lama: templat menulis angka pack mentah (1 pack → 1 potong).
 */
describe('toSmallQty (input dapur → stok)', () => {
  it('mode buy mengalikan isi kemasan', () => {
    expect(toSmallQty(1, 'buy', 12)).toBe(12)
    expect(toSmallQty(2, 'buy', 12)).toBe(24)
    expect(toSmallQty(1.5, 'buy', 1000)).toBe(1500)
  })

  it('pecahan pack tetap akurat (pembulatan 2 desimal)', () => {
    expect(toSmallQty(0.5, 'buy', 12)).toBe(6)
    expect(toSmallQty(0.33, 'buy', 12)).toBeCloseTo(3.96, 10)
  })

  it('mode small lolos tanpa diubah', () => {
    expect(toSmallQty(9, 'small', 12)).toBe(9)
    expect(toSmallQty(4, 'small', 1)).toBe(4)
  })

  it('isi kemasan 0/kosong tidak menghasilkan 0 (diperlakukan sebagai 1)', () => {
    expect(toSmallQty(3, 'buy', 0)).toBe(3)
    expect(toSmallQty(3, 'buy', NaN)).toBe(3)
  })
})

describe('fromSmallQty (stok → tampilan input)', () => {
  it('mode buy membagi isi kemasan (3 desimal)', () => {
    expect(fromSmallQty(12, 'buy', 12)).toBe(1)
    expect(fromSmallQty(9, 'buy', 12)).toBe(0.75)
    expect(fromSmallQty(1500, 'buy', 1000)).toBe(1.5)
  })

  it('mode small / isi 1 lolos tanpa diubah', () => {
    expect(fromSmallQty(9, 'small', 12)).toBe(9)
    expect(fromSmallQty(9, 'buy', 1)).toBe(9)
  })
})

describe('round-trip pack↔kecil', () => {
  it('kecil → buy → kecil kembali ke nilai awal', () => {
    for (const packs of [1, 2, 3.5, 10]) {
      const small = toSmallQty(packs, 'buy', 12)
      expect(fromSmallQty(small, 'buy', 12)).toBe(packs)
    }
  })
})

describe('breakdownMismatch (guard komposisi sebelum simpan batch)', () => {
  it('null bila komposisi cocok dgn isi kemasan (2+2+2+3 = 9)', () => {
    const bd = [{ qty: 2 }, { qty: 2 }, { qty: 2 }, { qty: 3 }]
    expect(breakdownMismatch(bd, 9)).toBeNull()
  })

  it('total bila tidak cocok (mis. dada 4 → total 10 vs isi 9)', () => {
    const bd = [{ qty: 2 }, { qty: 2 }, { qty: 2 }, { qty: 4 }]
    expect(breakdownMismatch(bd, 9)).toBe(10)
  })

  it('null bila komposisi kosong (tidak dirinci = tidak ada yang dicek)', () => {
    expect(breakdownMismatch([], 9)).toBeNull()
    expect(breakdownMismatch(null, 9)).toBeNull()
    expect(breakdownMismatch(undefined, 9)).toBeNull()
  })

  it('pecahan isi kemasan tetap dicek akurat', () => {
    const bd = [{ qty: 0.5 }, { qty: 0.5 }]
    expect(breakdownMismatch(bd, 1)).toBeNull()
    expect(breakdownMismatch(bd, 1.5)).toBe(1)
  })
})

describe('originQtyLabel (audit riwayat batch)', () => {
  it('mode buy + isi >1 → "1 pack (12 potong)"', () => {
    expect(originQtyLabel(12, 'buy', 12, 'potong', 'pack')).toBe('1 pack (12 potong)')
    expect(originQtyLabel(24, 'buy', 12, 'potong', 'pack')).toBe('2 pack (24 potong)')
  })

  it('pecahan pack tampil rapi', () => {
    expect(originQtyLabel(6, 'buy', 12, 'potong', 'pack')).toBe('0,5 pack (6 potong)')
  })

  it('mode small → hanya qty kecil, tanpa embel-embel', () => {
    expect(originQtyLabel(9, 'small', 12, 'potong', 'pack')).toBe('9 potong')
    expect(originQtyLabel(22, undefined, 12, 'potong', 'pack')).toBe('22 potong')
  })

  it('mode buy tapi isi kemasan 1 → dianggap input langsung', () => {
    expect(originQtyLabel(5, 'buy', 1, 'cup', 'pack')).toBe('5 cup')
  })

  it('mode buy tanpa satuan beli → fallback qty kecil', () => {
    expect(originQtyLabel(12, 'buy', 12, 'potong', undefined)).toBe('12 potong')
  })
})
