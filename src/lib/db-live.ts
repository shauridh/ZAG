// Adapter SUPABASE lapisan data: kueri & RPC ke Postgres (produksi).
// Aturan bisnis hanya ada satu sumber: RPC di supabase/migrations — adapter
// ini hanya mengirim parameter dan membaca hasil.

import type {
  Bundle,
  Category,
  DeliveryZone,
  Expense,
  ExpenseCategory,
  HeldOrder,
  Fryer,
  Ingredient,
  IngredientRecipe,
  OilCycle,
  OrderType,
  OtherIncome,
  OutletSetting,
  PortalOrder,
  Product,
  RecipeItem,
  Settings,
  Shift,
  Transaction
} from './types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { recipeIndexBy, ingRecipeIndexBy } from './hpp'
import { ensureAdminWrite } from './supabase-guard'
import { endOfDayReport } from './reports'
import { isNetworkError, enqueueTx, type QueuedTx } from './offline'
import { type Catalog, type TxResult, type SessionInfo, cachePut, cacheGet, err, MENU_BUCKET } from './db-shared'

type Sb = SupabaseClient

// ================= Katalog & settings (live) =================

export async function liveLoadCatalog(sb: Sb, online: boolean): Promise<Catalog> {
  if (!online) {
    const c = cacheCatalogGet()
    if (c) return c
  }
  try {
    return await loadCatalogLive(sb)
  } catch (ex) {
    if (isNetworkError(ex)) {
      const c = cacheCatalogGet()
      if (c) return c
      throw new Error('Belum ada data tersimpan untuk mode offline. Sambungkan internet sekali untuk memuat menu.')
    }
    throw ex
  }
}

async function loadCatalogLive(sbx: Sb): Promise<Catalog> {
  const [cats, prods, ings, bunds, recipes, irecipes, targets] = await Promise.all([
    sbx.from('categories').select('*').order('sort'),
    sbx.from('products').select('*').order('sort'),
    sbx.from('ingredients').select('*').order('name'),
    sbx.from('bundles').select('*, bundle_items(product_id, qty)'),
    sbx.from('recipe_items').select('*'),
    sbx.from('ingredient_recipes').select('*'),
    sbx.from('daily_targets').select('*')
  ])
  const fail = [cats, prods, ings, bunds, recipes, irecipes, targets].find((r) => r.error)
  if (fail?.error) throw new Error(fail.error.message)
  const catalog: Catalog = {
    categories: (cats.data ?? []) as Category[],
    products: (prods.data ?? []) as Product[],
    ingredients: (ings.data ?? []) as Ingredient[],
    bundles: (bunds.data ?? []) as Bundle[],
    recipeByProduct: recipeIndexBy((recipes.data ?? []) as RecipeItem[]),
    ingRecipes: ingRecipeIndexBy((irecipes.data ?? []) as IngredientRecipe[]),
    targets: new Map(((targets.data ?? []) as { product_id: number; qty: number }[]).map((t) => [t.product_id, t.qty]))
  }
  cacheCatalogPut(catalog)
  return catalog
}

/** Katalog punya Map — serialisasi manual supaya bisa dihidupkan lagi saat offline. */
function cacheCatalogPut(c: Catalog): void {
  cachePut('sabana-cache-catalog', {
    categories: c.categories,
    products: c.products,
    ingredients: c.ingredients,
    bundles: c.bundles,
    recipeByProduct: [...c.recipeByProduct.entries()],
    ingRecipes: [...c.ingRecipes.entries()],
    targets: [...c.targets.entries()]
  })
}
function cacheCatalogGet(): Catalog | null {
  const raw = cacheGet<{
    categories: Category[]
    products: Product[]
    ingredients: Ingredient[]
    bundles: Bundle[]
    recipeByProduct: [number, RecipeItem[]][]
    ingRecipes: [number, IngredientRecipe[]][]
    targets: [number, number][]
  }>('sabana-cache-catalog')
  // Validasi ketat: cache lama/rusak (mis. hasil format sebelum serialisasi Map)
  // harus diabaikan, bukan dikembalikan sebagai objek rusak yang bikin crash.
  if (!raw || !Array.isArray(raw.recipeByProduct) || !Array.isArray(raw.ingRecipes) || !Array.isArray(raw.targets)) return null
  if (!Array.isArray(raw.products) || !Array.isArray(raw.ingredients)) return null
  return {
    categories: raw.categories,
    products: raw.products,
    ingredients: raw.ingredients,
    bundles: raw.bundles,
    recipeByProduct: new Map(raw.recipeByProduct),
    ingRecipes: new Map(raw.ingRecipes),
    targets: new Map(raw.targets)
  }
}

