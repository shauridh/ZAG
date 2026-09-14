// Lapisan data: satu API untuk dua mode — FACADE.
// - Mode Supabase: kueri & RPC ke Postgres (produksi)  -> adapter db-live.ts
// - Mode Demo (tanpa env Supabase): logika yang sama dijalankan lokal
//   di localStorage supaya aplikasi bisa dipakai/dites tanpa server
//   -> adapter db-demo.ts
// Aturan bisnis hanya ada satu sumber: RPC di supabase/migrations untuk
// produksi; mode demo meniru aturan yang sama dan dites oleh unit test.
// File ini hanya memilih adapter — tidak ada logika bisnis di sini.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { HeldOrder, OrderType, Settings, Shift, Transaction } from './types'
import { endOfDayReport } from './reports'
import { type Catalog, type TxResult, type SessionInfo, type RefundResult, type PortalAddress, currentOnline, setOnline, emit, onSyncStateChange, txIsEditable, TX_STATUS_LABEL, MENU_BUCKET, requireOwnerPin, hashPin } from './db-shared'
import * as demo from './db-demo'
import * as live from './db-live'

export const isDemo = !import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
export const sb: SupabaseClient | null = isDemo
  ? null
  : createClient(SUPABASE_URL!, SUPABASE_KEY!, { realtime: { params: { eventsPerSecond: 5 } } })

// Kontrak & tipe yang sebelumnya hidup di file ini — API tidak berubah.
export type { Catalog, TxResult, SessionInfo, RefundResult, PortalAddress, HeldOrder }
export type { PortalOrderT } from './db-shared'
export { currentOnline, onSyncStateChange, txIsEditable, TX_STATUS_LABEL, MENU_BUCKET }
export { queueCount, QUEUE_EVENT } from './offline'
export { resetDemoData } from './db-demo'

type ShiftReport = { cash_sales: number; expected_cash: number; cash_diff: number; opening_cash: number; cash_in?: number; cash_out?: number }

// ================= Katalog & settings =================

export async function loadCatalog(): Promise<Catalog> {
  if (isDemo) return demo.demoLoadCatalog()
  return live.liveLoadCatalog(sb!, currentOnline())
}

export async function loadSettings(): Promise<Settings> {
  if (isDemo) return demo.demoLoadSettings()
  return live.liveLoadSettings(sb!, currentOnline())
}

export async function saveSetting(key: string, value: unknown): Promise<void> {
  if (isDemo) return demo.demoSaveSetting(key, value)
  return live.liveSaveSetting(sb!, key, value)
}

// ================= Auth =================

export async function signIn(email: string, password: string): Promise<SessionInfo> {
  if (isDemo) return demo.demoSignIn(email, password)
  return live.liveSignIn(sb!, email, password)
}

export async function signOut(): Promise<void> {
  if (isDemo) return demo.demoSignOut()
  return live.liveSignOut(sb!)
}

export async function currentSession(): Promise<SessionInfo | null> {
  if (isDemo) return demo.demoCurrentSession()
  return live.liveCurrentSession(sb!)
}

// ================= Transaksi kasir =================

/**
 * Simpan transaksi.
 * Online: RPC langsung ke server.
 * Offline: masuk antrean localStorage (dengan data struk provisional),
 * otomatis dikirim ulang oleh flushQueue() saat koneksi kembali.
 */
export async function createTx(p: {
  orderType: OrderType
  items: { product_id: number; qty: number }[]
  payments: { method: 'cash' | 'qris' | 'transfer'; amount: number }[]
  discount?: number
  note?: string
  /** utk offline: tampilan struk sementara (nama + harga dr keranjang) */
  itemsDisplay?: { name: string; qty: number; price: number }[]
}): Promise<TxResult> {
  if (isDemo) return demo.demoCreateTx(p)
  return live.liveCreateTx(sb!, currentOnline(), p)
}

// ================= Simpan pesanan / bill (pembayaran nanti) =================

export async function saveHeldOrder(p: {
  orderType: OrderType
  items: { product_id: number; name: string; qty: number; price: number }[]
  subtotal: number
  discount: number
  total: number
  note: string | null
  label: string | null
}): Promise<HeldOrder> {
  if (isDemo) return demo.demoSaveHeldOrder(p)
  return live.liveSaveHeldOrder(sb!, p)
}

