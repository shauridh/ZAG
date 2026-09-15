import { beforeEach, describe, expect, it } from 'vitest'
import {
  createBatch,
  createPurchase,
  createStockAdjustment,
  createTx,
  deleteStockAdjustment,
  loadCatalog,
  loadStockAdjustments,
  loadStockMoves,
  logWaste,
  opname,
  openShift,
  refundTx,
  resetDemoData,
  setOwnerPin,
  updateStockAdjustment
} from './db'

/**
 * Regresi penyesuaian stok bahan sebagai CRUD (demo):
 * - create = opname: stok disetel ke qty fisik, record tercatat dgn nilai sebelumnya.
 * - update: stok terkini digeser selisih (bukan mundur ke masa lalu) — penjualan
 *   di antara create & edit tidak hilang.
 * - delete: stok kembali ke nilai sebelum penyesuaian.
 */

function stubLocalStorage(): void {
  const store = new Map<string, string>()
  ;(globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear()
  }
}

const stockOf = async (needle: string): Promise<number> => {
  const ing = (await loadCatalog()).ingredients.find((i) => i.name.toLowerCase().includes(needle))
  if (!ing) throw new Error(`bahan ${needle} tidak ada`)
  return ing.stock
}

const ingIdOf = async (needle: string): Promise<number> => {
  const ing = (await loadCatalog()).ingredients.find((i) => i.name.toLowerCase().includes(needle))
  if (!ing) throw new Error(`bahan ${needle} tidak ada`)
  return ing.id
}

beforeEach(async () => {
  stubLocalStorage()
  await resetDemoData()
})

describe('penyesuaian stok bahan (CRUD)', () => {
  it('create: stok disetel ke fisik, record menyimpan sebelum & sesudah + catatan', async () => {
    const id = await ingIdOf('teh')
    const before = await stockOf('teh')

    await createStockAdjustment(id, 12.5, 'stok opname pagi')

    expect(await stockOf('teh')).toBe(12.5)
    const list = await loadStockAdjustments()
    expect(list.length).toBe(1)
    expect(list[0].ingredient_id).toBe(id)
    expect(list[0].qty).toBe(12.5)
    expect(list[0].prev_qty).toBe(before)
    expect(list[0].note).toBe('stok opname pagi')
    expect(list[0].created_at).toBeTruthy()
  })

  it('create tanpa catatan: note null, bukan string kosong', async () => {
    const id = await ingIdOf('teh')
    await createStockAdjustment(id, 5)
    expect((await loadStockAdjustments())[0].note).toBeNull()
  })

  it('update: stok terkini digeser selisih — penjualan setelahnya tidak hilang', async () => {
    const id = await ingIdOf('teh')
    await createStockAdjustment(id, 20, 'hitung fisik')
    expect(await stockOf('teh')).toBe(20)

    // Stok berubah di luar penyesuaian (mis. penjualan / pembelian) —
    // simulasi lewat opname lama (yang memang tidak mencatat record).
    await opname(id, 17)

    await updateStockAdjustment((await loadStockAdjustments())[0].id, 25, 'koreksi salah ketik')
    expect(await stockOf('teh')).toBe(22) // 17 - 20 + 25

    const adj = (await loadStockAdjustments())[0]
    expect(adj.qty).toBe(25)
    expect(adj.note).toBe('koreksi salah ketik')
  })

  it('delete: stok kembali ke nilai sebelum penyesuaian', async () => {
    const id = await ingIdOf('teh')
    const before = await stockOf('teh')
    const adjId = await createStockAdjustment(id, 3)
    expect(await stockOf('teh')).toBe(3)

    await deleteStockAdjustment(adjId)
    expect(await stockOf('teh')).toBe(before)
    expect((await loadStockAdjustments()).length).toBe(0)
  })

  it('bahan tidak ditemukan: ditolak dengan pesan jelas', async () => {
    await expect(createStockAdjustment(999999, 1)).rejects.toThrow(/Bahan tidak ditemukan/)
  })

  it('dua bahan berbeda: riwayat terisi keduanya, urutan terbaru dulu', async () => {
    const teh = await ingIdOf('teh')
    const kentang = await ingIdOf('kentang')
    await createStockAdjustment(teh, 9, 'teh dulu')
    await createStockAdjustment(kentang, 7, 'kentang belakangan')
    const list = await loadStockAdjustments()
    expect(list.length).toBe(2)
    expect(list[0].note).toBe('kentang belakangan')
    expect(list[1].note).toBe('teh dulu')
  })
})