function defaultSettingsShape(): Settings {
  // Nilai default hanya dipakai sebagai fallback merge per-field untuk data
  // lama di DB yang belum punya grup setting tertentu.
  return {
    store: { name: 'Sabana Drieischicken', tagline: 'Drieischicken POS', address: 'Jl. Kebun Sayur No. 1', phone: '', footer: 'Terima kasih, datang kembali!' },
    shift: { float_cash: 350000 },
    channels: { gofood: { fee: 10 }, grabfood: { fee: 10 }, shopeefood: { fee: 10 } },
    oil: { max_days: 3, max_fry_count: 60 },
    margin: { warn_pct: 15 },
    receipt: { width_mm: 58, show_cashier: true, show_channel: true, header: 'Sabana Drieischicken', footer: 'Terima kasih, datang kembali!', show_qr: false },
    qris: { image: '' },
    portal: { secret: 'demo', outlet_note: '', delivery_enabled: true, delivery_schedule: null },
    owner_email: { email: '', whatsapp: '' },
    printer: { auto_print: false, mode: 'bt' },
    tablet: { keep_awake: true, fullscreen: false, card_size: 'besar' },
    owner_pin_set: false,
    fixed_costs: []
  }
}

export async function liveLoadSettings(sb: Sb, online: boolean): Promise<Settings> {
  if (!online) {
    const c = cacheGet<Settings>('sabana-cache-settings')
    if (c) return c
  }
  const [{ data, error }, catsRes] = await Promise.all([
    sb.from('settings').select('key, value'),
    sb.rpc('get_expense_categories')
  ])
  if (error) {
    if (isNetworkError(new Error(error.message))) {
      const c = cacheGet<Settings>('sabana-cache-settings')
      if (c) return c
    }
    throw new Error(error.message)
  }
  // Kategori beban: settings → RPC fallback ke tabel seed → default kosong
  const cats = (catsRes.error ? null : (catsRes.data as { id: number; name: string }[] | null)) ?? null
  const map = new Map((data ?? []).map((r) => [r.key, r.value]))
  const demo = defaultSettingsShape()
  const s: Settings = {
    // merge per-field: data lama di DB (tanpa tagline) tetap dapat nilai default
    store: { ...demo.store, ...((map.get('store') as Partial<Settings['store']> | undefined) ?? {}) },
    shift: (map.get('shift') as Settings['shift']) ?? demo.shift,
    channels: (map.get('channels') as Settings['channels']) ?? demo.channels,
    oil: (map.get('oil') as Settings['oil']) ?? demo.oil,
    margin: (map.get('margin') as Settings['margin']) ?? demo.margin,
    receipt: (map.get('receipt') as Settings['receipt']) ?? demo.receipt,
    qris: (map.get('qris') as Settings['qris']) ?? demo.qris,
    // Setting baru: fallback per-field supaya data lama di DB (tanpa delivery_enabled) tetap on.
    // Jadwal bersifat opsional: tanpa jadwal, on/off murni mengikuti saklar manual.
    portal: {
      ...(map.get('portal') as Settings['portal'] ?? demo.portal),
      delivery_enabled: (map.get('portal') as Settings['portal'] | undefined)?.delivery_enabled ?? true,
      delivery_schedule: ((map.get('portal') as Settings['portal'] | undefined)?.delivery_schedule ?? null) as Settings['portal']['delivery_schedule']
    },
    owner_email: (map.get('owner_email') as Settings['owner_email']) ?? demo.owner_email,
    printer: (map.get('printer') as Settings['printer']) ?? demo.printer,
    tablet: (map.get('tablet') as Settings['tablet']) ?? demo.tablet,
    owner_pin_set: Boolean((map.get('owner_pin') as { pin_hash?: string } | undefined)?.pin_hash),
    expense_categories: (map.get('expense_categories') as Settings['expense_categories'] | undefined) ?? cats ?? [],
    fixed_costs: (map.get('fixed_costs') as Settings['fixed_costs']) ?? demo.fixed_costs
  }
  cachePut('sabana-cache-settings', s)
  return s
}

export async function liveSaveSetting(sb: Sb, key: string, value: unknown): Promise<void> {
  const { error } = await sb.from('settings').upsert({ key, value })
  if (error) throw new Error(error.message)
}

// ================= Auth (live) =================

export async function liveSignIn(sb: Sb, email: string, password: string): Promise<SessionInfo> {
  const { data, error } = await sb.auth.signInWithPassword({ email, password })
  if (error) err(error.message)
  const prof = await sb.from('profiles').select('name, role').eq('id', data.user!.id).maybeSingle()
  return { email, role: (prof.data?.role as 'admin' | 'kasir') ?? 'kasir', name: prof.data?.name ?? email }
}

export async function liveSignOut(sb: Sb): Promise<void> {
  await sb.auth.signOut()
}

export async function liveCurrentSession(sb: Sb): Promise<SessionInfo | null> {
  const { data } = await sb.auth.getSession()
  if (!data.session) return null
  const prof = await sb.from('profiles').select('name, role').eq('id', data.session.user.id).maybeSingle()
  return {
    email: data.session.user.email ?? '',
    role: (prof.data?.role as 'admin' | 'kasir') ?? 'kasir',
    name: prof.data?.name ?? (data.session.user.email ?? '')
  }
}

// ================= Transaksi kasir (live) =================

