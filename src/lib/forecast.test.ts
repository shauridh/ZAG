import { describe, expect, it } from 'vitest'
import { buyPlanFromSales, buyPlanToText, dailySalesOf, weekendRatioOf } from './forecast'
import type { Transaction } from './types'

const ingredients = [
  // price = per satuan dasar; pack_content = isi per satuan beli
  { id: 1, name: 'Ayam Potong 9', kind: 'raw' as const, stock: 0, buy_unit: 'ekor', pack_content: 9, price: 5333 },
  { id: 3, name: 'Tepung Bumbu', kind: 'raw' as const, stock: 0, buy_unit: 'pack', pack_content: 1, price: 23500 },
  { id: 4, name: 'Minyak', kind: 'raw' as const, stock: 2, buy_unit: 'liter', pack_content: 2, price: 21700 },
  // prepared: diresepkan dari minyak (id 4)
  { id: 50, name: 'Ayam Marinasi', kind: 'prepared' as const, stock: 0, buy_unit: 'potong', pack_content: 1, price: 0 }
]

// 1 ekor = 9 potong; marinasi 1 potong butuh 1 potong ayam
const recipeByProduct = new Map([[10, [{ product_id: 10, kind: 'ingredient' as const, component_id: 50, qty: 1 }]]])
const ingRecipes = new Map([[50, [{ ingredient_id: 50, component_id: 1, qty: 1 }]]])

/** tanggal ISO offset dari hari ini (pakai toISOString supaya konsisten dgn engine) */
const isoOffset = (daysAgo: number): string => {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}
const isoAhead = (days: number): string => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
const isWknd = (iso: string): boolean => {
  const day = new Date(iso + 'T00:00:00').getDay()
  return day === 0 || day === 6
}

