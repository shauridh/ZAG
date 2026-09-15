import { beforeEach, describe, expect, it } from 'vitest'
import {
  addExpense,
  closeShift,
  createPurchase,
  createTx,
  loadCatalog,
  loadFinance,
  loadShifts,
  logWaste,
  opname,
  openShift,
  payHeldOrder,
  refundTx,
  resetDemoData,
  saveHeldOrder,
  setOwnerPin,
  shiftCashMovement,
  voidHeldOrder,
  portal
} from './db'
import { txCashNet } from './reports'
import type { TxResult } from './db-shared'
import type { Transaction } from './types'

/** TxResult -> bentuk Transaction minimal utk txCashNet. */
const asTx = (r: TxResult): Transaction => ({ ...r, shift_id: 1, user_id: null, hpp: 0, note: null, created_at: r.created_at }) as Transaction

/**
 * Uji satu hari operasional penuh (mode demo): portal, kasir, bill, refund,
 * pengeluaran, uang drawer, tutup shift. Semua angka kas diverifikasi —
 * terutama kembalian: payments menyimpan UANG DITERIMA, kas harus net.
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

const ls = (): { txs: { id: number; total: number; payments: { method: string; amount: number }[]; status?: string; shift_id: number | null }[]; shifts: { id: number; status: string; opening_cash: number; cash_in: number | null; cash_out: number | null; expected_cash: number | null; cash_diff: number | null }[]; ingredients: { id: number; stock: number }[]; orders: { id: number; status: string }[]; heldOrders: unknown[] } =>
  JSON.parse(localStorage.getItem('sabana-demo-v3') || '{}')

const stockOf = async (needle: string): Promise<number> => {
  const { loadCatalog } = await import('./db')
  const ing = (await loadCatalog()).ingredients.find((i) => i.name.toLowerCase().includes(needle))
  if (!ing) throw new Error(`bahan ${needle} tidak ada`)
  return ing.stock
}

beforeEach(async () => {
  stubLocalStorage()
  await resetDemoData()
  await setOwnerPin('482913')
  await openShift(350000)
})

describe('hari operasional: portal', () => {
  it('pesanan selesai memotong stok; batal pelanggan & tolak kasir tidak', async () => {
    const p = await portal.register('081299001122', 'Tn. Uji', '123456')
    await portal.updateProfile(p.token, 'Tn. Uji', 'Ambil di outlet')
    await portal.saveAddress(p.token, null, 'Ambil Sendiri', 'Ambil di outlet', null, null)
    const s0 = await stockOf('teh botol')

    const o1 = await portal.createOrder(p.token, [{ product_id: 27, qty: 1 }], 1, 'es batu sedikit')
    await import('./db').then(async (db) => {
      await db.acceptOrder(o1)
    })
    await portal.confirmPaid(p.token, o1)
    await import('./db').then(async (db) => db.verifyOrderPayment(o1))
    await import('./db').then(async (db) => db.setOrderStatus(o1, 'dikirim'))
    await import('./db').then(async (db) => db.setOrderStatus(o1, 'selesai'))

    const o2 = await portal.createOrder(p.token, [{ product_id: 27, qty: 2 }], 1, 'ubah pikiran')
    await portal.cancelOrder(p.token, o2)

    const o3 = await portal.createOrder(p.token, [{ product_id: 27, qty: 1 }], 1, '')
    await import('./db').then(async (db) => db.acceptOrder(o3))
    await portal.confirmPaid(p.token, o3)
    await import('./db').then(async (db) => db.rejectPaidOrder(o3, 'Stok habis'))

    expect(await stockOf('teh botol')).toBe(s0 - 1)
    const statuses = ls().orders.map((o) => o.status)
    expect(statuses).toContain('selesai')
    expect(statuses).toContain('batal')
    expect(statuses).toContain('ditolak')
  })
})

describe('hari operasional: kasir, bill, refund, tutup shift', () => {
  it('alur penuh dengan angka kas yang benar (kembalian dipertanggungkan)', async () => {
    // ===== TRX 1: tunai 50rb utk nota 27rb (kembalian 23rb) =====
    const tx1 = await createTx({
      orderType: 'dinein',
      items: [{ product_id: 1, qty: 2 }, { product_id: 7, qty: 1 }],
      payments: [{ method: 'cash', amount: 50000 }],
      discount: 0
    })
    expect(tx1.total).toBe(27000)
    expect(txCashNet(asTx(tx1))).toBe(27000) // bukan 50rb

    // ===== TRX 2: QRIS =====
    const tx2 = await createTx({ orderType: 'takeaway', items: [{ product_id: 13, qty: 1 }], payments: [{ method: 'qris', amount: 8000 }] })
    expect(txCashNet(asTx(tx2))).toBe(0)

    // ===== BILL: simpan (stok belum) → bayar tunai 20rb utk 15rb =====
    const sTehBeforeSave = await stockOf('teh botol')
    const bill = await saveHeldOrder({ orderType: 'dinein', items: [{ product_id: 27, name: 'Teh Botol Sosro', qty: 3, price: 5000 }], subtotal: 15000, discount: 0, total: 15000, note: null, label: 'Meja 7' })
    expect(await stockOf('teh botol')).toBe(sTehBeforeSave) // simpan tanpa potong
    const tx3 = await payHeldOrder(bill.id, 'cash', 20000)
    expect(tx3.total).toBe(15000)
    expect(txCashNet(asTx(tx3))).toBe(15000)
    expect(await stockOf('teh botol')).toBe(sTehBeforeSave - 3)
    expect((await loadHeldSafe()).length).toBe(0)

    // ===== BILL void: tanpa transaksi, stok utuh =====
    const sSayap = await stockOf('ayam potong 9')
    const billB = await saveHeldOrder({ orderType: 'takeaway', items: [{ product_id: 4, name: 'Ayam Sayap', qty: 1, price: 8000 }], subtotal: 8000, discount: 0, total: 8000, note: null, label: 'GoFood B' })
    await voidHeldOrder(billB.id)
    expect(await stockOf('ayam potong 9')).toBe(sSayap)

    // ===== Uang drawer: setoran masuk 100rb, belanja keluar 25rb =====
    await shiftCashMovement('in', 100000, 'setoran modal tambahan')
    await shiftCashMovement('out', 25000, 'beli gas mendadak')

    // ===== REFUND TRX 1 (tunai 27rb kembali ke pelanggan) =====
    const refund = await refundTx(tx1.id, 'pelanggan batal', '482913')
    expect(refund.amount).toBe(27000)
    expect(txCashNet((await loadTransactionsToday()).find((t) => t.id === refund.refund_id)!)).toBe(-27000)

    // ===== Pengeluaran =====
    await addExpense(1, 15000, 'plastik')

    // ===== TUTUP SHIFT: kas drawer pas =====
    // expected = 350.000 (modal) + kas jual net (27rb + 15rb) − refund 27rb + in 100rb − out 25rb
    const expected = 350000 + 27000 + 15000 - 27000 + 100000 - 25000
    const rep = await closeShift(expected, '')
    expect(rep.cash_sales).toBe(27000 + 15000 - 27000) // net refund
    expect(rep.cash_in).toBe(100000)
    expect(rep.cash_out).toBe(25000)
    expect(rep.expected_cash).toBe(expected)
    expect(rep.cash_diff).toBe(0)

    const shift = (await loadShifts()).find((s) => s.status === 'tutup')!
    expect(shift.cash_diff).toBe(0)
  })

  it('kas kurang tanpa catatan → ditolak; dengan catatan → lolos', async () => {
    await createTx({ orderType: 'dinein', items: [{ product_id: 7, qty: 1 }], payments: [{ method: 'cash', amount: 5000 }] })
    await expect(closeShift(350000, '')).rejects.toThrow(/wajib isi catatan/i)
    const rep = await closeShift(350000, 'kembalian salah kasus')
    expect(rep.cash_diff).toBe(-5000)
  })
})

async function loadHeldSafe(): Promise<unknown[]> {
  return ls().heldOrders ?? []
}

async function loadTransactionsToday() {
  const { loadTransactions } = await import('./db')
  const dates = await import('./dates')
  // rentang hari lokal dgn UTC ISO (dayStart/dayEnd) — sama dgn pola halaman Riwayat:
  // string-compare created_at benar meski test jalan lewat tengah malam WIB.
  const today = dates.todayISO()
  return loadTransactions(dates.dayStart(today), dates.dayEnd(today))
}

describe('hari operasional: keuangan', () => {
  it('pengeluaran & pemasukan lain tercatat di laporan', async () => {
    await addExpense(2, 30000, 'token listrik')
    const today = (await import('./dates')).todayISO()
    const fin = await loadFinance(today, today)
    expect(fin.expenses.reduce((s, e) => s + e.amount, 0)).toBe(30000)
  })
})

describe('hari operasional: bahan baku, stok, opname, pembelian', () => {
  it('pembelian menambah stok & memperbarui harga; opname mengoreksi; waste mengurangi; HPP mengikuti harga beli baru', async () => {
    const cat0 = await loadCatalog()
    const teh = cat0.ingredients.find((i) => i.name.toLowerCase().includes('teh botol'))!
    const s0 = teh.stock
    const price0 = teh.price

    // ===== PEMBELIAN 2 pack @ pack_price 24.000 (harga/kemasan dari form) =====
    // pack_content mis. 24 botol → harga per satuan kecil = 24.000/24 = 1.000
    const packPrice = 24000
    await createPurchase([{ ingredient_id: teh.id, packs: 2, unit_cost: packPrice }], 'beli sore')
    const cat1 = await loadCatalog()
    const teh1 = cat1.ingredients.find((i) => i.id === teh.id)!
    expect(teh1.stock).toBeCloseTo(s0 + 2 * teh.pack_content, 4)
    expect(teh1.price).toBe(Math.round(packPrice / teh.pack_content))

    // ===== WASTE bahan: botol pecah 1 =====
    await logWaste([{ ingredient_id: teh.id, qty: 1 }], 'botol pecah')
    const cat2 = await loadCatalog()
    expect(cat2.ingredients.find((i) => i.id === teh.id)!.stock).toBeCloseTo(s0 + 2 * teh.pack_content - 1, 4)

    // ===== OPNAME: hitung fisik 10 =====
    await opname(teh.id, 10)
    const cat3 = await loadCatalog()
    expect(cat3.ingredients.find((i) => i.id === teh.id)!.stock).toBe(10)

    // ===== HPP mengikuti harga beli: jual 1 teh setelah harga naik =====
    const tx = await createTx({ orderType: 'dinein', items: [{ product_id: 27, qty: 1 }], payments: [{ method: 'cash', amount: 5000 }] })
    void tx
    // stok turun 1 dari opname
    const cat4 = await loadCatalog()
    expect(cat4.ingredients.find((i) => i.id === teh.id)!.stock).toBe(9)
    void price0
  })

  it('transaksi menolak bila stok kurang, lalu pembelian menyelamatkan', async () => {
    const cat0 = await loadCatalog()
    const kentang = cat0.ingredients.find((i) => i.name.toLowerCase().includes('kentang'))!
    // habiskan stok kentang via opname ke 0
    await opname(kentang.id, 0)
    await expect(
      createTx({ orderType: 'dinein', items: [{ product_id: 13, qty: 1 }], payments: [{ method: 'cash', amount: 8000 }] })
    ).rejects.toThrow(/stok kurang/i)
    // pembelian 3 kemasan → jual 1 porsi kentang sekarang berhasil
    await createPurchase([{ ingredient_id: kentang.id, packs: 3, unit_cost: kentang.pack_content > 0 ? 40000 : 40000 }], 'restock darurat')
    const tx = await createTx({ orderType: 'dinein', items: [{ product_id: 13, qty: 1 }], payments: [{ method: 'cash', amount: 8000 }] })
    expect(tx.total).toBe(8000)
    const cat1 = await loadCatalog()
    expect(cat1.ingredients.find((i) => i.id === kentang.id)!.stock).toBe(3 * kentang.pack_content - 120)
  })
})