export function offlineTxResult(q: QueuedTx): TxResult {
  const subtotal = (q.itemsDisplay ?? []).reduce((s, l) => s + Math.round(l.qty * l.price), 0)
  const total = Math.max(0, subtotal - (q.discount ?? 0))
  const items = q.itemsDisplay ?? []
  const payments = q.orderType === 'gofood' || q.orderType === 'grabfood' || q.orderType === 'shopeefood' ? [] : q.payments
  return {
    id: -1,
    receipt_no: `OFF-${q.queuedAt.replace(/\D/g, '').slice(-8)}`,
    subtotal,
    discount: q.discount ?? 0,
    total,
    channel_fee: 0,
    order_type: q.orderType,
    created_at: q.queuedAt,
    items,
    payments
  }
}

type TxInput = {
  orderType: OrderType
  items: { product_id: number; qty: number }[]
  payments: { method: 'cash' | 'qris' | 'transfer'; amount: number }[]
  discount?: number
  note?: string
}

/** Simpan transaksi live; bila jaringan putus, masuk antrean offline. */
export async function liveCreateTx(sb: Sb, online: boolean, p: TxInput & { itemsDisplay?: { name: string; qty: number; price: number }[] }): Promise<TxResult> {
  if (!online) {
    return offlineTxResult(
      enqueueTx({ orderType: p.orderType, items: p.items, payments: p.payments, discount: p.discount, note: p.note, itemsDisplay: p.itemsDisplay })
    )
  }
  try {
    return await createTxLive(sb, p)
  } catch (ex) {
    if (isNetworkError(ex)) {
      const q = enqueueTx({ orderType: p.orderType, items: p.items, payments: p.payments, discount: p.discount, note: p.note, itemsDisplay: p.itemsDisplay })
      return offlineTxResult(q)
    }
    throw ex
  }
}

async function createTxLive(sb: Sb, p: TxInput): Promise<TxResult> {
  const { data, error } = await sb.rpc('create_transaction', {
    p_order_type: p.orderType,
    p_items: p.items,
    p_payments: p.orderType === 'gofood' || p.orderType === 'grabfood' || p.orderType === 'shopeefood' ? [] : p.payments,
    p_discount: p.discount ?? 0,
    p_note: p.note ?? null
  })
  if (error) throw new Error(error.message)
  const id = data as number
  const { data: tx } = await sb.from('transactions').select('*').eq('id', id).single()
  const { data: items } = await sb.from('transaction_items').select('name, qty, price').eq('transaction_id', id)
  const { data: pays } = await sb.from('payments').select('method, amount').eq('transaction_id', id)
  return {
    id,
    receipt_no: tx!.receipt_no,
    subtotal: tx!.subtotal,
    discount: tx!.discount,
    total: tx!.total,
    channel_fee: tx!.channel_fee,
    order_type: tx!.order_type,
    created_at: tx!.created_at,
    items: items ?? [],
    payments: pays ?? []
  }
}

/** Kirim semua transaksi tertahan ke server (FIFO). Return: jumlah yang berhasil. */
export async function liveFlushQueue(sb: Sb): Promise<number> {
  const { readQueue, removeQueued, markAttempt } = await import('./offline')
  let synced = 0
  for (const q of readQueue()) {
    try {
      await createTxLive(sb, {
        orderType: q.orderType,
        items: q.items,
        payments: q.payments,
        discount: q.discount,
        note: q.note
      })
      removeQueued(q.id)
      synced++
    } catch (ex) {
      if (isNetworkError(ex)) break // server masih tidak terjangkau — coba lagi nanti
      markAttempt(q.id, (ex as Error).message) // error bisnis: simpan pesannya, coba lagi saat berikutnya
    }
  }
  return synced
}

// ================= Riwayat: refund / batal / revisi (live) =================

export async function liveRefundTx(sb: Sb, txId: number, reason: string, ownerPin: string): Promise<{ refund_id: number; receipt_no: string; amount: number; method: string }> {
  const { data, error } = await sb.rpc('refund_transaction', { p_tx_id: txId, p_reason: reason.trim() || null, p_owner_pin: ownerPin || null })
  if (error) throw new Error(error.message)
  return data as { refund_id: number; receipt_no: string; amount: number; method: string }
}

export async function liveDeleteTx(sb: Sb, txId: number, reason: string, ownerPin: string): Promise<void> {
  const { error } = await sb.rpc('delete_transaction', { p_tx_id: txId, p_reason: reason.trim() || null, p_owner_pin: ownerPin || null })
  if (error) throw new Error(error.message)
}

export async function liveEditTx(sb: Sb, txId: number, items: { product_id: number; qty: number }[], discount: number, note: string): Promise<number> {
  const { data, error } = await sb.rpc('edit_transaction', { p_tx_id: txId, p_items: items, p_discount: discount, p_note: note.trim() || null })
  if (error) throw new Error(error.message)
  return data as number
}

// ================= Shift (live) =================

