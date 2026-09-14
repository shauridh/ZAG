import { beforeEach, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  demoCreateTx,
  demoLoadCatalog,
  demoLoadHeldOrders,
  demoPayHeldOrder,
  demoSaveHeldOrder,
  demoVoidHeldOrder,
  demoOpenShift,
  resetDemoData
} from './db-demo'
import {
  liveLoadHeldOrders,
  livePayHeldOrder,
  liveSaveHeldOrder,
  liveVoidHeldOrder
} from './db-live'
import type { HeldOrder } from './types'

// ================= Util demo =================

/** localStorage in-memory: db-demo disimpan di LS, test node env butuh stub. */
function stubLocalStorage(): void {
  const store = new Map<string, string>()
  ;(globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear()
  }
}

beforeEach(() => {
  stubLocalStorage()
  resetDemoData() // seed demo v7 bersih tiap test
  demoOpenShift(350000) // modal awal = float kembalian demo; bill butuh shift buka
})

const tehStock = (): number => {
  const ing = demoLoadCatalog().ingredients.find((i) => i.name.toLowerCase().includes('teh botol'))
  if (!ing) throw new Error('Bahan Teh Botol tidak ada di seed demo')
  return ing.stock
}

const saveTehBill = (label = 'Meja 4'): HeldOrder =>
  demoSaveHeldOrder({
    orderType: 'dinein',
    items: [{ product_id: 27, name: 'Teh Botol Sosro', qty: 2, price: 5000 }],
    subtotal: 10000,
    discount: 0,
    total: 10000,
    note: null,
    label
  })

// ================= Demo adapter =================

describe('demo: simpan bill', () => {
  it('menyimpan bill tanpa memotong stok dan tanpa membuat transaksi', () => {
    const before = tehStock()
    const bill = saveTehBill()
    expect(bill.id).toBeGreaterThan(0)
    expect(bill.total).toBe(10000)
    expect(demoLoadHeldOrders()).toHaveLength(1)
    expect(tehStock()).toBe(before) // stok belum dipotong saat simpan
  })

  it('menolak simpan tanpa shift terbuka', () => {
    resetDemoData() // seed segar: belum ada shift buka
    expect(() => saveTehBill()).toThrow(/Buka shift dulu/)
  })

  it('menolak simpan keranjang kosong', () => {
    expect(() =>
      demoSaveHeldOrder({ orderType: 'dinein', items: [], subtotal: 0, discount: 0, total: 0, note: null, label: null })
    ).toThrow(/Keranjang kosong/)
  })

  it('loadHeldOrders urut dari yang tertua', () => {
    saveTehBill('A')
    saveTehBill('B')
    const list = demoLoadHeldOrders()
    expect(list).toHaveLength(2)
    expect(list[0].label).toBe('A')
    expect(list[1].label).toBe('B')
  })
})

describe('demo: bayar bill', () => {
  it('membuat transaksi, memotong stok TEPAT SEKALI (regresi double-decrement), menghapus bill', () => {
    // delta stok acuan: transaksi langsung dgn item sama (seed bersih, stok sama)
    const stock0 = tehStock()
    demoCreateTx({
      orderType: 'dinein',
      items: [{ product_id: 27, qty: 2 }],
      payments: [{ method: 'cash', amount: 10000 }]
    })
    const deltaDirect = stock0 - tehStock()
    expect(deltaDirect).toBeGreaterThan(0)

    // reset ke seed bersih lalu jalankan lewat alur bill
    resetDemoData()
    demoOpenShift(350000)
    const before = tehStock()
    const bill = saveTehBill()
    const tx = demoPayHeldOrder(bill.id, 'cash', 10000)
    expect(tx.receipt_no).toMatch(/^SB/)
    expect(tx.total).toBe(10000)
    expect(demoLoadHeldOrders()).toHaveLength(0)
    expect(before - tehStock()).toBe(deltaDirect) // sama persis dgn transaksi langsung
  })

  it('diskon revisi saat bayar dipakai untuk total transaksi', () => {
    const bill = saveTehBill()
    const tx = demoPayHeldOrder(bill.id, 'cash', 9000, 1000)
    expect(tx.discount).toBe(1000)
    expect(tx.total).toBe(9000)
  })

  it('uang kurang -> gagal, bill TETAP ADA, stok tetap', () => {
    const before = tehStock()
    const bill = saveTehBill()
    expect(() => demoPayHeldOrder(bill.id, 'cash', 5000)).toThrow(/kurang/i)
    expect(demoLoadHeldOrders()).toHaveLength(1)
    expect(tehStock()).toBe(before)
  })

  it('bayar bill yang sudah tidak ada -> error jelas', () => {
    const bill = saveTehBill()
    demoPayHeldOrder(bill.id, 'cash', 10000)
    expect(() => demoPayHeldOrder(bill.id, 'cash', 10000)).toThrow(/tidak ditemukan/i)
  })
})