export async function loadHeldOrders(): Promise<HeldOrder[]> {
  if (isDemo) return demo.demoLoadHeldOrders()
  return live.liveLoadHeldOrders(sb!)
}

/** Bayar bill: stok dipotong di sini (bukan saat disimpan); bill dihapus atomik. */
export async function payHeldOrder(
  heldId: number,
  method: 'cash' | 'qris' | 'transfer',
  amount: number,
  discountOverride?: number
): Promise<TxResult> {
  if (isDemo) return demo.demoPayHeldOrder(heldId, method, amount, discountOverride)
  return live.livePayHeldOrder(sb!, heldId, method, amount, discountOverride)
}

/** Void bill: batal tanpa jadi transaksi, stok tidak tersentuh. */
export async function voidHeldOrder(heldId: number): Promise<void> {
  if (isDemo) return demo.demoVoidHeldOrder(heldId)
  return live.liveVoidHeldOrder(sb!, heldId)
}

// ================= Riwayat transaksi: ubah, hapus, refund =================

/** Refund: uang kembali, stok kembali, nota asli berstatus 'refund'. Wajib PIN owner. */
export async function refundTx(txId: number, reason: string, ownerPin: string): Promise<RefundResult> {
  requireOwnerPin(ownerPin)
  if (isDemo) return demo.demoRefundTx(txId, reason, ownerPin)
  return live.liveRefundTx(sb!, txId, reason, ownerPin)
}

/** Hapus (batal): salah input, tanpa pergerakan uang, stok kembali. Wajib PIN owner. */
export async function deleteTx(txId: number, reason: string, ownerPin: string): Promise<void> {
  requireOwnerPin(ownerPin)
  if (isDemo) return demo.demoDeleteTx(txId, reason, ownerPin)
  return live.liveDeleteTx(sb!, txId, reason, ownerPin)
}

/**
 * Edit: nota lama jadi 'direvisi', nota baru diterbitkan dengan item & diskon
 * baru. Pembayaran lama dipakai ulang, jadi total baru tidak boleh melebihi
 * yang sudah dibayar (dicek di RPC; demo meniru aturan yang sama).
 */
export async function editTx(txId: number, items: { product_id: number; qty: number }[], discount: number, note: string): Promise<number> {
  if (isDemo) return demo.demoEditTx(txId, items, discount, note)
  return live.liveEditTx(sb!, txId, items, discount, note)
}

// ================= Sinkronisasi antrean offline =================

let flushing = false

/**
 * Kirim semua transaksi tertahan ke server (FIFO).
 * Dipanggil otomatis saat koneksi kembali, saat app dibuka, dan berkala.
 * Return: jumlah transaksi yang berhasil tersinkron.
 */
export async function flushQueue(): Promise<number> {
  if (isDemo || flushing || !currentOnline()) return 0
  flushing = true
  try {
    return await live.liveFlushQueue(sb!)
  } finally {
    flushing = false
  }
}

/**
 * Pasang listener online/offline + sinkron berkala.
 * Panggil sekali di main.tsx. Return: fungsi cleanup.
 */
export function initSync(): () => void {
  const goOnline = async (): Promise<void> => {
    const was = currentOnline()
    setOnline(true)
    if (!was) emit()
    await flushQueue()
  }
  const goOffline = (): void => {
    setOnline(false)
    emit()
  }
  window.addEventListener('online', goOnline)
  window.addEventListener('offline', goOffline)
  const iv = window.setInterval(() => void flushQueue(), 30_000)
  void flushQueue() // saat app dibuka, segera kirim sisa antrean
  return () => {
    window.removeEventListener('online', goOnline)
    window.removeEventListener('offline', goOffline)
    window.clearInterval(iv)
  }
}

// ================= Shift =================

export async function openShift(openingCash: number): Promise<number> {
  if (isDemo) return demo.demoOpenShift(openingCash)
  return live.liveOpenShift(sb!, openingCash)
}

export async function closeShift(closingCash: number, note: string): Promise<ShiftReport> {
  if (isDemo) {
    const rep = demo.demoCloseShift(closingCash, note)
    await maybeEmailShiftReport(demo.demoLoadSettings(), 0, rep)
    return rep
  }
  const rep = await live.liveCloseShift(sb!, closingCash, note)
  await maybeEmailShiftReport(null, 0, rep)
  return rep
}