export async function liveOpenShift(sb: Sb, openingCash: number): Promise<number> {
  const { data, error } = await sb.rpc('open_shift', { p_opening_cash: openingCash })
  if (error) throw new Error(error.message)
  return data as number
}

export async function liveCloseShift(sb: Sb, closingCash: number, note: string): Promise<{ cash_sales: number; expected_cash: number; cash_diff: number; opening_cash: number; cash_in: number; cash_out: number }> {
  const { data, error } = await sb.rpc('close_shift', { p_closing_cash: closingCash, p_note: note || null })
  if (error) throw new Error(error.message)
  return data as { cash_sales: number; expected_cash: number; cash_diff: number; opening_cash: number; cash_in: number; cash_out: number }
}

/** Uang non-penjualan masuk/keluar drawer selama shift (RPC shift_cash_movement). */
export async function liveShiftCashMovement(sb: Sb, direction: 'in' | 'out', amount: number, note: string): Promise<void> {
  const { error } = await sb.rpc('shift_cash_movement', { p_direction: direction, p_amount: amount, p_note: note || null })
  if (error) throw new Error(error.message)
}

export async function liveSetOwnerPin(sb: Sb, pin: string): Promise<void> {
  const { error } = await sb.rpc('set_owner_pin', { p_pin: pin })
  if (error) throw new Error(error.message)
}

export async function liveCurrentShift(sb: Sb, online: boolean): Promise<Shift | null> {
  if (!online) return cacheGet<Shift>('sabana-cache-shift')
  const { data, error } = await sb.from('shifts').select('*').eq('status', 'buka').order('opened_at', { ascending: false }).limit(1)
  if (error) {
    if (isNetworkError(new Error(error.message))) return cacheGet<Shift>('sabana-cache-shift')
    throw new Error(error.message)
  }
  const shift = (data?.[0] as Shift) ?? null
  cachePut('sabana-cache-shift', shift)
  return shift
}

export async function liveLoadShifts(sb: Sb): Promise<Shift[]> {
  const { data, error } = await sb.from('shifts').select('*').order('opened_at', { ascending: false }).limit(60)
  if (error) throw new Error(error.message)
  return (data ?? []) as Shift[]
}

// ================= Pembelian, produksi, fryer (live) =================

export async function liveCreatePurchase(sb: Sb, lines: { ingredient_id: number; packs: number; unit_cost: number }[], note: string): Promise<void> {
  const { error } = await sb.rpc('create_purchase', { p_items: lines, p_note: note || null })
  if (error) throw new Error(error.message)
}

export async function liveCreateBatch(sb: Sb, p: { outputs: { ingredient_id: number; qty: number }[]; fryer_id: number | null; fried_grams: number; note: string }): Promise<void> {
  const { error } = await sb.rpc('create_production_batch', {
    p_outputs: p.outputs,
    p_fryer_id: p.fryer_id,
    p_fried_grams: p.fried_grams,
    p_note: p.note || null
  })
  if (error) throw new Error(error.message)
}

export async function liveFillFryer(sb: Sb, fryerId: number, oilIngredientId: number, liters: number): Promise<void> {
  const { error } = await sb.rpc('fill_fryer', { p_fryer_id: fryerId, p_oil_ingredient_id: oilIngredientId, p_liters: liters })
  if (error) throw new Error(error.message)
}

export async function liveEndOilCycle(sb: Sb, cycleId: number, disposedLiters: number, jelantahIncome: number): Promise<void> {
  const { error } = await sb.rpc('end_oil_cycle', { p_cycle_id: cycleId, p_disposed_liters: disposedLiters, p_jelantah_income: jelantahIncome })
  if (error) throw new Error(error.message)
}

export async function liveLoadFryers(sb: Sb): Promise<{ fryers: Fryer[]; cycles: OilCycle[] }> {
  const [f, c] = await Promise.all([sb.from('fryers').select('*').order('id'), sb.from('oil_cycles').select('*').order('id', { ascending: false }).limit(50)])
  if (f.error) throw new Error(f.error.message)
  return { fryers: (f.data ?? []) as Fryer[], cycles: (c.data ?? []) as OilCycle[] }
}

export async function liveSaveFryer(sb: Sb, f: { id?: number; name: string; capacity_l: number | null }): Promise<void> {
  if (f.id) {
    const { error } = await sb.from('fryers').update({ name: f.name, capacity_l: f.capacity_l }).eq('id', f.id)
    if (error) throw new Error(error.message)
  } else {
    const { error } = await sb.from('fryers').insert({ name: f.name, capacity_l: f.capacity_l })
    if (error) throw new Error(error.message)
  }
}

// ================= Waste & opname (live) =================

export async function liveLogWaste(sb: Sb, lines: ({ ingredient_id: number; qty: number } | { product_id: number; qty: number })[], note: string): Promise<void> {
  const { error } = await sb.rpc('log_waste', { p_lines: lines, p_note: note })
  if (error) throw new Error(error.message)
}

