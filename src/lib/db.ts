// Lapisan data: satu API untuk dua mode.
// - Mode Supabase: kueri & RPC ke Postgres (produksi).
// - Mode Demo (tanpa env Supabase): logika yang sama dijalankan lokal
//   di localStorage supaya aplikasi bisa dipakai/dites tanpa server.
// Aturan bisnis hanya ada satu sumber: RPC di supabase/migrations untuk
// produksi; mode demo meniru aturan yang sama dan dites oleh unit test.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type {
  Bundle,
  Category,
  DeliveryZone,
  DeliveryWeek,
  Expense,
  ExpenseCategory,
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
  Transaction,
  TransactionItem
} from './types'
import { ingredientNeeds, productNeeds, maxAvailableQty } from './hpp'
import { feeForDistance, haversineKm } from './geo'
import { fmtRpPlain } from './money'
import { ensureAdminWrite } from './supabase-guard'
import { todayISO } from './dates'
import { endOfDayReport } from './reports'
import { enqueueTx, isNetworkError, markAttempt, readQueue, removeQueued, type QueuedTx } from './offline'
import type { TxStatus } from './types'
export { queueCount, QUEUE_EVENT } from './offline'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
export const isDemo = !SUPABASE_URL || !SUPABASE_KEY
export const sb: SupabaseClient | null = isDemo
  ? null
  : createClient(SUPABASE_URL!, SUPABASE_KEY!, { realtime: { params: { eventsPerSecond: 5 } } })

// ================= Tipe hasil =================

export interface Catalog {
  categories: Category[]
  products: Product[]
  ingredients: Ingredient[]
  bundles: Bundle[]
  recipeByProduct: Map<number, RecipeItem[]>
  ingRecipes: Map<number, IngredientRecipe[]>
  targets: Map<number, number>
}

export interface TxResult {
  id: number
  receipt_no: string
  subtotal: number
  discount: number
  total: number
  channel_fee: number
  order_type: OrderType
  created_at: string
  items: { name: string; qty: number; price: number }[]
  payments: { method: string; amount: number }[]
}

// ================= Mode offline: antrean & sinkronisasi =================

let online = typeof navigator !== 'undefined' ? navigator.onLine : true

export const currentOnline = (): boolean => online

const listeners = new Set<(online: boolean) => void>()
export function onSyncStateChange(fn: (online: boolean) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function emit(): void {
  listeners.forEach((fn) => fn(online))
}

/** Simpan katalog/shift terakhir ke localStorage — dipakai saat offline. */
function cachePut(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage penuh — abaikan */
  }
}
function cacheGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}



// ================= Mode demo: penyimpanan =================

interface DemoCustomer {
  id: number
  phone: string
  name: string
  pin: string
  address: string
  lat: number | null
  lng: number | null
  distanceKm: number | null
}

interface DemoData {
  v: number
  settings: Settings
  categories: Category[]
  products: Product[]
  ingredients: Ingredient[]
  bundles: Bundle[]
  recipeItems: RecipeItem[]
  ingRecipes: IngredientRecipe[]
  targets: { product_id: number; qty: number }[]
  zones: DeliveryZone[]
  outlet: OutletSetting
  fryers: Fryer[]
  oilCycles: OilCycle[]
  shifts: Shift[]
  txs: Transaction[]
  expenses: Expense[]
  expenseCats: ExpenseCategory[]
  otherIncome: OtherIncome[]
  customer: DemoCustomer | null
  orders: PortalOrder[]
  session: { email: string; role: 'admin' | 'kasir'; name: string } | null
  seq: number
}

const LS_KEY = 'sabana-demo-v3'

function defaultDemo(): DemoData {
  return {
    v: 3,
    settings: {
      store: { name: 'Sabana Drieischicken', tagline: 'Drieischicken POS', address: 'Jl. Kebun Sayur No. 1', phone: '', footer: 'Terima kasih, datang kembali!' },
      shift: { float_cash: 350000 },
      channels: { gofood: { fee: 10 }, grabfood: { fee: 10 }, shopeefood: { fee: 10 } },
      oil: { max_days: 3, max_fry_count: 60 },
      margin: { warn_pct: 15 },
      receipt: {
        width_mm: 58,
        show_cashier: true,
        show_channel: true,
        header: 'Sabana Drieischicken',
        footer: 'Terima kasih, datang kembali!',
        show_qr: false
      },
      qris: { image: '' },
      portal: { secret: 'demo', outlet_note: 'Pesanan diproses setelah kasir mengonfirmasi.', delivery_enabled: true, delivery_schedule: null },
      owner_email: { email: '', whatsapp: '' },
      printer: { auto_print: false },
      tablet: { keep_awake: true, fullscreen: false },
      fixed_costs: [
        { name: 'Listrik', amount: 200000 },
        { name: 'Karyawan', amount: 1500000 },
        { name: 'Kios', amount: 1500000 }
      ]
    },
    categories: [
      { id: 1, name: 'Ayam', sort: 1 },
      { id: 2, name: 'Nasi & Rice Box', sort: 2 },
      { id: 3, name: 'Snack Goreng', sort: 3 },
      { id: 5, name: 'Saos & Sambal', sort: 4 },
      { id: 7, name: 'Minuman', sort: 5 }
    ],
    products: [
      { id: 1, name: 'Ayam Dada', category_id: 1, price: 11000, unit: 'potong', is_active: true, sort: 1 },
      { id: 2, name: 'Ayam Paha Atas', category_id: 1, price: 11000, unit: 'potong', is_active: true, sort: 2 },
      { id: 3, name: 'Ayam Paha Bawah', category_id: 1, price: 9000, unit: 'potong', is_active: true, sort: 3 },
      { id: 4, name: 'Ayam Sayap', category_id: 1, price: 8000, unit: 'potong', is_active: true, sort: 4 },
      { id: 5, name: 'Ayam 1 Ekor (9 potong)', category_id: 1, price: 89000, unit: 'ekor', is_active: true, sort: 5 },
      { id: 7, name: 'Nasi Putih', category_id: 2, price: 5000, unit: 'porsi', is_active: true, sort: 6 },
      { id: 8, name: 'Chicken Katsu 650ml', category_id: 2, price: 8000, unit: 'porsi', is_active: true, sort: 7 },
      { id: 9, name: 'Chicken Roll', category_id: 3, price: 4000, unit: 'porsi', is_active: true, sort: 8 },
      { id: 12, name: 'Kulit Crispy', category_id: 3, price: 5000, unit: 'porsi', is_active: true, sort: 9 },
      { id: 13, name: 'Kentang Goreng', category_id: 3, price: 8000, unit: 'porsi', is_active: true, sort: 10 },
      { id: 16, name: 'Sambal Geprek (cup)', category_id: 5, price: 4000, unit: 'cup', is_active: true, sort: 11 },
      { id: 20, name: 'Saos Mentai (cup)', category_id: 5, price: 2000, unit: 'cup', is_active: true, sort: 12 },
      { id: 27, name: 'Teh Botol Sosro', category_id: 7, price: 5000, unit: 'porsi', is_active: true, sort: 13 }
    ],
    // KONVENSI `price`: harga per 1 SATUAN DASAR (harga kemasan / isi). Sama dgn seed.sql.
    ingredients: [
      { id: 1, name: 'Ayam Potong 9', code: '100001', kind: 'raw', buy_unit: 'ekor', pack_content: 9, price: 5333, stock: 12, min_stock: 6, active: true },
      { id: 3, name: 'Tepung Bumbu Fried Chicken', code: '200001', kind: 'raw', buy_unit: 'pack', pack_content: 1, price: 23500, stock: 2, min_stock: 2, active: true },
      { id: 4, name: 'Minyak Goreng Sunco 2L', code: '200002', kind: 'raw', buy_unit: 'liter', pack_content: 2, price: 21700, stock: 8, min_stock: 4, active: true },
      { id: 5, name: 'Gas 3 kg', code: '', kind: 'raw', buy_unit: 'tabung', pack_content: 1, price: 23000, stock: 2, min_stock: 1, active: true },
      { id: 6, name: 'Kemasan Ayam (ikat 100)', code: '200011', kind: 'raw', buy_unit: 'pack', pack_content: 100, price: 235, stock: 1.5, min_stock: 1, active: true },
      { id: 7, name: 'Kantong Plastik (pack 50)', code: '200023', kind: 'raw', buy_unit: 'pack', pack_content: 50, price: 140, stock: 2, min_stock: 1, active: true },
      { id: 8, name: 'Sauce Cup 35ml (pack 50)', code: '200022', kind: 'raw', buy_unit: 'pack', pack_content: 50, price: 300, stock: 1, min_stock: 1, active: true },
      { id: 9, name: 'Kertas Nasi (pack 100)', code: '200013', kind: 'raw', buy_unit: 'pack', pack_content: 100, price: 130, stock: 1, min_stock: 1, active: true },
      { id: 10, name: 'Box Nasi Standard (pack 100)', code: '200014', kind: 'raw', buy_unit: 'pack', pack_content: 100, price: 1250, stock: 1, min_stock: 1, active: true },
      { id: 11, name: 'Beras Mentik Wangi', code: '100006', kind: 'raw', buy_unit: 'kg', pack_content: 1, price: 16500, stock: 20, min_stock: 10, active: true },
      { id: 12, name: 'Saus Sambal Sabana (pack 125)', code: '200007', kind: 'raw', buy_unit: 'pack', pack_content: 125, price: 180, stock: 2, min_stock: 1, active: true },
      { id: 13, name: 'Sambal Geprek 500g', code: '200019', kind: 'raw', buy_unit: 'pouch 500g', pack_content: 1, price: 64000, stock: 2, min_stock: 2, active: true },
      { id: 17, name: 'Saos Keju Mentai 500g', code: '200030', kind: 'raw', buy_unit: 'pouch 500g', pack_content: 1, price: 27000, stock: 2, min_stock: 1, active: true },
      { id: 26, name: 'Chicken Katsu', code: '200059', kind: 'raw', buy_unit: 'pcs', pack_content: 1, price: 4500, stock: 10, min_stock: 10, active: true },
      { id: 27, name: 'Kentang Simplot', code: '200043', kind: 'raw', buy_unit: 'kg', pack_content: 2.72, price: 42279, stock: 2.72, min_stock: 2, active: true },
      { id: 32, name: 'Box Kentang (pack 200)', code: '200018', kind: 'raw', buy_unit: 'pack', pack_content: 200, price: 599, stock: 1, min_stock: 1, active: true },
      { id: 35, name: 'Sendok Garpu (pack 50)', code: '200051', kind: 'raw', buy_unit: 'pack', pack_content: 50, price: 200, stock: 1, min_stock: 1, active: true },
      { id: 37, name: 'Sayuran (timun/selada)', code: '', kind: 'raw', buy_unit: 'porsi', pack_content: 1, price: 1000, stock: 30, min_stock: 10, active: true },
      { id: 40, name: 'Teh Botol Sosro 250ml', code: '200038', kind: 'raw', buy_unit: 'pcs', pack_content: 1, price: 2500, stock: 24, min_stock: 12, active: true },
      { id: 50, name: 'Ayam Marinasi (per potong)', code: '', kind: 'prepared', buy_unit: 'potong', pack_content: 1, price: 0, stock: 18, min_stock: 9, active: true },
      { id: 52, name: 'Sambal Geprek Cup', code: '', kind: 'prepared', buy_unit: 'cup', pack_content: 1, price: 0, stock: 6, min_stock: 5, active: true },
      { id: 56, name: 'Saos Mentai Cup', code: '', kind: 'prepared', buy_unit: 'cup', pack_content: 1, price: 0, stock: 8, min_stock: 5, active: true }
    ],
    bundles: [],
    recipeItems: [],
    ingRecipes: [
      { ingredient_id: 50, component_id: 1, qty: 1 },
      { ingredient_id: 52, component_id: 13, qty: 0.05 },
      { ingredient_id: 52, component_id: 4, qty: 0.0122 },
      { ingredient_id: 52, component_id: 8, qty: 1 },
      { ingredient_id: 56, component_id: 17, qty: 0.05 },
      { ingredient_id: 56, component_id: 8, qty: 1 }
    ],
    targets: [
      { product_id: 5, qty: 12 },
      { product_id: 7, qty: 10 },
      { product_id: 8, qty: 10 },
      { product_id: 13, qty: 5 }
    ],
    zones: [
      { id: 1, radius_km: 1, fee: 5000 },
      { id: 2, radius_km: 3, fee: 10000 },
      { id: 3, radius_km: 5, fee: 15000 },
      { id: 4, radius_km: 8, fee: 20000 }
    ],
    outlet: { lat: null, lng: null, max_radius_km: 8 },
    fryers: [{ id: 1, name: 'Fryer 1', capacity_l: 8, is_active: true }],
    oilCycles: [],
    shifts: [],
    txs: [],
    expenses: [],
    expenseCats: [
      { id: 1, name: 'Gaji' },
      { id: 2, name: 'Sewa & Kios' },
      { id: 3, name: 'Listrik & Air' },
      { id: 4, name: 'Gas' },
      { id: 5, name: 'Lainnya' }
    ],
    otherIncome: [],
    customer: null,
    orders: [],
    session: null,
    seq: 100
  }
}