/** Uang non-penjualan masuk/keluar drawer (modal disetor, belanja mendadak). */
export async function shiftCashMovement(direction: 'in' | 'out', amount: number, note: string): Promise<void> {
  if (isDemo) return demo.demoShiftCashMovement(direction, amount, note)
  return live.liveShiftCashMovement(sb!, direction, amount, note)
}

/** Owner menetapkan/mengganti PIN (disimpan ter-hash; nilainya tidak pernah balik ke client). */
export async function setOwnerPin(pin: string): Promise<void> {
  const p = pin.trim()
  if (p.length < 4 || !/^\d{4,}$/.test(p)) throw new Error('PIN minimal 4 digit angka')
  if (isDemo) return demo.demoSetOwnerPin(p)
  return live.liveSetOwnerPin(sb!, p)
}

/** Cek PIN owner tanpa mengubah apa pun — dipakai membuka kunci aksi sensitif. */
export async function verifyOwnerPin(pin: string): Promise<boolean> {
  const p = pin.trim()
  if (!/^\d{4,}$/.test(p)) return false
  if (isDemo) {
    const s = demo.demoLoadSettings()
    if (!s.owner_pin_set || !s.owner_pin_hash) return false
    return (await hashPin(p)) === s.owner_pin_hash
  }
  const { data, error } = await sb!.rpc('check_owner_pin', { p_pin: p })
  if (error) return false
  return data === true
}