export async function liveOpname(sb: Sb, ingredientId: number, actualQty: number): Promise<void> {
  const { error } = await sb.rpc('opname_stock', { p_ingredient_id: ingredientId, p_actual_qty: actualQty, p_note: null })
  if (error) throw new Error(error.message)
}

// ================= Laporan (live) =================

/** Filter status sama dengan demo: direvisi & batal hilang, refund tetap. */
export function keepReportable(t: Transaction, allStatus = false): boolean {
  return allStatus || t.status === undefined || t.status === 'normal' || t.status === 'refund'
}

export async function liveLoadTransactions(sb: Sb, fromISO: string, toISO: string, allStatus = false): Promise<Transaction[]> {
  const { data, error } = await sb
    .from('transactions')
    .select('*, transaction_items(name, qty, price, hpp), payments(method, amount)')
    .gte('created_at', fromISO)
    .lte('created_at', toISO)
    .order('created_at')
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as Transaction[]).filter((t) => keepReportable(t, allStatus))
}

export async function liveLoadFinance(sb: Sb, fromISO: string, toISO: string): Promise<{ expenses: Expense[]; expenseCats: ExpenseCategory[]; otherIncome: OtherIncome[] }> {
  const [e, c, i, s] = await Promise.all([
    sb.from('expenses').select('*').gte('spent_at', fromISO).lte('spent_at', toISO).order('spent_at', { ascending: false }),
    sb.from('expense_categories').select('*').order('name'),
    sb.from('other_income').select('*').gte('earned_at', fromISO).lte('earned_at', toISO).order('earned_at', { ascending: false }),
    sb.from('settings').select('value').eq('key', 'expense_categories').maybeSingle()
  ])
  if (e.error) throw new Error(e.error.message)
  return {
    expenses: (e.data ?? []) as Expense[],
    // kategori dari settings (dikelola owner di Keuangan) menang; tabel seed cuma fallback
    expenseCats: ((s.data?.value as ExpenseCategory[] | undefined) ?? (c.data ?? [])) as ExpenseCategory[],
    otherIncome: (i.data ?? []) as OtherIncome[]
  }
}

export async function liveAddExpense(sb: Sb, categoryId: number | null, amount: number, note: string): Promise<void> {
  const { error } = await sb.from('expenses').insert({ category_id: categoryId, amount, note: note || null })
  if (error) throw new Error(error.message)
}

export async function liveAddOtherIncome(sb: Sb, source: string, amount: number, note: string): Promise<void> {
  const { error } = await sb.from('other_income').insert({ source, amount, note: note || null })
  if (error) throw new Error(error.message)
}

/** Hapus master via RPC: server menolak bila masih terpakai (riwayat/resep). */
export async function liveDeleteProduct(sb: Sb, id: number): Promise<void> {
  const { error } = await sb.rpc('delete_product', { p_product_id: id })
  if (error) throw new Error(error.message)
}

export async function liveDeleteIngredient(sb: Sb, id: number): Promise<void> {
  const { error } = await sb.rpc('delete_ingredient', { p_ingredient_id: id })
  if (error) throw new Error(error.message)
}

// ================= Impor price list & reset mulai dari nol (live) =================

export async function liveImportPriceList(
  sb: Sb,
  items: { code: string; name: string; buy_unit: string; pack_content: number; pack_price: number; small_unit: string }[],
  replace: boolean
): Promise<{ created: number; updated: number }> {
  const { data, error } = await sb.rpc('import_price_list', { p_items: items, p_replace: replace })
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  return { created: Number(row?.created ?? 0), updated: Number(row?.updated ?? 0) }
}

export async function liveResetOperationalData(sb: Sb): Promise<void> {
  const { error } = await sb.rpc('reset_operational_data')
  if (error) throw new Error(error.message)
}

export async function liveClearOwnerPin(sb: Sb): Promise<void> {
  const { error } = await sb.rpc('clear_owner_pin')
  if (error) throw new Error(error.message)
}

// ================= Foto menu (live: Supabase Storage) =================