// Resep demo produk ringkas (mirip seed SQL versi lengkap)
function seedDemoRecipes(d: DemoData) {
  const perPotong: [number, number][] = [
    [50, 1],
    [3, 0.03704],
    [6, 0.005],
    [12, 0.008],
    [4, 0.02222],
    [7, 0.00444],
    [5, 0.00556]
  ]
  for (const pid of [1, 2, 3, 4])
    for (const [cid, qty] of perPotong) d.recipeItems.push({ product_id: pid, kind: 'ingredient', component_id: cid, qty })
  for (const [cid, qty] of [
    [50, 9],
    [3, 0.33333],
    [6, 0.045],
    [12, 0.072],
    [4, 0.2],
    [7, 0.04],
    [5, 0.05]
  ] as [number, number][])
    d.recipeItems.push({ product_id: 5, kind: 'ingredient', component_id: cid, qty })
  for (const [cid, qty] of [
    [11, 0.08333],
    [9, 0.01],
    [10, 0.01]
  ] as [number, number][])
    d.recipeItems.push({ product_id: 7, kind: 'ingredient', component_id: cid, qty })
  for (const [cid, qty] of [
    [26, 1],
    [4, 0.0191],
    [5, 0.00654],
    [12, 0.016],
    [7, 0.02],
    [6, 0.01]
  ] as [number, number][])
    d.recipeItems.push({ product_id: 8, kind: 'ingredient', component_id: cid, qty })
  for (const [cid, qty] of [
    [27, 0.12],
    [4, 0.025],
    [32, 0.005],
    [12, 0.016],
    [7, 0.02],
    [5, 0.00667]
  ] as [number, number][])
    d.recipeItems.push({ product_id: 13, kind: 'ingredient', component_id: cid, qty })
  d.recipeItems.push({ product_id: 16, kind: 'ingredient', component_id: 52, qty: 1 })
  d.recipeItems.push({ product_id: 20, kind: 'ingredient', component_id: 56, qty: 1 })
  d.recipeItems.push({ product_id: 27, kind: 'ingredient', component_id: 40, qty: 1 })
}

function loadDemo(): DemoData {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const d = JSON.parse(raw) as DemoData
      if (d.v === 3) return d
    }
  } catch {
    // korup: mulai baru
  }
  const d = defaultDemo()
  seedDemoRecipes(d)
  saveDemo(d)
  return d
}

function saveDemo(d: DemoData): void {
  localStorage.setItem(LS_KEY, JSON.stringify(d))
}

export function resetDemoData(): void {
  localStorage.removeItem(LS_KEY)
}

function err(m: string): never {
  throw new Error(m)
}

// ================= Helper resep dari map =================

function mapsOf(d: DemoData) {
  const recipeByProduct = new Map<number, RecipeItem[]>()
  for (const r of d.recipeItems) {
    const arr = recipeByProduct.get(r.product_id) ?? []
    arr.push(r)
    recipeByProduct.set(r.product_id, arr)
  }
  const ingRecipes = new Map<number, IngredientRecipe[]>()
  for (const r of d.ingRecipes) {
    const arr = ingRecipes.get(r.ingredient_id) ?? []
    arr.push(r)
    ingRecipes.set(r.ingredient_id, arr)
  }
  return { recipeByProduct, ingRecipes }
}

// ================= Katalog & settings =================

export async function loadCatalog(): Promise<Catalog> {
  if (isDemo) {
    const d = loadDemo()
    const { recipeByProduct, ingRecipes } = mapsOf(d)
    return {
      categories: [...d.categories].sort((a, b) => a.sort - b.sort),
      products: [...d.products].sort((a, b) => a.sort - b.sort),
      ingredients: d.ingredients,
      bundles: d.bundles,
      recipeByProduct,
      ingRecipes,
      targets: new Map(d.targets.map((t) => [t.product_id, t.qty]))
    }
  }
  if (!online) {
    const c = cacheCatalogGet()
    if (c) return c
  }
  try {
    return await loadCatalogLive()
  } catch (ex) {
    if (isNetworkError(ex)) {
      const c = cacheCatalogGet()
      if (c) return c
      throw new Error('Belum ada data tersimpan untuk mode offline. Sambungkan internet sekali untuk memuat menu.')
    }
    throw ex
  }
}