describe('ledger pergerakan stok (audit semua jenis)', () => {
  beforeEach(async () => {
    stubLocalStorage()
    await resetDemoData()
    await setOwnerPin('482913')
    await openShift(350000)
  })

  /** Rentang hari ini dlm ISO lengkap (konvensi loadTransactions). */
  const todayRange = (): { fromISO: string; toISO: string } => {
    const d = new Date()
    const off = d.getTimezoneOffset()
    const day = new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
    return { fromISO: day + 'T00:00:00.000Z', toISO: day + 'T23:59:59.999Z' }
  }

  it('pembelian, penjualan, waste, opname, penyesuaian: semua tercatat dgn jenis & ref', async () => {
    const cat = await loadCatalog()
    const teh = cat.ingredients.find((i) => /teh botol/i.test(i.name))!
    const { fromISO, toISO } = todayRange()

    await createPurchase([{ ingredient_id: teh.id, packs: 2, unit_cost: 24000 }], 'beli sore')
    await createTx({ orderType: 'takeaway', items: [{ product_id: 27, qty: 2 }], payments: [{ method: 'cash', amount: 20000 }] })
    await logWaste([{ ingredient_id: teh.id, qty: 1 }], 'pecah')
    await opname(teh.id, 30)
    await createStockAdjustment(teh.id, 28, 'koreksi lagi')

    const moves = await loadStockMoves({ fromISO, toISO })
    const kinds = moves.filter((m) => m.ingredient_id === teh.id).map((m) => m.kind)
    expect(kinds).toContain('pembelian')
    expect(kinds).toContain('penjualan')
    expect(kinds).toContain('waste')
    expect(kinds).toContain('opname')

    const buy = moves.find((m) => m.kind === 'pembelian' && m.ingredient_id === teh.id)!
    expect(buy.qty).toBeCloseTo(2 * teh.pack_content, 4) // 2 pack × isi kemasan (satuan kecil)
    expect(buy.ref).toMatch(/^PO/)
    const sale = moves.find((m) => m.kind === 'penjualan' && m.ingredient_id === teh.id)!
    expect(sale.qty).toBeCloseTo(-2, 4) // 2 teh = 2 botol
    expect(sale.ref).toMatch(/^TX/)
    const adj = moves.find((m) => m.ref?.startsWith('ADJ') && m.ingredient_id === teh.id)
    expect(adj?.note).toBe('koreksi lagi')
  })

  it('produksi: output & bahan mentah tercatat dgn ref batch sama (PR*)', async () => {
    const { fromISO, toISO } = todayRange()
    const cat = await loadCatalog()
    const ayamMarinasi = cat.ingredients.find((i) => /ayam marinasi/i.test(i.name))
    if (!ayamMarinasi) throw new Error('bahan ayam marinasi tidak ada')
    const ayamMentah = cat.ingredients.find((i) => /ayam potong/i.test(i.name))
    if (!ayamMentah) throw new Error('bahan ayam potong tidak ada')

    await createBatch({ outputs: [{ ingredient_id: ayamMarinasi.id, qty: 9 }], fryer_id: null, fried_grams: 0, note: 'uji ledger' })

    const moves = await loadStockMoves({ fromISO, toISO })
    const batchMoves = moves.filter((m) => m.kind === 'produksi')
    expect(batchMoves.length).toBeGreaterThan(0)
    const refs = new Set(batchMoves.map((m) => m.ref))
    // output (+9) & konsumsi mentah memakai satu ref PR yang sama
    const outRef = batchMoves.find((m) => m.ingredient_id === ayamMarinasi.id)!.ref
    expect(refs.has(outRef!)).toBe(true)
    const raw = batchMoves.find((m) => m.ingredient_id === ayamMentah.id)
    expect(raw?.ref).toBe(outRef)
    expect(raw!.qty).toBeLessThan(0)
  })

  it('refund: stok kembali tercatat dgn jenis refund', async () => {
    const { fromISO, toISO } = todayRange()
    await createTx({ orderType: 'takeaway', items: [{ product_id: 27, qty: 1 }], payments: [{ method: 'cash', amount: 10000 }] })
    const tx = (await loadStockMoves({ fromISO, toISO })).find((m) => m.kind === 'penjualan')
    expect(tx).toBeTruthy()
    await refundTx(Number(tx!.ref!.slice(2)), 'uji refund', '482913')
    const kinds = (await loadStockMoves({ fromISO, toISO })).map((m) => m.kind)
    expect(kinds).toContain('refund')
  })

  it('filter bahan & rentang tanggal bekerja', async () => {
    const teh = await ingIdOf('teh botol')
    const kentang = await ingIdOf('kentang')
    await createPurchase([{ ingredient_id: teh, packs: 1, unit_cost: 24000 }], 'a')
    await createPurchase([{ ingredient_id: kentang, packs: 1, unit_cost: 30000 }], 'b')

    const { fromISO, toISO } = todayRange()
    const onlyTeh = await loadStockMoves({ ingredientId: teh, fromISO, toISO })
    expect(onlyTeh.length).toBeGreaterThan(0)
    expect(onlyTeh.every((m) => m.ingredient_id === teh)).toBe(true)

    const none = await loadStockMoves({ fromISO: '1999-01-01T00:00:00.000Z', toISO: '1999-01-01T23:59:59.999Z' })
    expect(none).toEqual([])
  })
})