export async function liveUploadProductPhoto(sb: Sb, blob: Blob, ext = 'jpg'): Promise<{ url: string; path: string }> {
  const path = `menu/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await sb.storage.from(MENU_BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    cacheControl: '31536000', // nama file selalu baru, boleh di-cache permanen
    upsert: false
  })
  if (error) throw new Error('Upload foto gagal: ' + error.message)
  const { data } = sb.storage.from(MENU_BUCKET).getPublicUrl(path)
  if (!data?.publicUrl) throw new Error('URL foto tidak tersedia setelah upload')
  return { url: data.publicUrl, path }
}

/** Hapus objek foto dari Storage (abaikan error: objek mungkin sudah tiada). */
export async function liveRemoveProductPhoto(sb: Sb, photoUrl: string | null | undefined): Promise<void> {
  if (!photoUrl) return
  const marker = `/${MENU_BUCKET}/`
  const i = photoUrl.indexOf(marker)
  if (i === -1) return // data URL lama / URL luar: tidak ada yang dihapus
  const path = photoUrl.slice(i + marker.length).split('?')[0]
  const { error } = await sb.storage.from(MENU_BUCKET).remove([path])
  if (error) console.warn('Hapus foto lama gagal (diabaikan):', error.message)
}

// ================= Master CRUD (live) =================

export async function liveUpsertProduct(sb: Sb, p: { id?: number; name: string; category_id: number | null; price: number; unit: Product['unit']; is_active: boolean; sort: number; photo?: string | null }): Promise<void> {
  // id jangan ikut di UPDATE: kolom id GENERATED ALWAYS, Postgres menolak
  // seluruh baris dengan error 428C9 kalau id dikirim (foto "tidak bisa" diubah).
  const { data, error } = await (p.id
    ? sb.from('products').update({ ...p, id: undefined }).eq('id', p.id)
    : sb.from('products').insert(p)
  ).select('id')
  if (error) throw new Error(error.message)
  // tulis master cuma boleh admin (RLS): 0 baris terdampak = ditolak diam-diam
  ensureAdminWrite(data?.length ?? 0, p.id !== undefined)
}

export async function liveUpsertCategory(sb: Sb, c: { id?: number; name: string; sort: number }): Promise<void> {
  const { data, error } = await (c.id
    ? sb.from('categories').update({ ...c, id: undefined }).eq('id', c.id)
    : sb.from('categories').insert(c)
  ).select('id')
  if (error) throw new Error(error.message)
  ensureAdminWrite(data?.length ?? 0, c.id !== undefined)
}

export async function liveUpsertIngredient(sb: Sb, i: { id?: number; name: string; code: string | null; kind: 'raw' | 'prepared'; buy_unit: string; small_unit?: string | null; pack_content: number; price: number; min_stock: number; active: boolean }): Promise<void> {
  const { data, error } = await (i.id
    ? sb.from('ingredients').update({ ...i, id: undefined }).eq('id', i.id)
    : sb.from('ingredients').insert(i)
  ).select('id')
  if (error) throw new Error(error.message)
  ensureAdminWrite(data?.length ?? 0, i.id !== undefined)
}

export async function liveSaveRecipe(sb: Sb, productId: number, lines: { kind: 'ingredient' | 'product'; component_id: number; qty: number }[]): Promise<void> {
  const del = await sb.from('recipe_items').delete().eq('product_id', productId)
  if (del.error) throw new Error(del.error.message)
  if (lines.length) {
    const ins = await sb.from('recipe_items').insert(lines.map((l) => ({ ...l, product_id: productId })))
    if (ins.error) throw new Error(ins.error.message)
  }
}

export async function liveSaveIngredientRecipe(sb: Sb, ingredientId: number, lines: { component_id: number; qty: number }[]): Promise<void> {
  const del = await sb.from('ingredient_recipes').delete().eq('ingredient_id', ingredientId)
  if (del.error) throw new Error(del.error.message)
  if (lines.length) {
    const ins = await sb.from('ingredient_recipes').insert(lines.map((l) => ({ ...l, ingredient_id: ingredientId })))
    if (ins.error) throw new Error(ins.error.message)
  }
}

export async function liveSaveTargets(sb: Sb, targets: { product_id: number; qty: number }[]): Promise<void> {
  const del = await sb.from('daily_targets').delete().neq('product_id', 0)
  if (del.error) throw new Error(del.error.message)
  if (targets.length) {
    const ins = await sb.from('daily_targets').insert(targets)
    if (ins.error) throw new Error(ins.error.message)
  }
}

export async function liveLoadZones(sb: Sb): Promise<{ zones: DeliveryZone[]; outlet: OutletSetting }> {
  const [z, o] = await Promise.all([sb.from('delivery_zones').select('*').order('sort'), sb.from('outlet_settings').select('*').eq('id', 1).single()])
  if (z.error) throw new Error(z.error.message)
  return { zones: (z.data ?? []) as DeliveryZone[], outlet: (o.data ?? { lat: null, lng: null, max_radius_km: 8 }) as OutletSetting }
}

export async function liveSaveZones(sb: Sb, zones: { radius_km: number; fee: number }[], outlet: OutletSetting): Promise<void> {
  const del = await sb.from('delivery_zones').delete().neq('id', 0)
  if (del.error) throw new Error(del.error.message)
  if (zones.length) {
    const ins = await sb.from('delivery_zones').insert(zones.map((z, i) => ({ ...z, sort: i })))
    if (ins.error) throw new Error(ins.error.message)
  }
  const up = await sb.from('outlet_settings').upsert({ id: 1, ...outlet })
  if (up.error) throw new Error(up.error.message)
}

// ================= Pesanan portal (live) =================

export async function liveLoadPortalOrders(sb: Sb): Promise<PortalOrder[]> {
  const { data, error } = await sb
    .from('orders')
    .select('*, order_items(name, qty, price)')
    .order('created_at', { ascending: false })
    .limit(80)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as PortalOrder[]
}

export async function liveAcceptOrder(sb: Sb, id: number): Promise<void> {
  const { error } = await sb.rpc('accept_order', { p_order_id: id })
  if (error) throw new Error(error.message)
}

export async function liveRejectOrder(sb: Sb, id: number, reason: string): Promise<void> {
  const { error } = await sb.rpc('reject_order', { p_order_id: id, p_reason: reason })
  if (error) throw new Error(error.message)
}

export async function liveVerifyOrderPayment(sb: Sb, id: number): Promise<void> {
  const { error } = await sb.rpc('verify_order_payment', { p_order_id: id })
  if (error) throw new Error(error.message)
}

export async function liveSetOrderStatus(sb: Sb, id: number, status: PortalOrder['status']): Promise<void> {
  const { error } = await sb.rpc('set_order_status', { p_order_id: id, p_status: status })
  if (error) throw new Error(error.message)
}

// ================= Paket bundling (live) =================

export async function liveSaveBundle(sb: Sb, b: { id?: number; name: string; price: number; is_active: boolean }): Promise<void> {
  // id tidak boleh ikut di UPDATE (GENERATED ALWAYS, error 428C9)
  const { error } = b.id ? await sb.from('bundles').update({ ...b, id: undefined }).eq('id', b.id) : await sb.from('bundles').insert(b)
  if (error) throw new Error(error.message)
}

export async function liveSaveBundleItems(sb: Sb, bundleId: number, items: { product_id: number; qty: number }[]): Promise<void> {
  const del = await sb.from('bundle_items').delete().eq('bundle_id', bundleId)
  if (del.error) throw new Error(del.error.message)
  if (items.length) {
    const ins = await sb.from('bundle_items').insert(items.map((i) => ({ ...i, bundle_id: bundleId })))
    if (ins.error) throw new Error(ins.error.message)
  }
}

export async function liveDeleteBundle(sb: Sb, id: number): Promise<void> {
  const { error } = await sb.from('bundles').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ================= API portal customer (live) =================

async function portalRpc<T>(sb: Sb, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

export const livePortal = {
  register: (sb: Sb, phone: string, name: string, pin: string) => portalRpc<{ token: string; name: string }>(sb, 'portal_register', { p_phone: phone, p_name: name, p_pin: pin }),
  login: (sb: Sb, phone: string, pin: string) => portalRpc<{ token: string; name: string }>(sb, 'portal_login', { p_phone: phone, p_pin: pin }),
  profile: (sb: Sb, token: string) => portalRpc<{ phone: string; name: string; address: string; label: string }>(sb, 'portal_get_profile', { p_token: token }),
  updateProfile: (sb: Sb, token: string, name: string, address: string) => portalRpc<void>(sb, 'portal_update_profile', { p_token: token, p_name: name, p_address: address }),
  changePin: (sb: Sb, token: string, oldPin: string, newPin: string) => portalRpc<void>(sb, 'portal_change_pin', { p_token: token, p_old_pin: oldPin, p_new_pin: newPin }),
  listAddresses: (sb: Sb, token: string) => portalRpc<import('./db-shared').PortalAddress[]>(sb, 'portal_list_addresses', { p_token: token }),
  saveAddress: (sb: Sb, token: string, id: number | null, label: string, address: string, lat: number | null, lng: number | null) =>
    portalRpc<number>(sb, 'portal_save_address', { p_token: token, p_id: id, p_label: label, p_address: address, p_lat: lat, p_lng: lng }),
  deleteAddress: (sb: Sb, token: string, id: number) => portalRpc<void>(sb, 'portal_delete_address', { p_token: token, p_id: id }),
  async availability(sb: Sb): Promise<Map<number, number>> {
    const { data, error } = await sb.rpc('portal_availability')
    if (error) throw new Error(error.message)
    return new Map((data as { product_id: number; max_qty: number }[]).map((r) => [r.product_id, r.max_qty]))
  },
  createOrder: (sb: Sb, token: string, items: { product_id: number; qty: number }[], addressId: number, note: string) =>
    portalRpc<number>(sb, 'portal_create_order', { p_token: token, p_items: items, p_address_id: addressId, p_note: note || null }),
  async orders(sb: Sb, token: string): Promise<PortalOrder[]> {
    const rows = await portalRpc<PortalOrder[]>(sb, 'portal_get_orders', { p_token: token })
    return rows.map((r) => ({ ...r, items: r.items ?? [] }))
  },
  confirmPaid: (sb: Sb, token: string, orderId: number) => portalRpc<void>(sb, 'portal_confirm_paid', { p_token: token, p_order_id: orderId }),
  cancelOrder: (sb: Sb, token: string, orderId: number) => portalRpc<void>(sb, 'portal_cancel_order', { p_token: token, p_order_id: orderId })
}

// ================= Langganan pesanan (live: realtime) =================

export function liveSubscribeOrders(sb: Sb, cb: () => void): () => void {
  const ch = sb.channel('orders-watch')
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => cb()).subscribe()
  return () => {
    void sb.removeChannel(ch)
  }
}

// ================= Email laporan shift (live) =================

/** Kirim laporan tutup shift via edge function (live only). */
export async function liveEmailShiftReport(sb: Sb, shiftId: number, rep: { cash_sales: number; expected_cash: number; cash_diff: number; opening_cash: number }, email: string, settings: import('./types').Settings): Promise<void> {
  try {
    // Ambil ringkasan shift + laporan akhir hari, kirim via edge function
    let eodHtml = ''
    try {
      const shift = (await liveLoadShifts(sb)).find((s) => s.id === shiftId)
      if (shift) {
        const txs = await liveLoadTransactions(sb, shift.opened_at, shift.closed_at ?? new Date().toISOString())
        const inShift = txs.filter((t) => t.shift_id === shiftId || (t.shift_id === null && (t.payments ?? []).length === 0))
        const rep = endOfDayReport(inShift, settings.channels)
        const rp = (n: number): string => 'Rp' + Math.round(n).toLocaleString('id-ID')
        const rows = rep.methods.map((m) => `<li>${m.label}: ${rp(m.amount)} (${m.count} trx)</li>`).join('')
        eodHtml = `<h3>Laporan shift</h3><p>Omzet ${rp(rep.revenue)} · HPP ${rp(rep.hpp)} · <b>Laba kotor ${rp(rep.gross)}</b></p><ul>${rows}</ul>`
      }
    } catch (e) {
      console.warn('Laporan shift gagal dibuat:', e)
    }
    const { data: summary } = await sb.rpc('shift_summary', { p_shift_id: shiftId })
    const { error: fnErr } = await sb.functions.invoke('email-shift-report', {
      body: {
        to: email,
        subject: `Sabana Kasir: Tutup Shift #${shiftId} (selisih Rp ${rep.cash_diff.toLocaleString('id-ID')})`,
        html: `<pre style="font-family:monospace">${JSON.stringify(summary, null, 2)}</pre><p>Modal awal ${rep.opening_cash} · Tunai ${rep.cash_sales} · Seharusnya ${rep.expected_cash} · Fisik/tercatat selisih ${rep.cash_diff}</p>${eodHtml}`
      }
    })
    if (fnErr) console.warn('Email shift gagal:', fnErr)
  } catch (e) {
    console.warn('Email shift gagal:', e)
  }
}