describe('demo: void bill', () => {
  it('menghapus bill tanpa transaksi dan tanpa menyentuh stok', () => {
    const before = tehStock()
    const bill = saveTehBill()
    demoVoidHeldOrder(bill.id)
    expect(demoLoadHeldOrders()).toHaveLength(0)
    expect(tehStock()).toBe(before)
  })

  it('void bill yang tidak ada -> error', () => {
    expect(() => demoVoidHeldOrder(9999)).toThrow(/tidak ditemukan/i)
  })
})

// ================= Live adapter (fake Supabase) =================

type RpcResult = { data?: unknown; error?: { message: string } | null }

/**
 * Fake sb (SupabaseClient): thenable query builder per tabel + rpc.
 * Cukup untuk pola query yang dipakai live adapter held orders.
 */
function makeSb(cfg: {
  openShift?: { id: number }[] | null
  insertHeldRow?: HeldOrder
  heldRows?: HeldOrder[]
  rpc?: Record<string, RpcResult>
  txRow?: Record<string, unknown> | null
  txItems?: { name: string; qty: number; price: number }[]
  txPays?: { method: string; amount: number }[]
}): SupabaseClient & { calls: { table?: string; op?: string; payload?: unknown; rpc?: string; args?: unknown }[] } {
  const calls: { table?: string; op?: string; payload?: unknown; rpc?: string; args?: unknown }[] = []
  const builder = (table: string) => {
    const q: Record<string, unknown> = { __table: table, eqs: [] as [string, unknown][] }
    q.select = () => q
    q.eq = (c: string, v: unknown) => {
      ;(q.eqs as [string, unknown][]).push([c, v])
      return q
    }
    q.limit = () => q
    q.order = () => q
    q.maybeSingle = () => q
    q.single = () => q
    q.insert = (payload: unknown) => {
      calls.push({ table, op: 'insert', payload })
      return q
    }
    q.then = (res: (v: unknown) => void, rej?: (e: unknown) => void) => {
      let out: RpcResult
      if (table === 'shifts') out = { data: cfg.openShift?.[0] ?? null, error: null } // maybeSingle -> objek tunggal
      else if (table === 'held_orders') out = cfg.insertHeldRow ? { data: cfg.insertHeldRow, error: null } : { data: cfg.heldRows ?? [], error: null }
      else if (table === 'transactions') out = { data: cfg.txRow ?? null, error: cfg.txRow ? null : { message: 'tx tidak ditemukan' } }
      else if (table === 'transaction_items') out = { data: cfg.txItems ?? [], error: null }
      else if (table === 'payments') out = { data: cfg.txPays ?? [], error: null }
      else out = { data: null, error: { message: `tabel tak dikenal: ${table}` } }
      calls.push({ table, op: 'select' })
      return Promise.resolve(out).then(res, rej)
    }
    return q
  }
  const sb = {
    calls,
    from: (table: string) => builder(table),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ rpc: fn, args })
      const r = cfg.rpc?.[fn] ?? { data: null, error: null }
      if (r.error) throw new Error(r.error.message)
      return r
    },
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) }
  }
  return sb as unknown as SupabaseClient & typeof sb
}

const heldRow: HeldOrder = {
  id: 7,
  shift_id: 1,
  user_id: 'user-1',
  order_type: 'dinein',
  items: [{ product_id: 27, name: 'Teh Botol Sosro', qty: 1, price: 5000 }],
  subtotal: 5000,
  discount: 0,
  total: 5000,
  note: null,
  label: 'Meja 2',
  created_at: '2026-09-13T10:00:00.000Z'
}