describe('buyPlanFromSales', () => {
  it('menghitung kebutuhan bahan mentah dari penjualan produk (flat, tanpa data weekend cukup)', () => {
    // 1 hari historis, terjual 18 potong → butuh 18 potong ayam = 2 ekor
    const daily = new Map([[isoOffset(0), new Map([[10, 18]])]])
    const plan = buyPlanFromSales(daily, 1, 1, ingredients, recipeByProduct, ingRecipes)
    const ayam = plan.items.find((i) => i.ingredientId === 1)!
    expect(ayam.need).toBe(18)
    expect(ayam.buyQty).toBe(2) // ceil(18/9)
    expect(ayam.cost).toBe(2 * 5333 * 9)
    expect(plan.weekendRatio).toBe(1) // sampel kurang → flat
  })

  it('rata-rata harian dibagi panjang periode kalender (hari kosong = 0)', () => {
    // basis kalender disuntik (Rabu 2026-09-09, tengah hari UTC) supaya test
    // deterministik — tanpa ini profil weekday/weekend berubah tiap hari uji.
    const base = new Date('2026-09-09T12:00:00Z')
    // 9 potong pada hari basis dalam window 3 hari → rata-rata 3 potong/hari
    const daily = new Map([['2026-09-09', new Map([[10, 9]])]])
    const plan = buyPlanFromSales(daily, 2, 3, ingredients, recipeByProduct, ingRecipes, base)
    const ayam = plan.items.find((i) => i.ingredientId === 1)!
    // horizon 2 hari (Kamis+Jumat = hari kerja): profil weekday 3/hari — total = 3×2=6
    expect(ayam.dailyUse).toBe(3)
    expect(ayam.need).toBe(6)
    expect(ayam.buyQty).toBe(1)
  })

  it('stok cukup → tidak masuk daftar belanja', () => {
    const daily = new Map([[isoOffset(0), new Map([[10, 9]])]])
    const withStock = ingredients.map((i) => (i.id === 1 ? { ...i, stock: 9 } : i))
    const plan = buyPlanFromSales(daily, 1, 1, withStock, recipeByProduct, ingRecipes)
    expect(plan.items.find((i) => i.ingredientId === 1)).toBeUndefined()
    expect(plan.totalCost).toBe(0)
  })

  it('bahan prepared diekspansi ke bahan mentahnya', () => {
    const recWithOil = new Map(ingRecipes)
    recWithOil.set(50, [
      { ingredient_id: 50, component_id: 1, qty: 1 },
      { ingredient_id: 50, component_id: 4, qty: 0.05 }
    ])
    const daily = new Map([[isoOffset(0), new Map([[10, 9]])]])
    // minyak terpakai 0,45 L < stok 2 L → tidak masuk daftar; ayam tetap masuk
    const plan = buyPlanFromSales(daily, 1, 1, ingredients, recipeByProduct, recWithOil)
    expect(plan.items.find((i) => i.ingredientId === 4)).toBeUndefined()
    // dan bila stok minyak rendah, ekspansi prepared menghasilkan baris minyak
    const lowOil = ingredients.map((i) => (i.id === 4 ? { ...i, stock: 0.2 } : i))
    const plan2 = buyPlanFromSales(daily, 1, 1, lowOil, recipeByProduct, recWithOil)
    const minyak = plan2.items.find((i) => i.ingredientId === 4)
    expect(minyak).toBeDefined()
    expect(minyak!.need).toBeCloseTo(0.45, 5)
    // ceil(0.25/2) = 1 pack 2 liter
    expect(minyak!.buyQty).toBe(1)
  })

  it('weekend-aware: horizon yang memuat weekend lebih berat dari horizon kerja', () => {
    // pilih window historis 28 hari supaya pasti ≥4 weekend & ≥10 hari kerja,
    // dengan penjualan 12 potong di tiap weekend dan 6 di tiap hari kerja
    const daily = new Map<string, Map<number, number>>()
    for (let i = 0; i < 28; i++) {
      const iso = isoOffset(i)
      daily.set(iso, new Map([[10, isWknd(iso) ? 12 : 6]]))
    }
    // rata-rata keseluruhan = 6×(12/7) + 6×(5/7)... hitung eksak via ratio
    const plan14 = buyPlanFromSales(daily, 14, 28, ingredients, recipeByProduct, ingRecipes)
    const plan3 = buyPlanFromSales(daily, 3, 28, ingredients, recipeByProduct, ingRecipes)
    expect(plan14.weekendRatio).toBe(2) // 12/6
    const ayam14 = plan14.items.find((i) => i.ingredientId === 1)!
    const ayam3 = plan3.items.find((i) => i.ingredientId === 1)!
    expect(ayam3).toBeDefined()

    // horizon 14 hari harus dekat komposisi 2 minggu penuh: 10 kerja ×6 + 4 weekend ×12 = 108
    expect(ayam14.need).toBe(108)
    // horizon 3 hari: jumlah profil 3 hari kalender terdekat
    let expect3 = 0
    for (let i = 1; i <= 3; i++) expect3 += isWknd(isoAhead(i)) ? 12 : 6
    expect(ayam3.need).toBe(expect3)
  })

  it('teks WhatsApp berisi nama bahan dan total', () => {
    const daily = new Map([[isoOffset(0), new Map([[10, 18]])]])
    const plan = buyPlanFromSales(daily, 1, 1, ingredients, recipeByProduct, ingRecipes)
    const text = buyPlanToText(plan)
    expect(text).toContain('Ayam Potong 9')
    expect(text).toContain('2 ekor')
    expect(text).toContain('Rencana belanja 1 hari')
  })
})

describe('dailySalesOf', () => {
  it('menjumlahkan qty item transaksi per hari per product_id', () => {
    const names = new Map([[10, 'Ayam Dada']])
    const today = isoOffset(0)
    const txs = [
      { created_at: today + 'T10:00:00', items: [{ name: 'Ayam Dada', qty: 2, price: 11000, hpp: 6000 }] },
      { created_at: today + 'T15:00:00', items: [{ name: 'Ayam Dada', qty: 1, price: 11000, hpp: 6000 }, { name: 'Nasi', qty: 1, price: 5000, hpp: 1500 }] },
      { created_at: isoOffset(1) + 'T15:00:00', items: [{ name: 'Ayam Dada', qty: 5, price: 11000, hpp: 6000 }] }
    ] as unknown as Transaction[]
    const out = dailySalesOf(txs, [10], names)
    expect(out.get(today)!.get(10)).toBe(3)
    expect(out.get(isoOffset(1))!.get(10)).toBe(5)
  })
})

describe('weekendRatioOf', () => {
  it('menghitung rasio weekend vs kerja dan membatasi rentang', () => {
    const daily = new Map<string, Map<number, number>>()
    for (let i = 0; i < 28; i++) {
      const iso = isoOffset(i)
      daily.set(iso, new Map([[10, isWknd(iso) ? 12 : 6]]))
    }
    expect(weekendRatioOf(daily).ratio).toBe(2)
    // data 1 hari saja → ratio 1 (tak cukup sampel)
    expect(weekendRatioOf(new Map([[isoOffset(0), new Map([[10, 5]])]])).ratio).toBe(1)
  })
})