async function loadCatalogLive(): Promise<Catalog> {
  const sbx = sb!
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
  const recipeByProduct = new Map<number, RecipeItem[]>()
  for (const r of (recipes.data ?? []) as RecipeItem[]) {
    const arr = recipeByProduct.get(r.product_id) ?? []
    arr.push(r)
    recipeByProduct.set(r.product_id, arr)
  }
  const ingRecipes = new Map<number, IngredientRecipe[]>()
  for (const r of (irecipes.data ?? []) as IngredientRecipe[]) {
    const arr = ingRecipes.get(r.ingredient_id) ?? []
    arr.push(r)
    ingRecipes.set(r.ingredient_id, arr)
  }
  const catalog: Catalog = {
    categories: (cats.data ?? []) as Category[],
    products: (prods.data ?? []) as Product[],
    ingredients: (ings.data ?? []) as Ingredient[],
    bundles: (bunds.data ?? []) as Bundle[],
    recipeByProduct,
    ingRecipes,
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

export async function loadSettings(): Promise<Settings> {
  if (isDemo) return loadDemo().settings
  if (!online) {
    const c = cacheGet<Settings>('sabana-cache-settings')
    if (c) return c
  }
  const { data, error } = await sb!.from('settings').select('key, value')
  if (error) {
    if (isNetworkError(new Error(error.message))) {
      const c = cacheGet<Settings>('sabana-cache-settings')
      if (c) return c
    }
    throw new Error(error.message)
  }
  const map = new Map((data ?? []).map((r) => [r.key, r.value]))
  const demo = defaultDemo().settings
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
      delivery_schedule: ((map.get('portal') as Settings['portal'] | undefined)?.delivery_schedule ?? null) as DeliveryWeek | null
    },
    owner_email: (map.get('owner_email') as Settings['owner_email']) ?? demo.owner_email,
    printer: (map.get('printer') as Settings['printer']) ?? demo.printer,
    tablet: (map.get('tablet') as Settings['tablet']) ?? demo.tablet,
    fixed_costs: (map.get('fixed_costs') as Settings['fixed_costs']) ?? demo.fixed_costs
  }
  cachePut('sabana-cache-settings', s)
  return s
}

export async function saveSetting(key: string, value: unknown): Promise<void> {
  if (isDemo) {
    const d = loadDemo()
    ;(d.settings as unknown as Record<string, unknown>)[key] = value
    saveDemo(d)
    return
  }
  const { error } = await sb!.from('settings').upsert({ key, value })
  if (error) throw new Error(error.message)
}

// ================= Auth =================

export interface SessionInfo {
  email: string
  role: 'admin' | 'kasir'
  name: string
}

export async function signIn(email: string, password: string): Promise<SessionInfo> {
  if (isDemo) {
    if (!email.includes('@')) err('Masukkan email yang benar')
    if (password.length < 4) err('Kata sandi minimal 4 karakter (mode demo bebas)')
    const role = email.startsWith('admin') ? 'admin' : 'kasir'
    const d = loadDemo()
    d.session = { email, role, name: role === 'admin' ? 'Pemilik' : 'Kasir' }
    saveDemo(d)
    return d.session
  }
  const { data, error } = await sb!.auth.signInWithPassword({ email, password })
  if (error) err(error.message)
  const prof = await sb!.from('profiles').select('name, role').eq('id', data.user!.id).maybeSingle()
  return { email, role: (prof.data?.role as 'admin' | 'kasir') ?? 'kasir', name: prof.data?.name ?? email }
}

export async function signOut(): Promise<void> {
  if (isDemo) {
    const d = loadDemo()
    d.session = null
    saveDemo(d)
    return
  }
  await sb!.auth.signOut()
}

export async function currentSession(): Promise<SessionInfo | null> {
  if (isDemo) return loadDemo().session
  const { data } = await sb!.auth.getSession()
  if (!data.session) return null
  const prof = await sb!.from('profiles').select('name, role').eq('id', data.session.user.id).maybeSingle()
  return {
    email: data.session.user.email ?? '',
    role: (prof.data?.role as 'admin' | 'kasir') ?? 'kasir',
    name: prof.data?.name ?? (data.session.user.email ?? '')
  }
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
  if (isDemo) return demoCreateTx(p)
  if (!online) {
    return offlineTxResult(
      enqueueTx({ orderType: p.orderType, items: p.items, payments: p.payments, discount: p.discount, note: p.note, itemsDisplay: p.itemsDisplay })
    )
  }
  try {
    return await createTxLive(p)
  } catch (ex) {
    if (isNetworkError(ex)) {
      const q = enqueueTx({ orderType: p.orderType, items: p.items, payments: p.payments, discount: p.discount, note: p.note, itemsDisplay: p.itemsDisplay })
      return offlineTxResult(q)
    }
    throw ex
  }
}