/** Demo: unduhan HTML; live: edge function email. Perilaku sama dengan sebelum pemisahan. */
async function maybeEmailShiftReport(demoSettings: Settings | null, shiftId: number, rep: ShiftReport): Promise<void> {
  const settings = demoSettings ?? (await loadSettings())
  const email = settings.owner_email.email
  if (!email) return
  if (isDemo) {
    // Mode demo: simpan sebagai unduhan HTML, tidak mengirim sungguhan
    const html = `<h2>Laporan Tutup Shift (demo)</h2><p>Modal awal: ${rep.opening_cash.toLocaleString('id-ID')}</p><p>Penjualan tunai: ${rep.cash_sales.toLocaleString('id-ID')}</p><p>Seharusnya di drawer: ${rep.expected_cash.toLocaleString('id-ID')}</p><p>Selisih: ${rep.cash_diff.toLocaleString('id-ID')}</p>`
    const blob = new Blob([html], { type: 'text/html' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'laporan-shift-demo.html'
    a.click()
    return
  }
  await live.liveEmailShiftReport(sb!, shiftId, rep, email, settings)
}

/**
 * Laporan lengkap sebuah shift: total metode bayar, HPP, laba kotor, item.
 * Dipakai laporan tutup shift (email otomatis + WhatsApp).
 */
export async function shiftEndOfDay(shiftId: number, settings: Settings): Promise<{ txs: Transaction[]; rep: ReturnType<typeof endOfDayReport> }> {
  const shift = (await loadShifts()).find((s) => s.id === shiftId)
  if (!shift) throw new Error('Shift tidak ditemukan')
  const txs = await loadTransactions(shift.opened_at, shift.closed_at ?? new Date().toISOString())
  const inShift = txs.filter((t) => t.shift_id === shiftId || (t.shift_id === null && (t.payments ?? []).length === 0))
  return { txs: inShift, rep: endOfDayReport(inShift, settings.channels) }
}

export async function currentShift(): Promise<Shift | null> {
  if (isDemo) return demo.demoCurrentShift()
  return live.liveCurrentShift(sb!, currentOnline())
}

// ================= Pembelian, produksi, fryer =================

export async function createPurchase(lines: { ingredient_id: number; packs: number; unit_cost: number }[], note: string): Promise<void> {
  if (isDemo) return demo.demoCreatePurchase(lines)
  return live.liveCreatePurchase(sb!, lines, note)
}

export async function createBatch(p: { outputs: { ingredient_id: number; qty: number }[]; fryer_id: number | null; fried_grams: number; note: string }): Promise<void> {
  if (isDemo) return demo.demoCreateBatch(p)
  return live.liveCreateBatch(sb!, p)
}

export async function fillFryer(fryerId: number, oilIngredientId: number, liters: number): Promise<void> {
  if (isDemo) return demo.demoFillFryer(fryerId, oilIngredientId, liters)
  return live.liveFillFryer(sb!, fryerId, oilIngredientId, liters)
}

export async function endOilCycle(cycleId: number, disposedLiters: number, jelantahIncome: number): Promise<void> {
  if (isDemo) return demo.demoEndOilCycle(cycleId, disposedLiters, jelantahIncome)
  return live.liveEndOilCycle(sb!, cycleId, disposedLiters, jelantahIncome)
}

export async function loadFryers(): Promise<{ fryers: import('./types').Fryer[]; cycles: import('./types').OilCycle[] }> {
  if (isDemo) return demo.demoLoadFryers()
  return live.liveLoadFryers(sb!)
}

export async function saveFryer(f: { id?: number; name: string; capacity_l: number | null }): Promise<void> {
  if (isDemo) return demo.demoSaveFryer(f)
  return live.liveSaveFryer(sb!, f)
}

// ================= Waste & opname =================

export async function logWaste(lines: ({ ingredient_id: number; qty: number } | { product_id: number; qty: number })[], note: string): Promise<void> {
  if (isDemo) return demo.demoLogWaste(lines)
  return live.liveLogWaste(sb!, lines, note)
}

export async function opname(ingredientId: number, actualQty: number): Promise<void> {
  if (isDemo) return demo.demoOpname(ingredientId, actualQty)
  return live.liveOpname(sb!, ingredientId, actualQty)
}

// ================= Laporan =================

/**
 * Muat transaksi dalam rentang waktu.
 * Default: nota direvisi & batal tidak ikut (uang/stoknya kini menempel di
 * nota revisinya), nota refund tetap ikut (total negatif) supaya semua
 * laporan menghitung uang kembali otomatis. Riwayat transaksi memakai
 * allStatus supaya bisa menampilkan jejak lengkapnya.
 */
export async function loadTransactions(fromISO: string, toISO: string, allStatus = false): Promise<Transaction[]> {
  if (isDemo) return demo.demoLoadTransactions(fromISO, toISO, allStatus)
  return live.liveLoadTransactions(sb!, fromISO, toISO, allStatus)
}

export async function loadShifts(): Promise<Shift[]> {
  if (isDemo) return demo.demoLoadShifts()
  return live.liveLoadShifts(sb!)
}

export async function loadFinance(fromISO: string, toISO: string): Promise<{ expenses: import('./types').Expense[]; expenseCats: import('./types').ExpenseCategory[]; otherIncome: import('./types').OtherIncome[] }> {
  if (isDemo) return demo.demoLoadFinance(fromISO, toISO)
  return live.liveLoadFinance(sb!, fromISO, toISO)
}

export async function addExpense(categoryId: number | null, amount: number, note: string): Promise<void> {
  if (isDemo) return demo.demoAddExpense(categoryId, amount, note)
  return live.liveAddExpense(sb!, categoryId, amount, note)
}

export async function addOtherIncome(source: string, amount: number, note: string): Promise<void> {
  if (isDemo) return demo.demoAddOtherIncome(source, amount, note)
  return live.liveAddOtherIncome(sb!, source, amount, note)
}

// ================= Foto menu =================

/**
 * Upload foto menu. Live: bucket publik 'menu-photos' (nama file timestamp
 * supaya URL baru tidak ter-cache). Demo: blob tak bisa disimpan di
 * localStorage -> data URL.
 */
export async function uploadProductPhoto(blob: Blob, ext = 'jpg'): Promise<{ url: string; path: string }> {
  if (isDemo) return demo.demoUploadProductPhoto(blob, ext)
  return live.liveUploadProductPhoto(sb!, blob, ext)
}

/** Hapus objek foto dari Storage (demo: tidak ada yang dihapus). */
export async function removeProductPhoto(photoUrl: string | null | undefined): Promise<void> {
  if (isDemo) return
  return live.liveRemoveProductPhoto(sb!, photoUrl)
}

// ================= Master CRUD (admin) =================

export async function upsertProduct(p: { id?: number; name: string; category_id: number | null; price: number; unit: import('./types').Product['unit']; is_active: boolean; sort: number; photo?: string | null }): Promise<void> {
  if (isDemo) return demo.demoUpsertProduct(p)
  return live.liveUpsertProduct(sb!, p)
}

export async function upsertCategory(c: { id?: number; name: string; sort: number }): Promise<void> {
  if (isDemo) return demo.demoUpsertCategory(c)
  return live.liveUpsertCategory(sb!, c)
}

export async function upsertIngredient(i: { id?: number; name: string; code: string | null; kind: 'raw' | 'prepared'; buy_unit: string; small_unit?: string | null; pack_content: number; price: number; min_stock: number; active: boolean }): Promise<void> {
  if (isDemo) return demo.demoUpsertIngredient(i)
  return live.liveUpsertIngredient(sb!, i)
}

/** Hapus master: server menolak bila masih terpakai (riwayat/resep/paket). */
export async function deleteProduct(id: number): Promise<void> {
  if (isDemo) return demo.demoDeleteProduct(id)
  return live.liveDeleteProduct(sb!, id)
}

export async function deleteIngredient(id: number): Promise<void> {
  if (isDemo) return demo.demoDeleteIngredient(id)
  return live.liveDeleteIngredient(sb!, id)
}

// ================= Impor price list & reset mulai dari nol =================

export interface PriceListItem {
  code: string
  name: string
  buy_unit: string
  pack_content: number
  /** Harga per 1 kemasan utuh (ala price list supplier). */
  pack_price: number
  /** Satuan kecil hasil konversi isi kemasan (mis. 'potong', 'gram', 'pcs'); boleh ''. */
  small_unit: string
}

/**
 * Impor/sinkron daftar harga supplier (Price List Sabana Sharing Mitra).
 * Upsert per kode barang; created/updated dikembalikan utk pesan hasil.
 * replace=true: master dibersihkan dulu (hanya dari halaman Bahan, wajib konfirmasi).
 */
export async function importPriceList(items: PriceListItem[], replace = false): Promise<{ created: number; updated: number }> {
  if (isDemo) return demo.demoImportPriceList(items, replace)
  return live.liveImportPriceList(sb!, items, replace)
}

/**
 * Reset TOTAL: kosongkan semua data operasional + master (transaksi, shift,
 * stok, bahan, menu, dst) supaya produksi mulai dari nol. Pengaturan toko
 * & sesi login tidak tersentuh. Wajib konfirmasi ganda di UI.
 */
export async function resetOperationalData(): Promise<void> {
  if (isDemo) return demo.demoResetOperationalData()
  return live.liveResetOperationalData(sb!)
}

/** Hapus PIN owner (lupa PIN) — hanya admin, lalu set ulang dari Keuangan. */
export async function clearOwnerPin(): Promise<void> {
  if (isDemo) return demo.demoClearOwnerPin()
  return live.liveClearOwnerPin(sb!)
}

export async function saveRecipe(productId: number, lines: { kind: 'ingredient' | 'product'; component_id: number; qty: number }[]): Promise<void> {
  if (isDemo) return demo.demoSaveRecipe(productId, lines)
  return live.liveSaveRecipe(sb!, productId, lines)
}

export async function saveIngredientRecipe(ingredientId: number, lines: { component_id: number; qty: number }[]): Promise<void> {
  if (isDemo) return demo.demoSaveIngredientRecipe(ingredientId, lines)
  return live.liveSaveIngredientRecipe(sb!, ingredientId, lines)
}

export async function saveTargets(targets: { product_id: number; qty: number }[]): Promise<void> {
  if (isDemo) return demo.demoSaveTargets(targets)
  return live.liveSaveTargets(sb!, targets)
}

export async function loadZones(): Promise<{ zones: import('./types').DeliveryZone[]; outlet: import('./types').OutletSetting }> {
  if (isDemo) return demo.demoLoadZones()
  return live.liveLoadZones(sb!)
}

export async function saveZones(zones: { radius_km: number; fee: number }[], outlet: import('./types').OutletSetting): Promise<void> {
  if (isDemo) return demo.demoSaveZones(zones, outlet)
  return live.liveSaveZones(sb!, zones, outlet)
}

// ================= Pesanan portal =================

export async function loadPortalOrders(): Promise<import('./types').PortalOrder[]> {
  if (isDemo) return demo.demoLoadPortalOrders()
  return live.liveLoadPortalOrders(sb!)
}

export async function acceptOrder(id: number): Promise<void> {
  if (isDemo) return demo.demoAcceptOrder(id)
  return live.liveAcceptOrder(sb!, id)
}

export async function rejectOrder(id: number, reason: string): Promise<void> {
  if (isDemo) return demo.demoRejectOrder(id, reason)
  return live.liveRejectOrder(sb!, id, reason)
}

/** Tolak pesanan, termasuk yang sudah bayar tapi belum diverifikasi (belum potong stok). */
export async function rejectPaidOrder(id: number, reason: string): Promise<void> {
  if (isDemo) return demo.demoRejectPaidOrder(id, reason)
  return live.liveRejectOrder(sb!, id, reason)
}

export async function verifyOrderPayment(id: number): Promise<void> {
  if (isDemo) return demo.demoVerifyOrderPayment(id)
  return live.liveVerifyOrderPayment(sb!, id)
}

export async function setOrderStatus(id: number, status: import('./types').PortalOrder['status']): Promise<void> {
  if (isDemo) return demo.demoSetOrderStatus(id, status)
  return live.liveSetOrderStatus(sb!, id, status)
}

// ================= Paket bundling =================

export async function saveBundle(b: { id?: number; name: string; price: number; is_active: boolean }): Promise<void> {
  if (isDemo) return demo.demoSaveBundle(b)
  return live.liveSaveBundle(sb!, b)
}

export async function saveBundleItems(bundleId: number, items: { product_id: number; qty: number }[]): Promise<void> {
  if (isDemo) return demo.demoSaveBundleItems(bundleId, items)
  return live.liveSaveBundleItems(sb!, bundleId, items)
}

export async function deleteBundle(id: number): Promise<void> {
  if (isDemo) return demo.demoDeleteBundle(id)
  return live.liveDeleteBundle(sb!, id)
}

// ================= API portal customer =================

export const portal = {
  async register(phone: string, name: string, pin: string): Promise<{ token: string; name: string }> {
    if (isDemo) return demo.demoPortal.register(phone, name, pin)
    return live.livePortal.register(sb!, phone, name, pin)
  },
  async login(phone: string, pin: string): Promise<{ token: string; name: string }> {
    if (isDemo) return demo.demoPortal.login(phone, pin)
    return live.livePortal.login(sb!, phone, pin)
  },
  async profile(token: string): Promise<{ phone: string; name: string; address: string; label: string }> {
    if (isDemo) return demo.demoPortal.profile(token)
    return live.livePortal.profile(sb!, token)
  },
  async updateProfile(token: string, name: string, address: string): Promise<void> {
    if (isDemo) return demo.demoPortal.updateProfile(token, name, address)
    return live.livePortal.updateProfile(sb!, token, name, address)
  },
  async changePin(token: string, oldPin: string, newPin: string): Promise<void> {
    if (isDemo) return demo.demoPortal.changePin(token, oldPin, newPin)
    return live.livePortal.changePin(sb!, token, oldPin, newPin)
  },
  async listAddresses(token: string): Promise<PortalAddress[]> {
    if (isDemo) return demo.demoPortal.listAddresses(token)
    return live.livePortal.listAddresses(sb!, token)
  },
  async saveAddress(token: string, id: number | null, label: string, address: string, lat: number | null, lng: number | null): Promise<number> {
    if (isDemo) return demo.demoPortal.saveAddress(token, id, label, address, lat, lng)
    return live.livePortal.saveAddress(sb!, token, id, label, address, lat, lng)
  },
  async deleteAddress(token: string, id: number): Promise<void> {
    if (isDemo) return demo.demoPortal.deleteAddress()
    return live.livePortal.deleteAddress(sb!, token, id)
  },
  async availability(): Promise<Map<number, number>> {
    if (isDemo) return demo.demoPortal.availability()
    return live.livePortal.availability(sb!)
  },
  async createOrder(token: string, items: { product_id: number; qty: number }[], addressId: number, note: string): Promise<number> {
    if (isDemo) return demo.demoPortal.createOrder(token, items, addressId, note)
    return live.livePortal.createOrder(sb!, token, items, addressId, note)
  },
  async orders(token: string): Promise<import('./types').PortalOrder[]> {
    if (isDemo) return demo.demoPortal.orders(token)
    return live.livePortal.orders(sb!, token)
  },
  async confirmPaid(token: string, orderId: number): Promise<void> {
    if (isDemo) return demo.demoPortal.confirmPaid(token, orderId)
    return live.livePortal.confirmPaid(sb!, token, orderId)
  },
  async cancelOrder(token: string, orderId: number): Promise<void> {
    if (isDemo) return demo.demoPortal.cancelOrder(token, orderId)
    return live.livePortal.cancelOrder(sb!, token, orderId)
  }
}

export function subscribeOrders(cb: () => void): () => void {
  if (isDemo) return demo.demoSubscribeOrders(cb)
  return live.liveSubscribeOrders(sb!, cb)
}