// ================= Simpan pesanan / bill (pembayaran nanti) =================

export async function liveSaveHeldOrder(
  sb: Sb,
  p: {
    orderType: OrderType
    items: { product_id: number; name: string; qty: number; price: number }[]
    subtotal: number
    discount: number
    total: number
    note: string | null
    label: string | null
  }
): Promise<HeldOrder> {
  const { data: sh } = await sb.from('shifts').select('id').eq('status', 'buka').limit(1).maybeSingle()
  const shiftId = sh?.id ?? null
  if (shiftId === null) throw new Error('Buka shift dulu sebelum menyimpan pesanan')
  const { data: sess } = await sb.auth.getUser()
  const { data, error } = await sb
    .from('held_orders')
    .insert({
      shift_id: shiftId,
      user_id: sess?.user?.id ?? null,
      order_type: p.orderType,
      items: p.items,
      subtotal: p.subtotal,
      discount: p.discount,
      total: p.total,
      note: p.note,
      label: p.label
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as HeldOrder
}

export async function liveLoadHeldOrders(sb: Sb): Promise<HeldOrder[]> {
  const { data, error } = await sb.from('held_orders').select('*').order('created_at')
  if (error) throw new Error(error.message)
  return (data ?? []) as HeldOrder[]
}

/**
 * Bayar bill tersimpan lewat RPC pay_held_order: buat transaksi (stok dipotong,
 * aturan bisnis di create_tx) lalu hapus bill secara atomik di server.
 */
export async function livePayHeldOrder(
  sb: Sb,
  heldId: number,
  method: 'cash' | 'qris' | 'transfer',
  amount: number,
  discountOverride?: number
): Promise<TxResult> {
  const { data, error } = await sb.rpc('pay_held_order', {
    p_held_id: heldId,
    p_method: method,
    p_amount: amount,
    p_discount: discountOverride ?? null
  })
  if (error) throw new Error(error.message)
  const txId = (data as { id: number }).id
  const { data: tx } = await sb.from('transactions').select('*').eq('id', txId).single()
  const { data: items } = await sb.from('transaction_items').select('name, qty, price').eq('transaction_id', txId)
  const { data: pays } = await sb.from('payments').select('method, amount').eq('transaction_id', txId)
  return {
    id: txId,
    receipt_no: tx!.receipt_no,
    subtotal: tx!.subtotal,
    discount: tx!.discount,
    total: tx!.total,
    channel_fee: tx!.channel_fee,
    order_type: tx!.order_type,
    created_at: tx!.created_at,
    items: items ?? [],
    payments: pays ?? []
  }
}

/** Void bill: batal tanpa jadi transaksi, stok tidak tersentuh. */
export async function liveVoidHeldOrder(sb: Sb, heldId: number): Promise<void> {
  const { error } = await sb.rpc('void_held_order', { p_held_id: heldId })
  if (error) throw new Error(error.message)
}