/** Struk provisional utk transaksi offline — nomor OFF-*, diganti saat sync. */
function offlineTxResult(q: QueuedTx): TxResult {
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

async function createTxLive(p: {
  orderType: OrderType
  items: { product_id: number; qty: number }[]
  payments: { method: 'cash' | 'qris' | 'transfer'; amount: number }[]
  discount?: number
  note?: string
}): Promise<TxResult> {
  const { data, error } = await sb!.rpc('create_transaction', {
    p_order_type: p.orderType,
    p_items: p.items,
    p_payments: p.orderType === 'gofood' || p.orderType === 'grabfood' || p.orderType === 'shopeefood' ? [] : p.payments,
    p_discount: p.discount ?? 0,
    p_note: p.note ?? null
  })
  if (error) throw new Error(error.message)
  const id = data as number
  const { data: tx } = await sb!.from('transactions').select('*').eq('id', id).single()
  const { data: items } = await sb!.from('transaction_items').select('name, qty, price').eq('transaction_id', id)
  const { data: pays } = await sb!.from('payments').select('method, amount').eq('transaction_id', id)
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

// ================= Riwayat transaksi: ubah, hapus, refund =================

/**
 * Nota mana yang boleh diubah/dihapus/di-refund: hanya yang masih 'normal'.
 * Nota refund (total negatif) dan nota hasil revisi otomatis ikut tersembunyi
 * dari daftar aksi karena statusnya bukan 'normal'.
 */
export function txIsEditable(t: Transaction): boolean {
  return (t.status ?? 'normal') === 'normal' && t.total >= 0
}

export interface RefundResult {
  refund_id: number
  receipt_no: string
  amount: number
  method: string
}

/** Refund: uang kembali, stok kembali, nota asli berstatus 'refund'. */
export async function refundTx(txId: number, reason: string): Promise<RefundResult> {
  if (isDemo) {
    const d = loadDemo()
    const tx = d.txs.find((t) => t.id === txId) ?? err('Transaksi tidak ditemukan')
    if (!txIsEditable(tx)) err('Transaksi sudah diproses sebelumnya')
    const method = tx.payments?.[0]?.method ?? 'qris'
    const amount = tx.total
    const id = ++d.seq
    const refundTx: Transaction = {
      id,
      receipt_no: 'RF' + todayISO().replace(/-/g, '').slice(2) + '-' + String(id).padStart(4, '0'),
      shift_id: tx.shift_id,
      user_id: null,
      order_type: tx.order_type,
      channel_fee: 0,
      subtotal: 0,
      discount: 0,
      total: -amount,
      hpp: 0,
      note: reason.trim() ? `${reason.trim()} (refund nota ${tx.receipt_no ?? tx.id})` : `Refund nota ${tx.receipt_no ?? tx.id}`,
      created_at: new Date().toISOString(),
      status: 'refund',
      refund_of: tx.id,
      refund_amount: amount,
      items: (tx.items ?? []).map((it) => ({ name: it.name, qty: -it.qty, price: it.price, hpp: it.hpp })),
      payments: [{ method, amount: -amount }]
    }
    d.txs.push(refundTx)
    // stok kembali sesuai resep produk asli
    const { recipeByProduct } = mapsOf(d)
    for (const it of tx.items ?? []) {
      const prod = d.products.find((p) => p.name === it.name)
      if (!prod) continue
      for (const [iid, need] of productNeeds(prod.id, it.qty, recipeByProduct, new Map(d.ingredients.map((i) => [i.id, i])))) {
        const ing = d.ingredients.find((x) => x.id === iid)
        if (ing) ing.stock = Math.round((ing.stock + need) * 10000) / 10000
      }
    }
    tx.status = 'refund'
    saveDemo(d)
    return { refund_id: id, receipt_no: refundTx.receipt_no!, amount, method }
  }
  const { data, error } = await sb!.rpc('refund_transaction', { p_tx_id: txId, p_reason: reason.trim() || null })
  if (error) throw new Error(error.message)
  return data as RefundResult
}

/** Hapus (batal): salah input, tanpa pergerakan uang, stok kembali. */
export async function deleteTx(txId: number, reason: string): Promise<void> {
  if (isDemo) {
    const d = loadDemo()
    const tx = d.txs.find((t) => t.id === txId) ?? err('Transaksi tidak ditemukan')
    if (!txIsEditable(tx)) err('Transaksi sudah diproses sebelumnya')
    const { recipeByProduct } = mapsOf(d)
    for (const it of tx.items ?? []) {
      const prod = d.products.find((p) => p.name === it.name)
      if (!prod) continue
      for (const [iid, need] of productNeeds(prod.id, it.qty, recipeByProduct, new Map(d.ingredients.map((i) => [i.id, i])))) {
        const ing = d.ingredients.find((x) => x.id === iid)
        if (ing) ing.stock = Math.round((ing.stock + need) * 10000) / 10000
      }
    }
    tx.status = 'batal'
    tx.note = [tx.note, `Dibatalkan: ${reason.trim() || 'tanpa alasan'}`].filter(Boolean).join(' ')
    saveDemo(d)
    return
  }
  const { error } = await sb!.rpc('delete_transaction', { p_tx_id: txId, p_reason: reason.trim() || null })
  if (error) throw new Error(error.message)
}

/**
 * Edit: nota lama jadi 'direvisi', nota baru diterbitkan dengan item & diskon
 * baru. Pembayaran lama dipakai ulang, jadi total baru tidak boleh melebihi
 * yang sudah dibayar (dicek di RPC; demo meniru aturan yang sama).
 */
export async function editTx(txId: number, items: { product_id: number; qty: number }[], discount: number, note: string): Promise<number> {
  if (isDemo) {
    const d = loadDemo()
    const tx = d.txs.find((t) => t.id === txId) ?? err('Transaksi tidak ditemukan')
    if (!txIsEditable(tx)) err('Transaksi sudah diproses sebelumnya')
    if (items.length === 0) err('Nota revisi minimal punya 1 item')
    const { recipeByProduct, ingRecipes } = mapsOf(d)
    const ings = new Map(d.ingredients.map((i) => [i.id, i]))

    // validasi kecukupan stok utk nota baru
    const totalNeed = new Map<number, number>()
    for (const it of items)
      for (const [iid, need] of productNeeds(it.product_id, it.qty, recipeByProduct, ings))
        totalNeed.set(iid, (totalNeed.get(iid) ?? 0) + need)

    // hitung subtotal & hpp nota baru (harga dari data, bukan client)
    let subtotal = 0
    let hpp = 0
    const itemNames: TransactionItem[] = []
    for (const it of items) {
      const prod = d.products.find((x) => x.id === it.product_id) ?? err('Menu tidak ditemukan')
      subtotal += Math.round(it.qty * prod.price)
      for (const [iid, need] of productNeeds(it.product_id, it.qty, recipeByProduct, ings)) {
        const ing = ings.get(iid)
        if (!ing) continue
        if (ing.kind === 'prepared') {
          for (const [cid, cq] of ingredientNeeds(iid, need, ingRecipes)) {
            const raw = ings.get(cid)
            if (raw) hpp += Math.round(cq * raw.price)
          }
        } else {
          hpp += Math.round(need * ing.price)
        }
      }
      itemNames.push({ name: prod.name, qty: it.qty, price: prod.price, hpp: 0 })
    }
    const total = subtotal - discount
    if (total < 0) err('Total tidak boleh negatif')
    const paid = (tx.payments ?? []).reduce((s, p) => s + p.amount, 0)
    const online = tx.order_type === 'gofood' || tx.order_type === 'grabfood' || tx.order_type === 'shopeefood'
    if (!online && paid < total) err(`Total revisi ${fmtRpPlain(total)} melebihi uang yang sudah dibayar ${fmtRpPlain(paid)}`)
    for (const [iid, need] of totalNeed) {
      const ing = d.ingredients.find((x) => x.id === iid)
      // stok efektif = stok sekarang + pengembalian dari nota lama
      let oldReturn = 0
      for (const old of tx.items ?? []) {
        const oldProd = d.products.find((p) => p.name === old.name)
        if (!oldProd) continue
        for (const [rid, rneed] of productNeeds(oldProd.id, old.qty, recipeByProduct, ings)) {
          if (rid === iid) oldReturn += rneed
        }
      }
      if (ing && ing.stock + oldReturn < need) err(`Stok kurang: ${ing.name}`)
    }

    // kembalikan stok nota lama
    for (const it of tx.items ?? []) {
      const prod = d.products.find((p) => p.name === it.name)
      if (!prod) continue
      for (const [iid, need] of productNeeds(prod.id, it.qty, recipeByProduct, ings)) {
        const ing = d.ingredients.find((x) => x.id === iid)
        if (ing) ing.stock = Math.round((ing.stock + need) * 10000) / 10000
      }
    }
    // potong stok nota baru
    for (const [iid, need] of totalNeed) {
      const ing = d.ingredients.find((x) => x.id === iid)
      if (ing) ing.stock = Math.round((ing.stock - need) * 10000) / 10000
    }

    tx.status = 'direvisi'
    tx.note = [tx.note, 'Direvisi: item/diskon diperbarui, lihat nota berikutnya'].filter(Boolean).join(' ')
    // pembayaran pindah ke nota baru: kosongkan di nota lama supaya kas tidak terhitung dobel
    tx.payments = []

    const id = ++d.seq
    const newTx: Transaction = {
      id,
      receipt_no: 'SB' + todayISO().replace(/-/g, '').slice(2) + '-' + String(id).padStart(4, '0'),
      shift_id: tx.shift_id,
      user_id: null,
      order_type: tx.order_type,
      channel_fee: tx.channel_fee,
      subtotal,
      discount,
      total,
      hpp,
      note: note.trim() ? note.trim() : `Revisi nota ${tx.receipt_no ?? tx.id}`,
      created_at: new Date().toISOString(),
      status: 'normal',
      items: itemNames,
      payments: tx.payments
    }
    d.txs.push(newTx)
    saveDemo(d)
    return id
  }
  const { data, error } = await sb!.rpc('edit_transaction', { p_tx_id: txId, p_items: items, p_discount: discount, p_note: note.trim() || null })
  if (error) throw new Error(error.message)
  return data as number
}

/** Status label Indonesia utk ditampilkan di UI. */
export const TX_STATUS_LABEL: Record<TxStatus, string> = {
  normal: '',
  direvisi: 'Direvisi',
  refund: 'Refund',
  batal: 'Batal'
}

// ================= Sinkronisasi antrean offline =================

let flushing = false

/**
 * Kirim semua transaksi tertahan ke server (FIFO).
 * Dipanggil otomatis saat koneksi kembali, saat app dibuka, dan berkala.
 * Return: jumlah transaksi yang berhasil tersinkron.
 */
export async function flushQueue(): Promise<number> {
  if (isDemo || flushing || !online) return 0
  flushing = true
  let synced = 0
  try {
    for (const q of readQueue()) {
      try {
        await createTxLive({
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
  } finally {
    flushing = false
  }
  return synced
}

/**
 * Pasang listener online/offline + sinkron berkala.
 * Panggil sekali di main.tsx. Return: fungsi cleanup.
 */
export function initSync(): () => void {
  const goOnline = async (): Promise<void> => {
    const was = online
    online = true
    if (!was) emit()
    await flushQueue()
  }
  const goOffline = (): void => {
    online = false
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

function demoCreateTx(p: {
  orderType: OrderType
  items: { product_id: number; qty: number }[]
  payments: { method: 'cash' | 'qris' | 'transfer'; amount: number }[]
  discount?: number
  note?: string
}): TxResult {
  const d = loadDemo()
  const { recipeByProduct, ingRecipes } = mapsOf(d)
  const online = p.orderType === 'gofood' || p.orderType === 'grabfood' || p.orderType === 'shopeefood'

  let shift: Shift | undefined
  if (!online) {
    shift = d.shifts.find((s) => s.status === 'buka')
    if (!shift) err('Buka shift dulu sebelum menjual')
  }

  // validasi kecukupan stok
  const totalNeed = new Map<number, number>()
  for (const it of p.items)
    for (const [iid, need] of productNeeds(it.product_id, it.qty, recipeByProduct, new Map(d.ingredients.map((i) => [i.id, i]))))
      totalNeed.set(iid, (totalNeed.get(iid) ?? 0) + need)
  for (const [iid, need] of totalNeed) {
    const ing = d.ingredients.find((i) => i.id === iid)
    if (ing && ing.stock < need) err(`Stok kurang: ${ing.name} (butuh ${need.toFixed(2)}, tersedia ${ing.stock.toFixed(2)})`)
  }

  let subtotal = 0
  let hpp = 0
  const itemNames: { name: string; qty: number; price: number }[] = []
  const ings = new Map(d.ingredients.map((i) => [i.id, i]))
  for (const it of p.items) {
    const prod = d.products.find((x) => x.id === it.product_id) ?? err('Menu tidak ditemukan')
    subtotal += Math.round(it.qty * prod.price)
    // daun resep prepared diekspansi ke bahan mentahnya untuk biaya
    for (const [iid, need] of productNeeds(it.product_id, it.qty, recipeByProduct, ings)) {
      const ing = ings.get(iid)
      if (!ing) continue
      if (ing.kind === 'prepared') {
        for (const [cid, cq] of ingredientNeeds(iid, need, ingRecipes)) {
          const raw = ings.get(cid)
          if (raw) hpp += Math.round(cq * raw.price)
        }
      } else {
        hpp += Math.round(need * ing.price)
      }
    }
    itemNames.push({ name: prod.name, qty: it.qty, price: prod.price })
  }
  const discount = p.discount ?? 0
  const total = subtotal - discount
  const paid = p.payments.reduce((s, x) => s + x.amount, 0)
  if (!online && paid < total) err('Pembayaran kurang dari total')
  const fee = online ? Math.round((subtotal * d.settings.channels[p.orderType as 'gofood' | 'grabfood' | 'shopeefood'].fee) / 100) : 0

  // potong stok
  for (const [iid, need] of totalNeed) {
    const ing = d.ingredients.find((i) => i.id === iid)
    if (ing) ing.stock = Math.round((ing.stock - need) * 10000) / 10000
  }

  const id = ++d.seq
  const tx: Transaction = {
    id,
    receipt_no: 'SB' + todayISO().replace(/-/g, '').slice(2) + '-' + String(id).padStart(4, '0'),
    shift_id: shift?.id ?? null,
    user_id: null,
    order_type: p.orderType,
    channel_fee: fee,
    subtotal,
    discount,
    total,
    hpp,
    note: p.note ?? null,
    created_at: new Date().toISOString(),
    items: itemNames as TransactionItem[],
    payments: online ? [] : p.payments
  }
  d.txs.push(tx)
  saveDemo(d)
  return {
    id,
    receipt_no: tx.receipt_no!,
    subtotal,
    discount,
    total,
    channel_fee: fee,
    order_type: p.orderType,
    created_at: tx.created_at,
    items: itemNames,
    payments: online ? [] : p.payments
  }
}

// ================= Shift =================

export async function openShift(openingCash: number): Promise<number> {
  if (isDemo) {
    const d = loadDemo()
    if (d.shifts.some((s) => s.status === 'buka')) err('Masih ada shift yang terbuka')
    const floatCash = d.settings.shift.float_cash
    if (openingCash < floatCash) err(`Modal awal kurang dari float kembalian wajib ${floatCash.toLocaleString('id-ID')}`)
    const id = ++d.seq
    d.shifts.push({ id, user_id: null, opened_at: new Date().toISOString(), closed_at: null, opening_cash: openingCash, closing_cash: null, expected_cash: null, cash_diff: null, note: null, status: 'buka' })
    saveDemo(d)
    return id
  }
  const { data, error } = await sb!.rpc('open_shift', { p_opening_cash: openingCash })
  if (error) throw new Error(error.message)
  return data as number
}

export async function closeShift(closingCash: number, note: string): Promise<{ cash_sales: number; expected_cash: number; cash_diff: number; opening_cash: number }> {
  if (isDemo) {
    const d = loadDemo()
    const shift = d.shifts.find((s) => s.status === 'buka') ?? err('Tidak ada shift terbuka')
    const floatCash = d.settings.shift.float_cash
    if (closingCash < floatCash) err(`Kas drawer kurang dari float wajib ${floatCash.toLocaleString('id-ID')}, tidak bisa tutup shift`)
    const cashSales = d.txs
      .filter((t) => t.shift_id === shift.id)
      .filter((t) => (t.status ?? 'normal') === 'normal' || t.status === 'refund')
      .reduce((s, t) => s + (t.payments ?? []).filter((p) => p.method === 'cash').reduce((a, p) => a + p.amount, 0), 0)
    const expected = shift.opening_cash + cashSales
    const diff = closingCash - expected
    if (diff < 0 && !note.trim()) err(`Kas kurang Rp ${(-diff).toLocaleString('id-ID')}, wajib isi catatan kejadian`)
    shift.closed_at = new Date().toISOString()
    shift.closing_cash = closingCash
    shift.expected_cash = expected
    shift.cash_diff = diff
    shift.note = note
    shift.status = 'tutup'
    saveDemo(d)
    const rep = { cash_sales: cashSales, expected_cash: expected, cash_diff: diff, opening_cash: shift.opening_cash }
    await maybeEmailShiftReport(d, shift.id, rep)
    return rep
  }
  const { data, error } = await sb!.rpc('close_shift', { p_closing_cash: closingCash, p_note: note || null })
  if (error) throw new Error(error.message)
  const rep = data as { cash_sales: number; expected_cash: number; cash_diff: number; opening_cash: number }
  await maybeEmailShiftReport(null, 0, rep)
  return rep
}

async function maybeEmailShiftReport(d: DemoData | null, shiftId: number, rep: { cash_sales: number; expected_cash: number; cash_diff: number; opening_cash: number }): Promise<void> {
  const settings = d ? d.settings : await loadSettings()
  const email = settings.owner_email.email
  if (!email) return
  try {
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
    // Ambil ringkasan shift + laporan akhir hari, kirim via edge function
    let eodHtml = ''
    try {
      const { rep } = await shiftEndOfDay(shiftId, settings)
      const rp = (n: number): string => 'Rp' + Math.round(n).toLocaleString('id-ID')
      const rows = rep.methods.map((m) => `<li>${m.label}: ${rp(m.amount)} (${m.count} trx)</li>`).join('')
      eodHtml = `<h3>Laporan shift</h3><p>Omzet ${rp(rep.revenue)} · HPP ${rp(rep.hpp)} · <b>Laba kotor ${rp(rep.gross)}</b></p><ul>${rows}</ul>`
    } catch (e) {
      console.warn('Laporan shift gagal dibuat:', e)
    }
    const { data: summary } = await sb!.rpc('shift_summary', { p_shift_id: shiftId })
    const { error: fnErr } = await sb!.functions.invoke('email-shift-report', {
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

/**
 * Laporan lengkap sebuah shift: total metode bayar, HPP, laba kotor, item.
 * Dipakai laporan tutup shift (email otomatis + WhatsApp).
 */
export async function shiftEndOfDay(shiftId: number, settings: Settings): Promise<{ txs: Transaction[]; rep: ReturnType<typeof endOfDayReport> }> {
  const shift = (await loadShifts()).find((s) => s.id === shiftId)
  if (!shift) err('Shift tidak ditemukan')
  const txs = await loadTransactions(shift.opened_at, shift.closed_at ?? new Date().toISOString())
  const inShift = txs.filter((t) => t.shift_id === shiftId || (t.shift_id === null && (t.payments ?? []).length === 0))
  return { txs: inShift, rep: endOfDayReport(inShift, settings.channels) }
}

export async function currentShift(): Promise<Shift | null> {
  if (isDemo) return loadDemo().shifts.find((s) => s.status === 'buka') ?? null
  if (!online) return cacheGet<Shift>('sabana-cache-shift')
  const { data, error } = await sb!.from('shifts').select('*').eq('status', 'buka').order('opened_at', { ascending: false }).limit(1)
  if (error) {
    if (isNetworkError(new Error(error.message))) return cacheGet<Shift>('sabana-cache-shift')
    throw new Error(error.message)
  }
  const shift = (data?.[0] as Shift) ?? null
  cachePut('sabana-cache-shift', shift)
  return shift
}

// ================= Pembelian, produksi, fryer =================

export async function createPurchase(lines: { ingredient_id: number; packs: number; unit_cost: number }[], note: string): Promise<void> {
  if (isDemo) {
    const d = loadDemo()
    for (const l of lines) {
      const ing = d.ingredients.find((i) => i.id === l.ingredient_id) ?? err('Bahan tidak ditemukan')
      ing.stock = Math.round((ing.stock + l.packs * ing.pack_content) * 10000) / 10000
      ing.price = Math.round(l.unit_cost / (ing.pack_content || 1))
    }
    saveDemo(d)
    return
  }
  const { error } = await sb!.rpc('create_purchase', { p_items: lines, p_note: note || null })
  if (error) throw new Error(error.message)
}

export async function createBatch(p: { outputs: { ingredient_id: number; qty: number }[]; fryer_id: number | null; fried_grams: number; note: string }): Promise<void> {
  if (isDemo) {
    const d = loadDemo()
    const { ingRecipes } = mapsOf(d)
    for (const o of p.outputs)
      for (const [iid, need] of ingredientNeeds(o.ingredient_id, o.qty, ingRecipes)) {
        const ing = d.ingredients.find((i) => i.id === iid)
        if (ing && ing.stock < need) err(`Bahan kurang: ${ing.name} (butuh ${need.toFixed(2)}, tersedia ${ing.stock.toFixed(2)})`)
      }
    let cycle: OilCycle | undefined
    if (p.fryer_id) {
      cycle = d.oilCycles.find((c) => c.fryer_id === p.fryer_id && c.status === 'aktif')
      if (!cycle) err('Fryer belum diisi minyak (isi fryer dulu)')
    }
    for (const o of p.outputs) {
      const out = d.ingredients.find((i) => i.id === o.ingredient_id)
      if (out) out.stock = Math.round((out.stock + o.qty) * 10000) / 10000
      for (const [iid, need] of ingredientNeeds(o.ingredient_id, o.qty, ingRecipes)) {
        const ing = d.ingredients.find((i) => i.id === iid)
        if (ing) ing.stock = Math.round((ing.stock - need) * 10000) / 10000
      }
    }
    if (cycle) {
      cycle.fry_count += 1
      cycle.fried_grams += p.fried_grams
    }
    saveDemo(d)
    return
  }
  const { error } = await sb!.rpc('create_production_batch', {
    p_outputs: p.outputs,
    p_fryer_id: p.fryer_id,
    p_fried_grams: p.fried_grams,
    p_note: p.note || null
  })
  if (error) throw new Error(error.message)
}

export async function fillFryer(fryerId: number, oilIngredientId: number, liters: number): Promise<void> {
  if (isDemo) {
    const d = loadDemo()
    if (d.oilCycles.some((c) => c.fryer_id === fryerId && c.status === 'aktif')) err('Fryer ini masih punya siklus aktif, tutup dulu')
    const oil = d.ingredients.find((i) => i.id === oilIngredientId)
    if (!oil) err('Bahan minyak tidak ditemukan')
    if (oil!.stock < liters) err(`Stok minyak tinggal ${oil!.stock.toFixed(1)}, catat pembelian dulu`)
    const id = ++d.seq
    d.oilCycles.push({
      id,
      fryer_id: fryerId,
      oil_ingredient_id: oilIngredientId,
      oil_liters: liters,
      oil_cost: Math.round(liters * oil!.price),
      fry_count: 0,
      fried_grams: 0,
      started_at: new Date().toISOString(),
      ended_at: null,
      disposed_liters: null,
      jelantah_income: 0,
      status: 'aktif'
    })
    saveDemo(d)
    return
  }
  const { error } = await sb!.rpc('fill_fryer', { p_fryer_id: fryerId, p_oil_ingredient_id: oilIngredientId, p_liters: liters })
  if (error) throw new Error(error.message)
}

export async function endOilCycle(cycleId: number, disposedLiters: number, jelantahIncome: number): Promise<void> {
  if (isDemo) {
    const d = loadDemo()
    const c = d.oilCycles.find((x) => x.id === cycleId && x.status === 'aktif') ?? err('Siklus tidak ditemukan')
    c.status = 'selesai'
    c.ended_at = new Date().toISOString()
    c.disposed_liters = disposedLiters
    c.jelantah_income = jelantahIncome
    if (jelantahIncome > 0) d.otherIncome.push({ id: ++d.seq, source: 'Penjualan minyak jelantah', amount: jelantahIncome, note: `Siklus minyak #${cycleId}`, earned_at: todayISO() })
    saveDemo(d)
    return
  }
  const { error } = await sb!.rpc('end_oil_cycle', { p_cycle_id: cycleId, p_disposed_liters: disposedLiters, p_jelantah_income: jelantahIncome })
  if (error) throw new Error(error.message)
}

export async function loadFryers(): Promise<{ fryers: Fryer[]; cycles: OilCycle[] }> {
  if (isDemo) {
    const d = loadDemo()
    return { fryers: d.fryers, cycles: d.oilCycles }
  }
  const [f, c] = await Promise.all([sb!.from('fryers').select('*').order('id'), sb!.from('oil_cycles').select('*').order('id', { ascending: false }).limit(50)])
  if (f.error) throw new Error(f.error.message)
  return { fryers: (f.data ?? []) as Fryer[], cycles: (c.data ?? []) as OilCycle[] }
}

export async function saveFryer(f: { id?: number; name: string; capacity_l: number | null }): Promise<void> {
  if (isDemo) {
    const d = loadDemo()
    if (f.id) {
      const x = d.fryers.find((y) => y.id === f.id)
      if (x) {
        x.name = f.name
        x.capacity_l = f.capacity_l
      }
    } else {
      d.fryers.push({ id: ++d.seq, name: f.name, capacity_l: f.capacity_l, is_active: true })
    }
    saveDemo(d)
    return
  }
  if (f.id) {
    const { error } = await sb!.from('fryers').update({ name: f.name, capacity_l: f.capacity_l }).eq('id', f.id)
    if (error) throw new Error(error.message)
  } else {
    const { error } = await sb!.from('fryers').insert({ name: f.name, capacity_l: f.capacity_l })
    if (error) throw new Error(error.message)
  }
}

// ================= Waste & opname =================

export async function logWaste(lines: ({ ingredient_id: number; qty: number } | { product_id: number; qty: number })[], note: string): Promise<void> {
  if (isDemo) {
    const d = loadDemo()
    const { recipeByProduct } = mapsOf(d)
    const ings = new Map(d.ingredients.map((i) => [i.id, i]))
    for (const line of lines) {
      if ('ingredient_id' in line) {
        const ing = ings.get(line.ingredient_id)
        if (ing) ing.stock = Math.max(0, Math.round((ing.stock - line.qty) * 10000) / 10000)
      } else {
        for (const [iid, need] of productNeeds(line.product_id, line.qty, recipeByProduct, ings)) {
          const ing = ings.get(iid)
          if (ing) ing.stock = Math.max(0, Math.round((ing.stock - need) * 10000) / 10000)
        }
      }
    }
    saveDemo(d)
    return
  }
  const { error } = await sb!.rpc('log_waste', { p_lines: lines, p_note: note })
  if (error) throw new Error(error.message)
}

export async function opname(ingredientId: number, actualQty: number): Promise<void> {
  if (isDemo) {
    const d = loadDemo()
    const ing = d.ingredients.find((i) => i.id === ingredientId) ?? err('Bahan tidak ditemukan')
    ing.stock = actualQty
    saveDemo(d)
    return
  }
  const { error } = await sb!.rpc('opname_stock', { p_ingredient_id: ingredientId, p_actual_qty: actualQty, p_note: null })
  if (error) throw new Error(error.message)
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
  const keep = (t: Transaction): boolean =>
    allStatus || t.status === undefined || t.status === 'normal' || t.status === 'refund'
  if (isDemo) {
    const d = loadDemo()
    return d.txs.filter((t) => t.created_at >= fromISO && t.created_at <= toISO && keep(t))
  }
  const { data, error } = await sb!
    .from('transactions')
    .select('*, transaction_items(name, qty, price, hpp), payments(method, amount)')
    .gte('created_at', fromISO)
    .lte('created_at', toISO)
    .order('created_at')
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as Transaction[]).filter(keep)
}

export async function loadShifts(): Promise<Shift[]> {
  if (isDemo) return [...loadDemo().shifts].reverse()
  const { data, error } = await sb!.from('shifts').select('*').order('opened_at', { ascending: false }).limit(60)
  if (error) throw new Error(error.message)
  return (data ?? []) as Shift[]
}

export async function loadFinance(fromISO: string, toISO: string): Promise<{ expenses: Expense[]; expenseCats: ExpenseCategory[]; otherIncome: OtherIncome[] }> {
  if (isDemo) {
    const d = loadDemo()
    return {
      expenses: d.expenses.filter((e) => e.spent_at >= fromISO && e.spent_at <= toISO),
      expenseCats: d.expenseCats,
      otherIncome: d.otherIncome.filter((i) => i.earned_at >= fromISO && i.earned_at <= toISO)
    }
  }
  const [e, c, i] = await Promise.all([
    sb!.from('expenses').select('*').gte('spent_at', fromISO).lte('spent_at', toISO).order('spent_at', { ascending: false }),
    sb!.from('expense_categories').select('*').order('name'),
    sb!.from('other_income').select('*').gte('earned_at', fromISO).lte('earned_at', toISO).order('earned_at', { ascending: false })
  ])
  if (e.error) throw new Error(e.error.message)
  return {
    expenses: (e.data ?? []) as Expense[],
    expenseCats: (c.data ?? []) as ExpenseCategory[],
    otherIncome: (i.data ?? []) as OtherIncome[]
  }
}

export async function addExpense(categoryId: number | null, amount: number, note: string): Promise<void> {
  if (isDemo) {
    const d = loadDemo()
    d.expenses.push({ id: ++d.seq, category_id: categoryId, amount, note, spent_at: todayISO() })
    saveDemo(d)
    return
  }
  const { error } = await sb!.from('expenses').insert({ category_id: categoryId, amount, note: note || null })
  if (error) throw new Error(error.message)
}

export async function addOtherIncome(source: string, amount: number, note: string): Promise<void> {
  if (isDemo) {
    const d = loadDemo()
    d.otherIncome.push({ id: ++d.seq, source, amount, note, earned_at: todayISO() })
    saveDemo(d)
    return
  }
  const { error } = await sb!.from('other_income').insert({ source, amount, note: note || null })
  if (error) throw new Error(error.message)
}

// ================= Foto menu (Supabase Storage) =================

export const MENU_BUCKET = 'menu-photos'

/**
 * Upload foto menu ke bucket publik 'menu-photos' dan balik URL publiknya.
 * Nama file memakai timestamp supaya URL baru tidak ter-cache browser setelah
 * foto diganti. Mode demo: blob tak bisa disimpan di localStorage -> data URL.
 */
export async function uploadProductPhoto(blob: Blob, ext = 'jpg'): Promise<{ url: string; path: string }> {
  if (isDemo) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(fr.result as string)
      fr.onerror = () => reject(new Error('Gagal membaca berkas gambar'))
      fr.readAsDataURL(blob)
    })
    return { url: dataUrl, path: 'demo/' + Date.now() + '.' + ext }
  }
  const path = `menu/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await sb!.storage.from(MENU_BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    cacheControl: '31536000', // nama file selalu baru, boleh di-cache permanen
    upsert: false
  })
  if (error) throw new Error('Upload foto gagal: ' + error.message)
  const { data } = sb!.storage.from(MENU_BUCKET).getPublicUrl(path)
  if (!data?.publicUrl) throw new Error('URL foto tidak tersedia setelah upload')
  return { url: data.publicUrl, path }
}

/** Hapus objek foto dari Storage (abaikan error: objek mungkin sudah tiada). */
export async function removeProductPhoto(photoUrl: string | null | undefined): Promise<void> {
  if (isDemo || !photoUrl) return
  const marker = `/${MENU_BUCKET}/`
  const i = photoUrl.indexOf(marker)
  if (i === -1) return // data URL lama / URL luar: tidak ada yang dihapus
  const path = photoUrl.slice(i + marker.length).split('?')[0]
  const { error } = await sb!.storage.from(MENU_BUCKET).remove([path])
  if (error) console.warn('Hapus foto lama gagal (diabaikan):', error.message)
}

// ================= Master CRUD (admin) =================

export async function upsertProduct(p: { id?: number; name: string; category_id: number | null; price: number; unit: Product['unit']; is_active: boolean; sort: number; photo?: string | null }): Promise<void> {
  if (isDemo) {
    const d = loadDemo()
    if (p.id) {
      const x = d.products.find((y) => y.id === p.id)
      if (x) Object.assign(x, p)
    } else {
      d.products.push({ ...p, id: ++d.seq })
    }
    saveDemo(d)
    return
  }
  // id jangan ikut di UPDATE: kolom id GENERATED ALWAYS, Postgres menolak
  // seluruh baris dengan error 428C9 kalau id dikirim (foto "tidak bisa" diubah).
  const { data, error } = await (p.id
    ? sb!.from('products').update({ ...p, id: undefined }).eq('id', p.id)
    : sb!.from('products').insert(p)
  ).select('id')
  if (error) throw new Error(error.message)
  // tulis master cuma boleh admin (RLS): 0 baris terdampak = ditolak diam-diam
  ensureAdminWrite(data?.length ?? 0, p.id !== undefined)
}

export async function upsertCategory(c: { id?: number; name: string; sort: number }): Promise<void> {
  if (isDemo) {
    const d = loadDemo()
    if (c.id) {
      const x = d.categories.find((y) => y.id === c.id)
      if (x) Object.assign(x, c)
    } else {
      d.categories.push({ ...c, id: ++d.seq })
    }
    saveDemo(d)
    return
  }
  const { data, error } = await (c.id
    ? sb!.from('categories').update({ ...c, id: undefined }).eq('id', c.id)
    : sb!.from('categories').insert(c)
  ).select('id')
  if (error) throw new Error(error.message)
  ensureAdminWrite(data?.length ?? 0, c.id !== undefined)
}

export async function upsertIngredient(i: { id?: number; name: string; code: string | null; kind: 'raw' | 'prepared'; buy_unit: string; pack_content: number; price: number; min_stock: number; active: boolean }): Promise<void> {
  if (isDemo) {
    const d = loadDemo()
    if (i.id) {
      const x = d.ingredients.find((y) => y.id === i.id)
      if (x) Object.assign(x, i)
    } else {
      d.ingredients.push({ ...i, stock: 0, id: ++d.seq })
    }
    saveDemo(d)
    return
  }
  const { data, error } = await (i.id
    ? sb!.from('ingredients').update({ ...i, id: undefined }).eq('id', i.id)
    : sb!.from('ingredients').insert(i)
  ).select('id')
  if (error) throw new Error(error.message)
  ensureAdminWrite(data?.length ?? 0, i.id !== undefined)
}

export async function saveRecipe(productId: number, lines: { kind: 'ingredient' | 'product'; component_id: number; qty: number }[]): Promise<void> {
  if (isDemo) {
    const d = loadDemo()
    d.recipeItems = d.recipeItems.filter((r) => r.product_id !== productId)
    for (const l of lines) d.recipeItems.push({ product_id: productId, kind: l.kind, component_id: l.component_id, qty: l.qty })
    saveDemo(d)
    return
  }
  const del = await sb!.from('recipe_items').delete().eq('product_id', productId)
  if (del.error) throw new Error(del.error.message)
  if (lines.length) {
    const ins = await sb!.from('recipe_items').insert(lines.map((l) => ({ ...l, product_id: productId })))
    if (ins.error) throw new Error(ins.error.message)
  }
}

export async function saveIngredientRecipe(ingredientId: number, lines: { component_id: number; qty: number }[]): Promise<void> {
  if (isDemo) {
    const d = loadDemo()
    d.ingRecipes = d.ingRecipes.filter((r) => r.ingredient_id !== ingredientId)
    for (const l of lines) d.ingRecipes.push({ ingredient_id: ingredientId, component_id: l.component_id, qty: l.qty })
    saveDemo(d)
    return
  }
  const del = await sb!.from('ingredient_recipes').delete().eq('ingredient_id', ingredientId)
  if (del.error) throw new Error(del.error.message)
  if (lines.length) {
    const ins = await sb!.from('ingredient_recipes').insert(lines.map((l) => ({ ...l, ingredient_id: ingredientId })))
    if (ins.error) throw new Error(ins.error.message)
  }
}

export async function saveTargets(targets: { product_id: number; qty: number }[]): Promise<void> {
  if (isDemo) {
    const d = loadDemo()
    d.targets = targets
    saveDemo(d)
    return
  }
  const del = await sb!.from('daily_targets').delete().neq('product_id', 0)
  if (del.error) throw new Error(del.error.message)
  if (targets.length) {
    const ins = await sb!.from('daily_targets').insert(targets)
    if (ins.error) throw new Error(ins.error.message)
  }
}

export async function loadZones(): Promise<{ zones: DeliveryZone[]; outlet: OutletSetting }> {
  if (isDemo) {
    const d = loadDemo()
    return { zones: d.zones, outlet: d.outlet }
  }
  const [z, o] = await Promise.all([sb!.from('delivery_zones').select('*').order('sort'), sb!.from('outlet_settings').select('*').eq('id', 1).single()])
  if (z.error) throw new Error(z.error.message)
  return { zones: (z.data ?? []) as DeliveryZone[], outlet: (o.data ?? { lat: null, lng: null, max_radius_km: 8 }) as OutletSetting }
}

export async function saveZones(zones: { radius_km: number; fee: number }[], outlet: OutletSetting): Promise<void> {
  if (isDemo) {
    const d = loadDemo()
    d.zones = zones.map((z, i) => ({ id: i + 1, radius_km: z.radius_km, fee: z.fee, sort: i }))
    d.outlet = outlet
    saveDemo(d)
    return
  }
  const del = await sb!.from('delivery_zones').delete().neq('id', 0)
  if (del.error) throw new Error(del.error.message)
  if (zones.length) {
    const ins = await sb!.from('delivery_zones').insert(zones.map((z, i) => ({ ...z, sort: i })))
    if (ins.error) throw new Error(ins.error.message)
  }
  const up = await sb!.from('outlet_settings').upsert({ id: 1, ...outlet })
  if (up.error) throw new Error(up.error.message)
}

// ================= Pesanan portal =================

export async function loadPortalOrders(): Promise<PortalOrder[]> {
  if (isDemo) return [...loadDemo().orders].reverse()
  const { data, error } = await sb!
    .from('orders')
    .select('*, order_items(name, qty, price)')
    .order('created_at', { ascending: false })
    .limit(80)
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as PortalOrder[]
}

export type PortalOrderT = PortalOrder

export async function acceptOrder(id: number): Promise<void> {
  if (isDemo) {
    const d = loadDemo()
    const o = d.orders.find((x) => x.id === id)
    if (!o || o.status !== 'menunggu') err('Pesanan tidak dalam status menunggu')
    o.status = 'qris_dikirim'
    saveDemo(d)
    return
  }
  const { error } = await sb!.rpc('accept_order', { p_order_id: id })
  if (error) throw new Error(error.message)
}

export async function rejectOrder(id: number, reason: string): Promise<void> {
  if (isDemo) {
    const d = loadDemo()
    const o = d.orders.find((x) => x.id === id)
    if (!o || o.status !== 'menunggu') err('Pesanan tidak dalam status menunggu')
    o.status = 'ditolak'
    o.reject_reason = reason
    saveDemo(d)
    return
  }
  const { error } = await sb!.rpc('reject_order', { p_order_id: id, p_reason: reason })
  if (error) throw new Error(error.message)
}

export async function verifyOrderPayment(id: number): Promise<void> {
  if (isDemo) {
    const d = loadDemo()
    const o = d.orders.find((x) => x.id === id)
    if (!o || o.status !== 'menunggu_verifikasi') err('Pesanan tidak menunggu verifikasi')
    // buat transaksi delivery dengan potong stok
    const items = o!.items.map((i) => {
      const prod = d.products.find((p) => p.name === i.name)
      return { product_id: prod?.id ?? 0, qty: i.qty }
    })
    o!.status = 'diproses'
    saveDemo(d)
    await demoCreateTx({ orderType: 'delivery', items, payments: [{ method: 'qris', amount: o!.total }], note: `Pesanan portal #${id}` })
    return
  }
  const { error } = await sb!.rpc('verify_order_payment', { p_order_id: id })
  if (error) throw new Error(error.message)
}

export async function setOrderStatus(id: number, status: PortalOrder['status']): Promise<void> {
  if (isDemo) {
    const d = loadDemo()
    const o = d.orders.find((x) => x.id === id)
    if (o) o.status = status
    saveDemo(d)
    return
  }
  const { error } = await sb!.rpc('set_order_status', { p_order_id: id, p_status: status })
  if (error) throw new Error(error.message)
}

// ================= Paket bundling =================

export async function saveBundle(b: { id?: number; name: string; price: number; is_active: boolean }): Promise<void> {
  if (isDemo) {
    const d = loadDemo()
    if (b.id) {
      const x = d.bundles.find((y) => y.id === b.id)
      if (x) Object.assign(x, b)
    } else {
      d.bundles.push({ ...b, id: ++d.seq })
    }
    saveDemo(d)
    return
  }
  // id tidak boleh ikut di UPDATE (GENERATED ALWAYS, error 428C9)
  const { error } = b.id ? await sb!.from('bundles').update({ ...b, id: undefined }).eq('id', b.id) : await sb!.from('bundles').insert(b)
  if (error) throw new Error(error.message)
}

export async function saveBundleItems(bundleId: number, items: { product_id: number; qty: number }[]): Promise<void> {
  if (isDemo) {
    const d = loadDemo()
    const b = d.bundles.find((x) => x.id === bundleId)
    if (b) b.items = items
    saveDemo(d)
    return
  }
  const del = await sb!.from('bundle_items').delete().eq('bundle_id', bundleId)
  if (del.error) throw new Error(del.error.message)
  if (items.length) {
    const ins = await sb!.from('bundle_items').insert(items.map((i) => ({ ...i, bundle_id: bundleId })))
    if (ins.error) throw new Error(ins.error.message)
  }
}

export async function deleteBundle(id: number): Promise<void> {
  if (isDemo) {
    const d = loadDemo()
    d.bundles = d.bundles.filter((b) => b.id !== id)
    saveDemo(d)
    return
  }
  const { error } = await sb!.from('bundles').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ================= API portal customer =================

async function portalRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb!.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

export const portal = {
  async register(phone: string, name: string, pin: string): Promise<{ token: string; name: string }> {
    if (isDemo) {
      const d = loadDemo()
      if (!/^[0-9+ -]{9,17}$/.test(phone)) err('Nomor WhatsApp tidak valid')
      if (!/^[0-9]{6}$/.test(pin)) err('PIN harus 6 angka')
      if (d.customer && d.customer.phone === phone) err('Nomor sudah terdaftar di perangkat ini, silakan masuk')
      const c: DemoCustomer = { id: ++d.seq, phone, name, pin, address: '', lat: null, lng: null, distanceKm: null }
      d.customer = c
      saveDemo(d)
      return { token: 'demo-' + c.id, name }
    }
    return portalRpc('portal_register', { p_phone: phone, p_name: name, p_pin: pin })
  },
  async login(phone: string, pin: string): Promise<{ token: string; name: string }> {
    if (isDemo) {
      const d = loadDemo()
      const c = d.customer
      if (!c || c.phone !== phone || c.pin !== pin) err('Nomor atau PIN salah')
      return { token: 'demo-' + c.id, name: c.name }
    }
    return portalRpc('portal_login', { p_phone: phone, p_pin: pin })
  },
  async profile(token: string): Promise<{ phone: string; name: string; address: string; label: string }> {
    if (isDemo) {
      const d = loadDemo()
      const c = d.customer
      if (!c || 'demo-' + c.id !== token) err('Sesi habis, silakan masuk lagi')
      return { phone: c.phone, name: c.name, address: c.address, label: 'Rumah' }
    }
    return portalRpc('portal_get_profile', { p_token: token })
  },
  async updateProfile(token: string, name: string, address: string): Promise<void> {
    if (isDemo) {
      const d = loadDemo()
      const c = d.customer
      if (!c || 'demo-' + c.id !== token) err('Sesi habis, silakan masuk lagi')
      c.name = name
      c.address = address
      saveDemo(d)
      return
    }
    return portalRpc('portal_update_profile', { p_token: token, p_name: name, p_address: address })
  },
  async changePin(token: string, oldPin: string, newPin: string): Promise<void> {
    if (isDemo) {
      const d = loadDemo()
      const c = d.customer
      if (!c || 'demo-' + c.id !== token) err('Sesi habis, silakan masuk lagi')
      if (c.pin !== oldPin) err('PIN lama salah')
      if (!/^[0-9]{6}$/.test(newPin)) err('PIN baru harus 6 angka')
      c.pin = newPin
      saveDemo(d)
      return
    }
    return portalRpc('portal_change_pin', { p_token: token, p_old_pin: oldPin, p_new_pin: newPin })
  },
  async listAddresses(token: string): Promise<PortalAddress[]> {
    if (isDemo) {
      const d = loadDemo()
      const c = d.customer
      if (!c || 'demo-' + c.id !== token) err('Sesi habis, silakan masuk lagi')
      if (!c.address) return []
      return [{ id: 1, label: 'Rumah', address: c.address, lat: c.lat, lng: c.lng, distance_km: c.distanceKm }]
    }
    return portalRpc('portal_list_addresses', { p_token: token })
  },
  async saveAddress(token: string, id: number | null, label: string, address: string, lat: number | null, lng: number | null): Promise<number> {
    if (isDemo) {
      const d = loadDemo()
      const c = d.customer
      if (!c || 'demo-' + c.id !== token) err('Sesi habis, silakan masuk lagi')
      c.address = address
      if (label === 'Ambil Sendiri') {
        c.lat = null
        c.lng = null
        c.distanceKm = 0
      } else {
        c.lat = lat
        c.lng = lng
        if (lat !== null && lng !== null && d.outlet.lat !== null && d.outlet.lng !== null) {
          c.distanceKm = Math.round(haversineKm(d.outlet.lat, d.outlet.lng, lat, lng) * 100) / 100
        }
      }
      saveDemo(d)
      return 1
    }
    return portalRpc('portal_save_address', { p_token: token, p_id: id, p_label: label, p_address: address, p_lat: lat, p_lng: lng })
  },
  async deleteAddress(token: string, id: number): Promise<void> {
    if (isDemo) return
    return portalRpc('portal_delete_address', { p_token: token, p_id: id })
  },
  async availability(): Promise<Map<number, number>> {
    if (isDemo) {
      const d = loadDemo()
      const { recipeByProduct } = mapsOf(d)
      const ings = new Map(d.ingredients.map((i) => [i.id, i]))
      const m = new Map<number, number>()
      for (const p of d.products.filter((x) => x.is_active)) m.set(p.id, maxAvailableQty(p.id, recipeByProduct, ings))
      return m
    }
    const { data, error } = await sb!.rpc('portal_availability')
    if (error) throw new Error(error.message)
    return new Map((data as { product_id: number; max_qty: number }[]).map((r) => [r.product_id, r.max_qty]))
  },
  async createOrder(token: string, items: { product_id: number; qty: number }[], addressId: number, note: string): Promise<number> {
    if (isDemo) {
      const d = loadDemo()
      const c = d.customer
      if (!c || 'demo-' + c.id !== token) err('Sesi habis, silakan masuk lagi')
      const selfPickup = c.address.startsWith('Ambil Sendiri')
      let subtotal = 0
      for (const it of items) {
        const p = d.products.find((x) => x.id === it.product_id && x.is_active) ?? err('Menu tidak tersedia')
        subtotal += it.qty * p.price
      }
      let fee = 0
      if (!selfPickup) {
        if (c.lat === null || c.lng === null) err('Pilih titik lokasi di peta dulu')
        if (d.outlet.lat === null) err('Titik outlet belum diatur admin')
        const km = haversineKm(d.outlet.lat!, d.outlet.lng!, c.lat!, c.lng!)
        fee = feeForDistance(km, d.zones) ?? err('Lokasi di luar radius pengiriman')
      }
      const id = ++d.seq
      d.orders.push({
        id,
        status: 'menunggu',
        subtotal,
        delivery_fee: fee,
        total: subtotal + fee,
        note: note || null,
        reject_reason: null,
        created_at: new Date().toISOString(),
        items: items.map((it) => {
          const p = d.products.find((x) => x.id === it.product_id)!
          return { name: p.name, qty: it.qty, price: p.price }
        })
      })
      saveDemo(d)
      return id
    }
    return portalRpc('portal_create_order', { p_token: token, p_items: items, p_address_id: addressId, p_note: note || null })
  },
  async orders(token: string): Promise<PortalOrder[]> {
    if (isDemo) {
      const d = loadDemo()
      const c = d.customer
      if (!c || 'demo-' + c.id !== token) return []
      return [...d.orders].reverse()
    }
    const rows = await portalRpc<PortalOrder[]>(
      'portal_get_orders',
      { p_token: token }
    )
    return rows.map((r) => ({ ...r, items: r.items ?? [] }))
  },
  async confirmPaid(token: string, orderId: number): Promise<void> {
    if (isDemo) {
      const d = loadDemo()
      const o = d.orders.find((x) => x.id === orderId)
      if (!o || o.status !== 'qris_dikirim') err('Pesanan tidak bisa dikonfirmasi')
      o.status = 'menunggu_verifikasi'
      saveDemo(d)
      return
    }
    return portalRpc('portal_confirm_paid', { p_token: token, p_order_id: orderId })
  },
  async cancelOrder(token: string, orderId: number): Promise<void> {
    if (isDemo) {
      const d = loadDemo()
      const o = d.orders.find((x) => x.id === orderId)
      if (!o || !['menunggu', 'qris_dikirim'].includes(o.status)) err('Pesanan tidak bisa dibatalkan')
      o.status = 'batal'
      saveDemo(d)
      return
    }
    return portalRpc('portal_cancel_order', { p_token: token, p_order_id: orderId })
  }
}

export interface PortalAddress {
  id: number
  label: string
  address: string
  lat: number | null
  lng: number | null
  distance_km: number | null
}

export function subscribeOrders(cb: () => void): () => void {
  if (isDemo) {
    // Demo: polling ringan. Bunyi hanya saat jumlah pesanan 'menunggu'
    // bertambah — bukan tiap tick, supaya alarm tidak bunyi terus-menerus.
    let last = -1
    const h = window.setInterval(() => {
      const n = loadDemo().orders.filter((o) => o.status === 'menunggu').length
      if (n > 0 && n !== last) cb()
      last = n
    }, 3000)
    return () => window.clearInterval(h)
  }
  const ch = sb!.channel('orders-watch')
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => cb()).subscribe()
  return () => {
    void sb!.removeChannel(ch)
  }
}