describe('live: simpan bill', () => {
  it('insert ke held_orders dengan shift aktif + user login', async () => {
    const row = { ...heldRow }
    const sb = makeSb({ openShift: [{ id: 1 }], insertHeldRow: row })
    const out = await liveSaveHeldOrder(sb, {
      orderType: 'dinein',
      items: row.items,
      subtotal: 5000,
      discount: 0,
      total: 5000,
      note: null,
      label: 'Meja 2'
    })
    expect(out.id).toBe(7)
    const ins = sb.calls.find((c) => c.op === 'insert')
    expect(ins?.table).toBe('held_orders')
    expect(ins?.payload).toMatchObject({ shift_id: 1, user_id: 'user-1', order_type: 'dinein', total: 5000, label: 'Meja 2' })
  })

  it('tanpa shift aktif -> ditolak sebelum insert', async () => {
    const sb = makeSb({ openShift: null })
    await expect(
      liveSaveHeldOrder(sb, { orderType: 'dinein', items: [], subtotal: 0, discount: 0, total: 0, note: null, label: null })
    ).rejects.toThrow(/Buka shift dulu/)
    expect(sb.calls.some((c) => c.op === 'insert')).toBe(false)
  })
})

describe('live: bayar bill via RPC', () => {
  it('memanggil pay_held_order dgn parameter benar & menyusun TxResult', async () => {
    const sb = makeSb({
      rpc: { pay_held_order: { data: { id: 55 } } },
      txRow: { receipt_no: 'SB260913-0055', subtotal: 5000, discount: 0, total: 5000, channel_fee: 0, order_type: 'dinein', created_at: '2026-09-13T10:05:00Z' },
      txItems: [{ name: 'Teh Botol Sosro', qty: 1, price: 5000 }],
      txPays: [{ method: 'cash', amount: 5000 }]
    })
    const tx = await livePayHeldOrder(sb, 7, 'cash', 5000)
    const call = sb.calls.find((c) => c.rpc === 'pay_held_order')
    expect(call?.args).toMatchObject({ p_held_id: 7, p_method: 'cash', p_amount: 5000, p_discount: null })
    expect(tx).toMatchObject({ id: 55, receipt_no: 'SB260913-0055', total: 5000 })
    expect(tx.items).toHaveLength(1)
    expect(tx.payments).toEqual([{ method: 'cash', amount: 5000 }])
  })

  it('error RPC dilempar dengan pesan asli', async () => {
    const sb = makeSb({ rpc: { pay_held_order: { error: { message: 'Bill tidak ditemukan (mungkin sudah dibayar)' } } } })
    await expect(livePayHeldOrder(sb, 7, 'cash', 5000)).rejects.toThrow(/tidak ditemukan/)
  })

  it('diskon revisi dikirim sebagai p_discount', async () => {
    const sb = makeSb({
      rpc: { pay_held_order: { data: { id: 1 } } },
      txRow: { receipt_no: 'SB1', subtotal: 10000, discount: 1000, total: 9000, channel_fee: 0, order_type: 'dinein', created_at: 'x' },
      txItems: [],
      txPays: [{ method: 'cash', amount: 9000 }]
    })
    await livePayHeldOrder(sb, 7, 'cash', 9000, 1000)
    expect(sb.calls.find((c) => c.rpc === 'pay_held_order')?.args).toMatchObject({ p_discount: 1000 })
  })
})

describe('live: void & load', () => {
  it('void memanggil void_held_order dgn id bill', async () => {
    const sb = makeSb({ rpc: { void_held_order: { data: null } } })
    await liveVoidHeldOrder(sb, 7)
    expect(sb.calls.find((c) => c.rpc === 'void_held_order')?.args).toMatchObject({ p_held_id: 7 })
  })

  it('load mengurutkan dari server dan mengembalikan daftar', async () => {
    const sb = makeSb({ heldRows: [heldRow] })
    const rows = await liveLoadHeldOrders(sb)
    expect(rows).toHaveLength(1)
    expect(rows[0].label).toBe('Meja 2')
  })
})
