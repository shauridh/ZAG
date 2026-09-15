// Adapter DEMO lapisan data: seluruh aturan bisnis dijalankan lokal di
// localStorage supaya aplikasi bisa dipakai/dites tanpa server Supabase.
// Aturan yang sama di produksi hidup di RPC (supabase/migrations); unit test
// memegang demo tetap setia menirunya.

import type {
  Bundle,
  Category,
  DeliveryZone,
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
  TransactionItem,
  HeldOrder,
  DemoBatch,
  BatchHistoryItem,
  PackBreakdownItem,
  StockAdjustment,
  StockMove
} from './types'
import { ingredientNeeds, maxAvailableQty, productNeeds, rawNeedsCost, ingIndex, recipeIndexBy, ingRecipeIndexBy, type IngById, type RecipeByProduct } from './hpp'
import { feeForDistance, haversineKm } from './geo'
import { fmtRpPlain } from './money'
import { txCashNet } from './reports'
import { todayISO } from './dates'
import { type Catalog, type TxResult, type SessionInfo, type RefundResult, type PortalAddress, err, txIsEditable, hashPin } from './db-shared'

// ================= Penyimpanan demo =================

export interface DemoCustomer {
  id: number
  phone: string
  name: string
  pin: string
  address: string
  /** label alamat portal ('Rumah'/'Kantor'/'Kos'/'Ambil Sendiri'); default sebelum label ada di UI. */
  addressLabel?: string
  lat: number | null
  lng: number | null
  distanceKm: number | null
}

export interface DemoData {
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
  heldOrders: HeldOrder[]
  /** Riwayat batch produksi (audit dapur): output + satuan asal + waktu. */
  batches: DemoBatch[]
  /** Penyesuaian stok bahan (opname) yang bisa diedit/dihapus. */
  stockAdjustments: StockAdjustment[]
  /** Ledger audit: semua pergerakan stok (pembelian/produksi/penjualan/waste/opname). */
  stockMoves: StockMove[]
  /** Penomoran ledger (terpisah dari seq master). */
  moveSeq?: number
  /** Penomoran pembelian utk ref ledger PO*. */
  purchaseSeq?: number
  session: { email: string; role: 'admin' | 'kasir'; name: string } | null
  seq: number
}

const LS_KEY = 'sabana-demo-v3'

/**
 * Foto demo per id produk: SVG emoji di public/demo (regenerate dengan
 * `python scripts/make-demo-photos.py`). Demo jadi kelihatan hidup tanpa
 * upload manual; foto asli tetap bisa ditimpa lewat Menu & Paket.
 */
const DEMO_PHOTOS: Record<number, string> = {
  1: '/demo/ayam-dada.svg',
  2: '/demo/ayam-paha-atas.svg',
  3: '/demo/ayam-paha-bawah.svg',
  4: '/demo/ayam-sayap.svg',
  5: '/demo/ayam-ekor.svg',
  7: '/demo/nasi-putih.svg',
  8: '/demo/chicken-katsu.svg',
  9: '/demo/chicken-roll.svg',
  12: '/demo/kulit-crispy.svg',
  13: '/demo/kentang-goreng.svg',
  16: '/demo/sambal-geprek.svg',
  20: '/demo/saos-mentai.svg',
  27: '/demo/teh-botol.svg'
}

const DEMO_VERSION = 11

function defaultDemo(): DemoData {
  const d: DemoData = {
    v: DEMO_VERSION,
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
      printer: { auto_print: false, mode: 'bt' },
      tablet: { keep_awake: true, fullscreen: false, card_size: 'besar' },
      owner_pin_set: false,
      owner_pin_hash: undefined,
      expense_categories: [
        { id: 1, name: 'Bahan Baku' },
        { id: 2, name: 'Gas & Listrik' },
        { id: 3, name: 'Gaji' },
        { id: 4, name: 'Sewa' },
        { id: 5, name: 'Lainnya' }
      ],
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
    // small_unit: satuan kecil hasil konversi isi kemasan — dipakai resep langsung.
    ingredients: [
      {
        id: 1,
        name: 'Ayam Potong 9',
        code: '100001',
        kind: 'raw',
        buy_unit: 'pack',
        small_unit: 'potong',
        pack_content: 9,
        price: 5333,
        stock: 12,
        min_stock: 6,
        active: true,
        // komposisi 1 pack — kasir/dapur tahu berapa sayap/paha/dada yg bisa dijual
        pack_breakdown: [
          { name: 'Sayap', qty: 2 },
          { name: 'Paha Atas', qty: 2 },
          { name: 'Paha Bawah', qty: 2 },
          { name: 'Dada', qty: 3 }
        ]
      },
      { id: 3, name: 'Tepung Bumbu Fried Chicken', code: '200001', kind: 'raw', buy_unit: 'pack', small_unit: 'gram', pack_content: 1000, price: 24, stock: 2000, min_stock: 2000, active: true },
      { id: 4, name: 'Minyak Goreng Sunco 2L', code: '200002', kind: 'raw', buy_unit: 'pouch', small_unit: 'liter', pack_content: 2, price: 21700, stock: 8, min_stock: 4, active: true },
      { id: 5, name: 'Gas 3 kg', code: '', kind: 'raw', buy_unit: 'tabung', small_unit: '', pack_content: 1, price: 23000, stock: 2, min_stock: 1, active: true },
      { id: 6, name: 'Kemasan Ayam (ikat 100)', code: '200011', kind: 'raw', buy_unit: 'pack', small_unit: 'lembar', pack_content: 100, price: 235, stock: 150, min_stock: 100, active: true },
      { id: 7, name: 'Kantong Plastik (pack 50)', code: '200023', kind: 'raw', buy_unit: 'pack', small_unit: 'pcs', pack_content: 50, price: 140, stock: 100, min_stock: 50, active: true },
      { id: 8, name: 'Sauce Cup 35ml (pack 50)', code: '200022', kind: 'raw', buy_unit: 'pack', small_unit: 'cup', pack_content: 50, price: 300, stock: 50, min_stock: 50, active: true },
      { id: 9, name: 'Kertas Nasi (pack 100)', code: '200013', kind: 'raw', buy_unit: 'pack', small_unit: 'lembar', pack_content: 100, price: 130, stock: 100, min_stock: 100, active: true },
      { id: 10, name: 'Box Nasi Standard (pack 100)', code: '200014', kind: 'raw', buy_unit: 'pack', small_unit: 'pcs', pack_content: 100, price: 1250, stock: 100, min_stock: 100, active: true },
      { id: 11, name: 'Beras Mentik Wangi', code: '100006', kind: 'raw', buy_unit: 'kg', small_unit: '', pack_content: 1, price: 16500, stock: 20, min_stock: 10, active: true },
      { id: 12, name: 'Saus Sambal Sabana (pack 125)', code: '200007', kind: 'raw', buy_unit: 'pack', small_unit: 'sachet', pack_content: 125, price: 180, stock: 250, min_stock: 125, active: true },
      { id: 13, name: 'Sambal Geprek 500g', code: '200019', kind: 'raw', buy_unit: 'pouch 500g', small_unit: 'gram', pack_content: 500, price: 128, stock: 1000, min_stock: 1000, active: true },
      { id: 17, name: 'Saos Keju Mentai 500g', code: '200030', kind: 'raw', buy_unit: 'pouch 500g', small_unit: 'gram', pack_content: 500, price: 54, stock: 1000, min_stock: 500, active: true },
      { id: 26, name: 'Chicken Katsu', code: '200059', kind: 'raw', buy_unit: 'pcs', small_unit: 'pcs', pack_content: 1, price: 4500, stock: 10, min_stock: 10, active: true },
      { id: 27, name: 'Kentang Simplot', code: '200043', kind: 'raw', buy_unit: 'pack', small_unit: 'gram', pack_content: 2720, price: 42, stock: 2720, min_stock: 500, active: true },
      { id: 32, name: 'Box Kentang (pack 200)', code: '200018', kind: 'raw', buy_unit: 'pack', small_unit: 'pcs', pack_content: 200, price: 599, stock: 200, min_stock: 200, active: true },
      { id: 35, name: 'Sendok Garpu (pack 50)', code: '200051', kind: 'raw', buy_unit: 'pack', small_unit: 'pcs', pack_content: 50, price: 200, stock: 50, min_stock: 50, active: true },
      { id: 37, name: 'Sayuran (timun/selada)', code: '', kind: 'raw', buy_unit: 'porsi', small_unit: '', pack_content: 1, price: 1000, stock: 30, min_stock: 10, active: true },
      { id: 40, name: 'Teh Botol Sosro 250ml', code: '200038', kind: 'raw', buy_unit: 'pcs', small_unit: 'pcs', pack_content: 1, price: 2500, stock: 24, min_stock: 12, active: true },
      { id: 50, name: 'Ayam Marinasi (per potong)', code: '', kind: 'prepared', buy_unit: 'potong', small_unit: '', pack_content: 1, price: 0, stock: 18, min_stock: 9, active: true },
      { id: 52, name: 'Sambal Geprek Cup', code: '', kind: 'prepared', buy_unit: 'cup', small_unit: '', pack_content: 1, price: 0, stock: 6, min_stock: 5, active: true },
      { id: 56, name: 'Saos Mentai Cup', code: '', kind: 'prepared', buy_unit: 'cup', small_unit: '', pack_content: 1, price: 0, stock: 8, min_stock: 5, active: true }
    ],
    bundles: [],
    recipeItems: [],
    ingRecipes: [
      { ingredient_id: 50, component_id: 1, qty: 1 },
      { ingredient_id: 52, component_id: 13, qty: 25 }, // 25 gram sambal (pouch 500 gr)
      { ingredient_id: 52, component_id: 4, qty: 0.0122 },
      { ingredient_id: 52, component_id: 8, qty: 1 },
      { ingredient_id: 56, component_id: 17, qty: 25 }, // 25 gram mentai
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
    heldOrders: [],
    batches: [],
    stockAdjustments: [],
    stockMoves: [],
    moveSeq: 0,
    session: null,
    seq: 100
  }
  for (const p of d.products) p.photo = DEMO_PHOTOS[p.id] ?? null
  return d
}

// Resep demo produk ringkas (mirip seed SQL versi lengkap)
function seedDemoRecipes(d: DemoData) {
  // Qty resep memakai SATUAN KECIL bahan (potong/gram/liter/sachet/lembar/pcs).
  const perPotong: [number, number][] = [
    [50, 1],
    [3, 37.04], // tepung gram (pack isi 1000 gr)
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
    [3, 333.33], // tepung gram
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
    [27, 120], // kentang gram per porsi
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
      if (d.v === DEMO_VERSION) return d
      if (d.v === 3) {
        // v3 -> v4: data demo lama dapat foto demo tanpa perlu reset
        for (const p of d.products) p.photo ??= DEMO_PHOTOS[p.id] ?? null
        d.v = 4
      }
      if (d.v === 4) {
        // v4 -> v5: resepi lama memakai satuan dasar lama; seed bahan baru dgn
        // satuan kecil & isi kemasan resmi (price list). Paling aman: mulai baru.
        const fresh = defaultDemo()
        seedDemoRecipes(fresh)
        fresh.session = d.session
        saveDemo(fresh)
        return fresh
      }
      if (d.v === 5) {
        // v5 -> v6: stok bahan kemasan di-seed dlm pack, padahal konvensi stok =
        // satuan kecil. Skalakan stock & min_stock dgn isi kemasan.
        const scale = new Set([3, 6, 7, 8, 9, 10, 12, 13, 17, 32, 35])
        for (const i of d.ingredients)
          if (scale.has(i.id)) {
            i.stock *= i.pack_content || 1
            i.min_stock *= i.pack_content || 1
          }
        d.v = 6
        saveDemo(d)
        return d
      }
      if (d.v === 6) {
        // v6 -> v7: simpan pesanan (bill). Data lama tidak punya daftar bill.
        d.heldOrders ??= []
        d.v = 7
        saveDemo(d)
        return d
      }
      if (d.v === 7) {
        // v7 -> v8: riwayat batch produksi (audit dapur). Data lama tidak punya.
        d.batches ??= []
        d.v = 8
        saveDemo(d)
        return d
      }
      if (d.v === 8) {
        // v8 -> v9: komposisi potongan per kemasan (pack_breakdown) — null utk yg belum dirinci;
        // bahan ayam potong demo langsung diisi contoh 2 sayap + 2 paha atas + 2 paha bawah + 3 dada.
        for (const i of d.ingredients)
          if (i.pack_breakdown === undefined) i.pack_breakdown = null
        const ayam = d.ingredients.find((x) => x.name.toLowerCase().includes('ayam potong 9'))
        if (ayam && !ayam.pack_breakdown)
          ayam.pack_breakdown = [
            { name: 'Sayap', qty: 2 },
            { name: 'Paha Atas', qty: 2 },
            { name: 'Paha Bawah', qty: 2 },
            { name: 'Dada', qty: 3 }
          ]
        d.v = 9
        saveDemo(d)
        return d
      }
      if (d.v === 9) {
        // v9 -> v10: penyesuaian stok jadi CRUD. Data lama tidak punya riwayat
        // penyesuaian (opname lama langsung mengubah stok) — mulai kosong.
        d.stockAdjustments ??= []
        d.v = 10
        saveDemo(d)
        return d
      }
      if (d.v === 10) {
        // v10 -> v11: ledger audit pergerakan stok. Pergerakan lama tidak
        // direkam ulang (tidak bisa direkonstruksi tanpa snapshot) — mulai kosong.
        d.stockMoves ??= []
        d.moveSeq ??= 0
        d.v = 11
        saveDemo(d)
        return d
      }
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

// ================= Helper resep & stok demo =================

function mapsOf(d: DemoData) {
  return { recipeByProduct: recipeIndexBy(d.recipeItems), ingRecipes: ingRecipeIndexBy(d.ingRecipes) }
}

/** Kebutuhan bahan (level stok: prepared tetap daun) untuk daftar item produk. */
function needsOfItems(items: { product_id: number; qty: number }[], recipeByProduct: RecipeByProduct, ings: IngById): Map<number, number> {
  const out = new Map<number, number>()
  for (const it of items)
    for (const [iid, need] of productNeeds(it.product_id, it.qty, recipeByProduct, ings))
      out.set(iid, (out.get(iid) ?? 0) + need)
  return out
}

/** Kebutuhan bahan dari item nota tersimpan (items hanya menyimpan nama menu). */
function needsOfTxItems(d: DemoData, items: TransactionItem[], recipeByProduct: RecipeByProduct, ings: IngById): Map<number, number> {
  const out = new Map<number, number>()
  for (const it of items) {
    const prod = d.products.find((p) => p.name === it.name)
    if (!prod) continue
    for (const [iid, need] of productNeeds(prod.id, it.qty, recipeByProduct, ings))
      out.set(iid, (out.get(iid) ?? 0) + need)
  }
  return out
}

/**
 * Terapkan kebutuhan bahan ke stok: dipotong (default) atau dikembalikan;
 * opsional di-clamp ke nol (rusak). `move` = catat tiap perubahan ke ledger
 * audit (stock_moves) dengan jenis & ref sumber — paritas dgn live.
 */
function moveStock(d: DemoData, needs: Map<number, number>, opts: { add?: boolean; clampZero?: boolean; move?: { kind: StockMove['kind']; ref: string | null; note?: string | null } } = {}): void {
  for (const [iid, need] of needs) {
    const ing = d.ingredients.find((i) => i.id === iid)
    if (!ing) continue
    const before = ing.stock
    const next = opts.add ? ing.stock + need : ing.stock - need
    ing.stock = Math.round((opts.clampZero ? Math.max(0, next) : next) * 10000) / 10000
    const actual = Math.round((ing.stock - before) * 10000) / 10000
    if (opts.move && actual !== 0)
      d.stockMoves.unshift({
        id: (d.moveSeq = (d.moveSeq ?? 0) + 1),
        ingredient_id: iid,
        ingredient_name: ing.name,
        qty: actual,
        kind: opts.move.kind,
        ref: opts.move.ref,
        note: opts.move.note ?? null,
        created_at: new Date().toISOString()
      })
  }
}

/** Tulis satu baris ledger utk perubahan stok satu bahan. */
function logMove(d: DemoData, ing: Ingredient, qty: number, kind: StockMove['kind'], ref: string | null = null, note: string | null = null): void {
  d.stockMoves.unshift({
    id: (d.moveSeq = (d.moveSeq ?? 0) + 1),
    ingredient_id: ing.id,
    ingredient_name: ing.name,
    qty: Math.round(qty * 10000) / 10000,
    kind,
    ref,
    note,
    created_at: new Date().toISOString()
  })
}

/** Stok kembali sesuai resep item nota (refund / batal / revisi); opsional dicatat ke ledger. */
function returnStockOfTxItems(d: DemoData, items: TransactionItem[], recipeByProduct?: RecipeByProduct, ings?: IngById, move?: { kind: StockMove['kind']; ref: string | null; note?: string | null }): void {
  const rb = recipeByProduct ?? mapsOf(d).recipeByProduct
  const ig = ings ?? ingIndex(d.ingredients)
  moveStock(d, needsOfTxItems(d, items, rb, ig), { add: true, move })
}

// ================= Katalog & settings (demo) =================

export function demoLoadCatalog(): Catalog {
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

export function demoLoadSettings(): Settings {
  return loadDemo().settings
}

export function demoSaveSetting(key: string, value: unknown): void {
  const d = loadDemo()
  ;(d.settings as unknown as Record<string, unknown>)[key] = value
  saveDemo(d)
}

/** Owner menetapkan PIN: disimpan hanya sebagai hash + flag (PIN tak pernah tersimpan mentah). */
export async function demoSetOwnerPin(pin: string): Promise<void> {
  const d = loadDemo()
  d.settings.owner_pin_hash = await hashPin(pin)
  d.settings.owner_pin_set = true
  saveDemo(d)
}

// ================= Auth (demo) =================

export function demoSignIn(email: string, password: string): SessionInfo {
  if (!email.includes('@')) err('Masukkan email yang benar')
  if (password.length < 4) err('Kata sandi minimal 4 karakter (mode demo bebas)')
  const role = email.startsWith('admin') ? 'admin' : 'kasir'
  const d = loadDemo()
  d.session = { email, role, name: role === 'admin' ? 'Pemilik' : 'Kasir' }
  saveDemo(d)
  return d.session
}

export function demoSignOut(): void {
  const d = loadDemo()
  d.session = null
  saveDemo(d)
}

export function demoCurrentSession(): SessionInfo | null {
  return loadDemo().session
}

// ================= Transaksi kasir (demo) =================

export function demoCreateTx(p: {
  orderType: OrderType
  items: { product_id: number; qty: number }[]
  payments: { method: 'cash' | 'qris' | 'transfer'; amount: number }[]
  discount?: number
  /** true = terima stok minus (kasir memaksa jual menu habis); bahan stoknya tetap berkurang. */
  allowNegativeStock?: boolean
  note?: string
}): TxResult {
  return createTxIn(loadDemo(), p)
}

/**
 * Inti create_tx di atas dataset yang sudah dimuat — supaya alur lain
 * (mis. bayar bill tersimpan) bisa menjalankan aturan bisnis yang sama
 * tanpa load/save ulang yang menimpa perubahan dataset terbaru.
 */
function createTxIn(d: DemoData, p: {
  orderType: OrderType
  items: { product_id: number; qty: number }[]
  payments: { method: 'cash' | 'qris' | 'transfer'; amount: number }[]
  discount?: number
  /** true = terima stok minus (kasir memaksa jual menu habis). */
  allowNegativeStock?: boolean
  note?: string
}): TxResult {
  const { recipeByProduct, ingRecipes } = mapsOf(d)
  const online = p.orderType === 'gofood' || p.orderType === 'grabfood' || p.orderType === 'shopeefood'

  let shift: Shift | undefined
  if (!online) {
    shift = d.shifts.find((s) => s.status === 'buka')
    if (!shift) err('Buka shift dulu sebelum menjual')
  }

  // validasi kecukupan stok — allowNegativeStock = kasir sadar habis & memaksa (dapur produksi dadakan)
  const ings = ingIndex(d.ingredients)
  const totalNeed = needsOfItems(p.items, recipeByProduct, ings)
  for (const [iid, need] of totalNeed) {
    const ing = ings.get(iid)
    if (ing && ing.stock < need && !p.allowNegativeStock) err(`Stok kurang: ${ing.name} (butuh ${need.toFixed(2)}, tersedia ${ing.stock.toFixed(2)})`)
  }

  let subtotal = 0
  let hpp = 0
  const itemNames: { name: string; qty: number; price: number }[] = []
  for (const it of p.items) {
    const prod = d.products.find((x) => x.id === it.product_id) ?? err('Menu tidak ditemukan')
    subtotal += Math.round(it.qty * prod.price)
    // daun resep prepared diekspansi ke bahan mentahnya untuk biaya
    hpp += rawNeedsCost(it.product_id, it.qty, recipeByProduct, ingRecipes, ings)
    itemNames.push({ name: prod.name, qty: it.qty, price: prod.price })
  }
  const discount = p.discount ?? 0
  const total = subtotal - discount
  const paid = p.payments.reduce((s, x) => s + x.amount, 0)
  if (!online && paid < total) err('Pembayaran kurang dari total')
  const fee = online ? Math.round((subtotal * d.settings.channels[p.orderType as 'gofood' | 'grabfood' | 'shopeefood'].fee) / 100) : 0

  // potong stok (+ catat ledger penjualan; ref diisi setelah id nota diketahui)
  const txid = d.seq + 1
  moveStock(d, totalNeed, { move: { kind: 'penjualan', ref: 'TX' + txid } })

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

// ================= Riwayat: refund / batal / revisi (demo) =================

export async function demoRefundTx(txId: number, reason: string, ownerPin: string): Promise<RefundResult> {
  const d = loadDemo()
  if (!(d.settings.owner_pin_set ?? false) || !d.settings.owner_pin_hash) err('PIN owner belum diatur di menu Keuangan')
  if ((await hashPin(ownerPin)) !== d.settings.owner_pin_hash) err('PIN owner salah')
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
  // stok kembali sesuai resep produk asli (ledger 'refund', paritas dgn live)
  returnStockOfTxItems(d, tx.items ?? [], undefined, undefined, { kind: 'refund', ref: 'TX' + id })
  tx.status = 'refund'
  saveDemo(d)
  return { refund_id: id, receipt_no: refundTx.receipt_no!, amount, method }
}

export async function demoDeleteTx(txId: number, reason: string, ownerPin: string): Promise<void> {
  const d = loadDemo()
  if (!(d.settings.owner_pin_set ?? false) || !d.settings.owner_pin_hash) err('PIN owner belum diatur di menu Keuangan')
  if ((await hashPin(ownerPin)) !== d.settings.owner_pin_hash) err('PIN owner salah')
  const tx = d.txs.find((t) => t.id === txId) ?? err('Transaksi tidak ditemukan')
  if (!txIsEditable(tx)) err('Transaksi sudah diproses sebelumnya')
  returnStockOfTxItems(d, tx.items ?? [], undefined, undefined, { kind: 'batal', ref: 'TX' + txId })
  tx.status = 'batal'
  tx.note = [tx.note, `Dibatalkan: ${reason.trim() || 'tanpa alasan'}`].filter(Boolean).join(' ')
  saveDemo(d)
}

export function demoEditTx(txId: number, items: { product_id: number; qty: number }[], discount: number, note: string): number {
  const d = loadDemo()
  const tx = d.txs.find((t) => t.id === txId) ?? err('Transaksi tidak ditemukan')
  if (!txIsEditable(tx)) err('Transaksi sudah diproses sebelumnya')
  if (items.length === 0) err('Nota revisi minimal punya 1 item')
  const { recipeByProduct, ingRecipes } = mapsOf(d)
  const ings = ingIndex(d.ingredients)

  // validasi kecukupan stok utk nota baru
  const totalNeed = needsOfItems(items, recipeByProduct, ings)

  // hitung subtotal & hpp nota baru (harga dari data, bukan client)
  let subtotal = 0
  let hpp = 0
  const itemNames: TransactionItem[] = []
  for (const it of items) {
    const prod = d.products.find((x) => x.id === it.product_id) ?? err('Menu tidak ditemukan')
    subtotal += Math.round(it.qty * prod.price)
    // daun resep prepared diekspansi ke bahan mentahnya untuk biaya
    hpp += rawNeedsCost(it.product_id, it.qty, recipeByProduct, ingRecipes, ings)
    itemNames.push({ name: prod.name, qty: it.qty, price: prod.price, hpp: 0 })
  }
  const total = subtotal - discount
  if (total < 0) err('Total tidak boleh negatif')
  const paid = (tx.payments ?? []).reduce((s, p) => s + p.amount, 0)
  const online = tx.order_type === 'gofood' || tx.order_type === 'grabfood' || tx.order_type === 'shopeefood'
  if (!online && paid < total) err(`Total revisi ${fmtRpPlain(total)} melebihi uang yang sudah dibayar ${fmtRpPlain(paid)}`)
  // stok efektif = stok sekarang + pengembalian dari nota lama
  const oldReturn = needsOfTxItems(d, tx.items ?? [], recipeByProduct, ings)
  for (const [iid, need] of totalNeed) {
    const ing = ings.get(iid)
    if (ing && ing.stock + (oldReturn.get(iid) ?? 0) < need) err(`Stok kurang: ${ing.name}`)
  }

  // kembalikan stok nota lama (ledger 'revisi'), lalu potong stok nota baru
  // (ledger 'penjualan' dgn ref nota revisi) — paritas dgn RPC edit_transaction.
  returnStockOfTxItems(d, tx.items ?? [], recipeByProduct, ings, { kind: 'revisi', ref: 'TX' + txId })
  moveStock(d, totalNeed, { move: { kind: 'penjualan', ref: 'TX' + (d.seq + 1) } })

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

// ================= Shift (demo) =================

export function demoOpenShift(openingCash: number): number {
  const d = loadDemo()
  if (d.shifts.some((s) => s.status === 'buka')) err('Masih ada shift yang terbuka')
  const floatCash = d.settings.shift.float_cash
  if (openingCash < floatCash) err(`Modal awal kurang dari float kembalian wajib ${floatCash.toLocaleString('id-ID')}`)
  const id = ++d.seq
  d.shifts.push({ id, user_id: null, opened_at: new Date().toISOString(), closed_at: null, opening_cash: openingCash, closing_cash: null, expected_cash: null, cash_diff: null, note: null, status: 'buka', cash_in: 0, cash_out: 0 })
  saveDemo(d)
  return id
}

/** Uang non-penjualan masuk/keluar drawer selama shift (setoran modal, belanja mendadak). */
export function demoShiftCashMovement(direction: 'in' | 'out', amount: number, note = ''): void {
  void note // dicatat hanya di UI; penyimpanan demo tidak punya tabel jurnal kas
  const d = loadDemo()
  const shift = d.shifts.find((s) => s.status === 'buka') ?? err('Tidak ada shift terbuka')
  if (!Number.isFinite(amount) || amount <= 0) err('Nominal harus lebih dari 0')
  if (direction === 'in') {
    shift.cash_in = (shift.cash_in ?? 0) + amount
  } else {
    const drawerNow = shift.opening_cash + (shift.cash_in ?? 0) - (shift.cash_out ?? 0)
    if (drawerNow - amount < d.settings.shift.float_cash) err('Drawer akan kurang dari float kembalian wajib, tidak bisa keluarkan uang')
    shift.cash_out = (shift.cash_out ?? 0) + amount
  }
  saveDemo(d)
}

export function demoCloseShift(closingCash: number, note: string): { cash_sales: number; expected_cash: number; cash_diff: number; opening_cash: number; cash_in: number; cash_out: number } {
  const d = loadDemo()
  const shift = d.shifts.find((s) => s.status === 'buka') ?? err('Tidak ada shift terbuka')
  const floatCash = d.settings.shift.float_cash
  if (closingCash < floatCash) err(`Kas drawer kurang dari float wajib ${floatCash.toLocaleString('id-ID')}, tidak bisa tutup shift`)
  // Penjualan tunai = uang diterima MINUS kembalian (lihat txCashNet di reports).
  // Refund tunai berupa payment negatif — ikut mengurangi kas.
  const cashSales = d.txs
    .filter((t) => t.shift_id === shift.id)
    .filter((t) => (t.status ?? 'normal') === 'normal' || t.status === 'refund')
    .reduce((s, t) => s + txCashNet(t), 0)
  const cashIn = shift.cash_in ?? 0
  const cashOut = shift.cash_out ?? 0
  const expected = shift.opening_cash + cashSales + cashIn - cashOut
  const diff = closingCash - expected
  if (diff < 0 && !note.trim()) err(`Kas kurang Rp ${(-diff).toLocaleString('id-ID')}, wajib isi catatan kejadian`)
  shift.closed_at = new Date().toISOString()
  shift.closing_cash = closingCash
  shift.expected_cash = expected
  shift.cash_diff = diff
  shift.note = note
  shift.status = 'tutup'
  saveDemo(d)
  return { cash_sales: cashSales, expected_cash: expected, cash_diff: diff, opening_cash: shift.opening_cash, cash_in: cashIn, cash_out: cashOut }
}

export function demoCurrentShift(): Shift | null {
  return loadDemo().shifts.find((s) => s.status === 'buka') ?? null
}

// ================= Pembelian, produksi, fryer (demo) =================

export function demoCreatePurchase(lines: { ingredient_id: number; packs: number; unit_cost: number }[], note = ''): void {
  const d = loadDemo()
  const pid = (d.purchaseSeq ?? 0) + 1
  d.purchaseSeq = pid
  for (const l of lines) {
    const ing = d.ingredients.find((i) => i.id === l.ingredient_id) ?? err('Bahan tidak ditemukan')
    ing.stock = Math.round((ing.stock + l.packs * ing.pack_content) * 10000) / 10000
    // TANPA round: harga per satuan kecil pecahan utuh — harga kemasan yang
    // diinput harus kembali persis saat ditampilkan (price × pack_content).
    ing.price = l.unit_cost / (ing.pack_content || 1)
    logMove(d, ing, l.packs * ing.pack_content, 'pembelian', 'PO' + pid, note || null)
  }
  saveDemo(d)
}

export function demoCreateBatch(p: { outputs: { ingredient_id: number; qty: number; origin_unit?: 'buy' }[]; fryer_id: number | null; fried_grams: number; note?: string }): void {
  const d = loadDemo()
  const { ingRecipes } = mapsOf(d)
  for (const o of p.outputs)
    // Bahan output TANPA resep = output langsung: stok bertambah tanpa memotong apa pun.
    // (Sebelumnya dihitung mengonsumsi dirinya sendiri → net nol / ditolak "bahan kurang".)
    for (const [iid, need] of ingredientNeeds(o.ingredient_id, o.qty, ingRecipes)) {
      const ing = d.ingredients.find((i) => i.id === iid)
      if (ing && ing.stock < need) err(`Bahan kurang: ${ing.name} (butuh ${need.toFixed(2)}, tersedia ${ing.stock.toFixed(2)})`)
    }
  let cycle: OilCycle | undefined
  if (p.fryer_id) {
    cycle = d.oilCycles.find((c) => c.fryer_id === p.fryer_id && c.status === 'aktif')
    if (!cycle) err('Fryer belum diisi minyak (isi fryer dulu)')
  }
  const bid = (d.batches[0]?.id ?? 0) + 1
  for (const o of p.outputs) {
    const out = d.ingredients.find((i) => i.id === o.ingredient_id)
    if (out) {
      out.stock = Math.round((out.stock + o.qty) * 10000) / 10000
      logMove(d, out, o.qty, 'produksi', 'PR' + bid, p.note ?? null)
    }
    for (const [iid, need] of ingredientNeeds(o.ingredient_id, o.qty, ingRecipes)) {
      const ing = d.ingredients.find((i) => i.id === iid)
      if (ing) {
        ing.stock = Math.round((ing.stock - need) * 10000) / 10000
        logMove(d, ing, -need, 'produksi', 'PR' + bid, p.note ?? null)
      }
    }
  }
  if (cycle) {
    cycle.fry_count += 1
    cycle.fried_grams += p.fried_grams
  }
  // riwayat batch utk audit dapur (simpan nama saat ini; bahan dihapus → tetap tampil "#id")
  d.batches.unshift({
    id: (d.batches[0]?.id ?? 0) + 1,
    created_at: new Date().toISOString(),
    note: p.note || null,
    items: p.outputs.map((o) => ({ ingredient_id: o.ingredient_id, qty: o.qty, origin_unit: o.origin_unit ?? null }))
  })
  if (d.batches.length > 50) d.batches.length = 50
  saveDemo(d)
}

export function demoLoadBatches(limit = 20): BatchHistoryItem[] {
  const d = loadDemo()
  return d.batches.slice(0, limit).map((b) => ({
    id: b.id,
    created_at: b.created_at,
    note: b.note,
    items: b.items.map((it) => {
      const ing = d.ingredients.find((i) => i.id === it.ingredient_id)
      return { ingredient_id: it.ingredient_id, name: ing?.name ?? `#${it.ingredient_id}`, qty: it.qty, origin_unit: it.origin_unit ?? null }
    })
  }))
}

export function demoFillFryer(fryerId: number, oilIngredientId: number, liters: number): void {
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
}

export function demoEndOilCycle(cycleId: number, disposedLiters: number, jelantahIncome: number): void {
  const d = loadDemo()
  const c = d.oilCycles.find((x) => x.id === cycleId && x.status === 'aktif') ?? err('Siklus tidak ditemukan')
  c.status = 'selesai'
  c.ended_at = new Date().toISOString()
  c.disposed_liters = disposedLiters
  c.jelantah_income = jelantahIncome
  if (jelantahIncome > 0) d.otherIncome.push({ id: ++d.seq, source: 'Penjualan minyak jelantah', amount: jelantahIncome, note: `Siklus minyak #${cycleId}`, earned_at: todayISO() })
  saveDemo(d)
}

export function demoLoadFryers(): { fryers: Fryer[]; cycles: OilCycle[] } {
  const d = loadDemo()
  return { fryers: d.fryers, cycles: d.oilCycles }
}

export function demoSaveFryer(f: { id?: number; name: string; capacity_l: number | null }): void {
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
}

// ================= Waste & opname (demo) =================

export function demoLogWaste(lines: ({ ingredient_id: number; qty: number } | { product_id: number; qty: number })[], note = ''): void {
  const d = loadDemo()
  const { recipeByProduct } = mapsOf(d)
  const ings = ingIndex(d.ingredients)
  for (const line of lines) {
    if ('ingredient_id' in line) {
      const ing = ings.get(line.ingredient_id)
      if (ing) {
        const before = ing.stock
        ing.stock = Math.max(0, Math.round((ing.stock - line.qty) * 10000) / 10000)
        logMove(d, ing, ing.stock - before, 'waste', null, note || null)
      }
    } else {
      moveStock(d, needsOfItems([line], recipeByProduct, ings), { clampZero: true, move: { kind: 'waste', ref: null, note: note || null } })
    }
  }
  saveDemo(d)
}

/** Opname lama (tanpa record CRUD): disetel langsung; tetap dicatat di ledger. */
export function demoOpname(ingredientId: number, actualQty: number): void {
  const d = loadDemo()
  const ing = d.ingredients.find((i) => i.id === ingredientId) ?? err('Bahan tidak ditemukan')
  const diff = Math.round((actualQty - ing.stock) * 10000) / 10000
  ing.stock = actualQty
  if (diff !== 0) logMove(d, ing, diff, 'opname')
  saveDemo(d)
}

// ================= Penyesuaian stok (CRUD, demo) =================

/**
 * Penyesuaian stok bahan (opname/koreksi) sebagai record CRUD: stok disetel ke
 * qty fisik baru, record menyimpan nilai baru + sebelumnya + catatan — bisa
 * diedit/dihapus kemudian (update menyesuaikan delta stok terkini).
 */
export function demoCreateStockAdjustment(ingredientId: number, qty: number, note: string): number {
  const d = loadDemo()
  const ing = d.ingredients.find((i) => i.id === ingredientId) ?? err('Bahan tidak ditemukan')
  const prev = ing.stock
  ing.stock = Math.round(qty * 10000) / 10000
  const adj: StockAdjustment = {
    id: (d.stockAdjustments[0]?.id ?? 0) + 1,
    ingredient_id: ingredientId,
    ingredient_name: ing.name,
    qty: ing.stock,
    prev_qty: prev,
    note: note.trim() || null,
    created_at: new Date().toISOString()
  }
  d.stockAdjustments.unshift(adj)
  logMove(d, ing, Math.round((ing.stock - prev) * 10000) / 10000, 'opname', 'ADJ' + adj.id, adj.note)
  saveDemo(d)
  return adj.id
}

/** Riwayat penyesuaian terbaru (nama tercatat saat input; bahan dihapus tetap tampil). */
export function demoLoadStockAdjustments(limit = 30): StockAdjustment[] {
  const d = loadDemo()
  return d.stockAdjustments.slice(0, limit)
}

/**
 * Ledger audit pergerakan stok: filter bahan (opsional) + rentang tanggal
 * (ISO lengkap, konvensi sama dgn loadTransactions). Terbaru dulu.
 */
export function demoLoadStockMoves(opts: { ingredientId?: number; fromISO: string; toISO: string; limit?: number }): StockMove[] {
  const d = loadDemo()
  return d.stockMoves
    .filter((m) => m.created_at >= opts.fromISO && m.created_at <= opts.toISO)
    .filter((m) => !opts.ingredientId || m.ingredient_id === opts.ingredientId)
    .slice(0, opts.limit ?? 500)
}

/** Edit penyesuaian: stok terkini digeser selisih (qty baru - qty lama); baris ledger ADJ* ikut digeser. */
export function demoUpdateStockAdjustment(id: number, qty: number, note: string): void {
  const d = loadDemo()
  const adj = d.stockAdjustments.find((a) => a.id === id) ?? err('Penyesuaian tidak ditemukan')
  const ing = d.ingredients.find((i) => i.id === adj.ingredient_id)
  if (ing) ing.stock = Math.round((ing.stock - adj.qty + qty) * 10000) / 10000
  const delta = Math.round((qty - adj.qty) * 10000) / 10000
  adj.qty = Math.round(qty * 10000) / 10000
  adj.note = note.trim() || null
  const mv = d.stockMoves.find((m) => m.ref === 'ADJ' + id && m.kind === 'opname')
  if (mv) {
    mv.qty = Math.round((mv.qty + delta) * 10000) / 10000
    mv.note = adj.note
  }
  saveDemo(d)
}

/** Hapus penyesuaian: stok dikembalikan ke nilai sebelum penyesuaian; baris ledger ADJ* ikut dihapus. */
export function demoDeleteStockAdjustment(id: number): void {
  const d = loadDemo()
  const idx = d.stockAdjustments.findIndex((a) => a.id === id)
  if (idx === -1) err('Penyesuaian tidak ditemukan')
  const [adj] = d.stockAdjustments.splice(idx, 1)
  const ing = d.ingredients.find((i) => i.id === adj.ingredient_id)
  if (ing) ing.stock = Math.round((ing.stock - adj.qty + adj.prev_qty) * 10000) / 10000
  d.stockMoves = d.stockMoves.filter((m) => !(m.ref === 'ADJ' + id && m.kind === 'opname'))
  saveDemo(d)
}

// ================= Laporan (demo) =================

export function demoLoadTransactions(fromISO: string, toISO: string, allStatus = false): Transaction[] {
  const keep = (t: Transaction): boolean =>
    allStatus || t.status === undefined || t.status === 'normal' || t.status === 'refund'
  const d = loadDemo()
  return d.txs.filter((t) => t.created_at >= fromISO && t.created_at <= toISO && keep(t))
}

export function demoLoadShifts(): Shift[] {
  return [...loadDemo().shifts].reverse()
}

export function demoLoadFinance(fromISO: string, toISO: string): { expenses: Expense[]; expenseCats: ExpenseCategory[]; otherIncome: OtherIncome[] } {
  const d = loadDemo()
  return {
    expenses: d.expenses.filter((e) => e.spent_at >= fromISO && e.spent_at <= toISO),
    // kategori dari settings (dikelola owner di Keuangan) menang; seed lama cuma fallback
    expenseCats: d.settings.expense_categories ?? d.expenseCats,
    otherIncome: d.otherIncome.filter((i) => i.earned_at >= fromISO && i.earned_at <= toISO)
  }
}

export function demoAddExpense(categoryId: number | null, amount: number, note: string): void {
  const d = loadDemo()
  d.expenses.push({ id: ++d.seq, category_id: categoryId, amount, note, spent_at: todayISO() })
  saveDemo(d)
}

export function demoAddOtherIncome(source: string, amount: number, note: string): void {
  const d = loadDemo()
  d.otherIncome.push({ id: ++d.seq, source, amount, note, earned_at: todayISO() })
  saveDemo(d)
}

// ================= Foto menu (demo: data URL) =================

export async function demoUploadProductPhoto(blob: Blob, ext = 'jpg'): Promise<{ url: string; path: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result as string)
    fr.onerror = () => reject(new Error('Gagal membaca berkas gambar'))
    fr.readAsDataURL(blob)
  })
  return { url: dataUrl, path: 'demo/' + Date.now() + '.' + ext }
}

// ================= Master CRUD (demo) =================

export function demoUpsertProduct(p: { id?: number; name: string; category_id: number | null; price: number; unit: Product['unit']; is_active: boolean; sort: number; photo?: string | null }): void {
  const d = loadDemo()
  if (p.id) {
    const x = d.products.find((y) => y.id === p.id)
    if (x) Object.assign(x, p)
  } else {
    d.products.push({ ...p, id: ++d.seq })
  }
  saveDemo(d)
}

export function demoUpsertCategory(c: { id?: number; name: string; sort: number }): void {
  const d = loadDemo()
  if (c.id) {
    const x = d.categories.find((y) => y.id === c.id)
    if (x) Object.assign(x, c)
  } else {
    d.categories.push({ ...c, id: ++d.seq })
  }
  saveDemo(d)
}

export function demoUpsertIngredient(i: { id?: number; name: string; code: string | null; kind: 'raw' | 'prepared'; buy_unit: string; small_unit?: string | null; pack_content: number; price: number; min_stock: number; active: boolean; pack_breakdown?: PackBreakdownItem[] | null }): void {
  const d = loadDemo()
  if (i.id) {
    const x = d.ingredients.find((y) => y.id === i.id)
    if (x) Object.assign(x, i)
  } else {
    d.ingredients.push({ ...i, stock: 0, id: ++d.seq })
  }
  saveDemo(d)
}

/** Hapus bahan; ditolak bila sudah dipakai resep — suruh nonaktifkan. */
export function demoDeleteIngredient(id: number): void {
  const d = loadDemo()
  const ing = d.ingredients.find((x) => x.id === id) ?? err('Bahan tidak ditemukan')
  const used = d.recipeItems.some((r) => r.kind === 'ingredient' && r.component_id === id) || d.ingRecipes.some((r) => r.component_id === id)
  if (used) err(`Bahan ${ing.name} sudah terpakai di resep. Nonaktifkan saja lewat tombol Edit.`)
  d.ingredients = d.ingredients.filter((x) => x.id !== id)
  d.ingRecipes = d.ingRecipes.filter((r) => r.ingredient_id !== id)
  saveDemo(d)
}

// ================= Impor price list & reset mulai dari nol (demo) =================

/** Sama dgn RPC import_price_list: upsert per kode; harga = harga kemasan / isi. */
export function demoImportPriceList(
  items: { code: string; name: string; buy_unit: string; pack_content: number; pack_price: number; small_unit: string }[],
  replace: boolean
): { created: number; updated: number } {
  const d = loadDemo()
  if (replace) demoDeleteAllMasterIn(d)
  let created = 0
  let updated = 0
  for (const it of items) {
    const name = it.name.trim()
    if (!name) continue
    const code = it.code.trim() || null
    const content = Math.max(it.pack_content || 1, 0.0001)
    // TANPA round: pecahan utuh, paritas dgn RPC live 0016
    const price = it.pack_price / content
    const found = code ? d.ingredients.find((x) => x.code && x.code === code) : undefined
    if (!found) {
      d.ingredients.push({
        id: ++d.seq,
        name,
        code,
        kind: 'raw',
        buy_unit: it.buy_unit.trim() || 'pack',
        small_unit: it.small_unit.trim() || null,
        pack_content: content,
        price,
        stock: 0,
        min_stock: 0,
        active: true
      })
      created++
    } else {
      found.name = name
      found.buy_unit = it.buy_unit.trim() || 'pack'
      found.pack_content = content
      found.price = price
      found.small_unit = it.small_unit.trim() || found.small_unit
      updated++
    }
  }
  saveDemo(d)
  return { created, updated }
}

/** Sama dgn RPC delete_all_master: kosongkan master (dipanggil setelah riwayat bersih). */
function demoDeleteAllMasterIn(d: DemoData): void {
  d.targets = []
  d.recipeItems = []
  d.ingRecipes = []
  d.bundles = []
  d.ingredients = []
  d.products = []
  d.fryers = []
}

/**
 * Sama dgn RPC reset_operational_data: kosongkan SEMUA data operasional + master
 * supaya produksi mulai dari nol. Pengaturan toko & sesi login tidak disentuh.
 */
export function demoResetOperationalData(): void {
  const d = loadDemo()
  d.txs = []
  d.shifts = []
  d.orders = []
  d.heldOrders = []
  d.expenses = []
  d.otherIncome = []
  d.expenseCats = []
  d.oilCycles = []
  d.customer = null
  demoDeleteAllMasterIn(d)
  saveDemo(d)
}

/** Sama dgn RPC clear_owner_pin: lupa PIN -> hapus supaya bisa diset ulang. */
export function demoClearOwnerPin(): void {
  const d = loadDemo()
  d.settings.owner_pin_hash = undefined
  d.settings.owner_pin_set = false
  saveDemo(d)
}

/** Hapus menu; ditolak bila sudah pernah terjual/dipakai resep/paket — suruh nonaktifkan. */
export function demoDeleteProduct(id: number): void {
  const d = loadDemo()
  const prod = d.products.find((x) => x.id === id) ?? err('Menu tidak ditemukan')
  const used = d.recipeItems.some((r) => r.component_id === id) || d.bundles.some((b) => (b.items ?? []).some((it) => it.product_id === id))
  if (used) err(`Menu ${prod.name} sudah terpakai di resep/paket. Nonaktifkan saja lewat tombol Edit.`)
  d.products = d.products.filter((x) => x.id !== id)
  d.recipeItems = d.recipeItems.filter((r) => r.product_id !== id)
  d.targets = d.targets.filter((t) => t.product_id !== id)
  saveDemo(d)
}

export function demoSaveRecipe(productId: number, lines: { kind: 'ingredient' | 'product'; component_id: number; qty: number }[]): void {
  const d = loadDemo()
  d.recipeItems = d.recipeItems.filter((r) => r.product_id !== productId)
  for (const l of lines) d.recipeItems.push({ product_id: productId, kind: l.kind, component_id: l.component_id, qty: l.qty })
  saveDemo(d)
}

export function demoSaveIngredientRecipe(ingredientId: number, lines: { component_id: number; qty: number }[]): void {
  const d = loadDemo()
  d.ingRecipes = d.ingRecipes.filter((r) => r.ingredient_id !== ingredientId)
  for (const l of lines) d.ingRecipes.push({ ingredient_id: ingredientId, component_id: l.component_id, qty: l.qty })
  saveDemo(d)
}

export function demoSaveTargets(targets: { product_id: number; qty: number }[]): void {
  const d = loadDemo()
  d.targets = targets
  saveDemo(d)
}

export function demoLoadZones(): { zones: DeliveryZone[]; outlet: OutletSetting } {
  const d = loadDemo()
  return { zones: d.zones, outlet: d.outlet }
}

export function demoSaveZones(zones: { radius_km: number; fee: number }[], outlet: OutletSetting): void {
  const d = loadDemo()
  d.zones = zones.map((z, i) => ({ id: i + 1, radius_km: z.radius_km, fee: z.fee, sort: i }))
  d.outlet = outlet
  saveDemo(d)
}

// ================= Pesanan portal (demo) =================

/** Cari pesanan portal di dataset yang sudah dimuat (tanpa load/save ulang). */
function dOrdersFind(d: DemoData, id: number): PortalOrder | undefined {
  return d.orders.find((x) => x.id === id)
}

export function demoLoadPortalOrders(): PortalOrder[] {
  return [...loadDemo().orders].reverse()
}

export function demoAcceptOrder(id: number): void {
  const d = loadDemo()
  const o = d.orders.find((x) => x.id === id)
  if (!o || o.status !== 'menunggu') err('Pesanan tidak dalam status menunggu')
  o.status = 'qris_dikirim'
  saveDemo(d)
}export function demoRejectOrder(id: number, reason: string): void {
  const d = loadDemo()
  const o = d.orders.find((x) => x.id === id)
  if (!o || o.status !== 'menunggu') err('Pesanan tidak dalam status menunggu')
  o.status = 'ditolak'
  o.reject_reason = reason
  saveDemo(d)
}

/**
 * Tolak pesanan portal, termasuk yang sudah bayar ('menunggu_verifikasi') —
 * misalnya stok habis saat pelanggan sudah transfer. Status verifikasi masih
 * SEBELUM potong stok, jadi di sini aman: tidak ada stok yang perlu dilepas.
 */
export function demoRejectPaidOrder(id: number, reason: string): void {
  const d = loadDemo()
  const o = dOrdersFind(d, id)
  if (!o || !['menunggu', 'menunggu_verifikasi'].includes(o.status)) err('Pesanan tidak bisa ditolak pada status ini')
  o.status = 'ditolak'
  o.reject_reason = reason
  saveDemo(d)
}

export function demoVerifyOrderPayment(id: number): void {
  const d = loadDemo()
  const o = dOrdersFind(d, id)
  if (!o || o.status !== 'menunggu_verifikasi') err('Pesanan tidak menunggu verifikasi')
  // mapping item per product_id (bukan nama — menu bisa di-rename setelah pesanan)
  const items = o.items.map((i) => {
    const prod = d.products.find((p) => p.id === i.product_id) ?? d.products.find((p) => p.name === i.name) ?? err(`Menu "${i.name}" sudah tidak ada — pesanan tak bisa diverifikasi`)
    return { product_id: prod.id, qty: i.qty }
  })
  // transaksi DULU di SATU dataset (validasi stok + potong stok + simpan atomik),
  // baru status diganti. Kalau stok kurang: err sebelum save — pesanan tetap
  // menunggu verifikasi & kasir bisa menolak, bukan stuck 'diproses'.
  // (Pakai createTxIn, bukan demoCreateTx: load/save ulang di tengah akan
  // menimpa dataset dengan salinan basi — bug yang sama yang dulu hilangkan
  // transaksi bill.)
  createTxIn(d, { orderType: 'delivery', items, payments: [{ method: 'qris', amount: o.total }], note: `Pesanan portal #${id}` })
  o.status = 'diproses'
  saveDemo(d)
}

const ALLOWED_STATUS_FLOW: Record<PortalOrder['status'], PortalOrder['status'][]> = {
  // Paritas dgn RPC set_order_status (0009): kasir hanya majukan status
  // proses kirim. Transisi lain lewat fungsi khusus: accept/reject/verify,
  // dan batal pelanggan lewat cancelOrder (status sebelum potong stok).
  menunggu: [],
  qris_dikirim: [],
  menunggu_verifikasi: [],
  diproses: ['dikirim'],
  dikirim: ['selesai'],
  selesai: [],
  ditolak: [],
  batal: []
}

/**
 * Transisi status oleh kasir (dikirim/selesai). Penjaga arah: status tak bisa
 * dimundurkan/dilompat — yang sudah potong stok ('diproses' dst) tak mungkin
 * jadi 'batal' dari sini (pembatalan pelanggan sudah dicegah di cancelOrder).
 */
export function demoSetOrderStatus(id: number, status: PortalOrder['status']): void {
  const d = loadDemo()
  const o = dOrdersFind(d, id)
  if (!o) err('Pesanan tidak ditemukan')
  if (!ALLOWED_STATUS_FLOW[o.status].includes(status)) err(`Transisi tidak sah: ${o.status} → ${status}`)
  o.status = status
  saveDemo(d)
}

// ================= Paket bundling (demo) =================

export function demoSaveBundle(b: { id?: number; name: string; price: number; is_active: boolean }): void {
  const d = loadDemo()
  if (b.id) {
    const x = d.bundles.find((y) => y.id === b.id)
    if (x) Object.assign(x, b)
  } else {
    d.bundles.push({ ...b, id: ++d.seq })
  }
  saveDemo(d)
}

export function demoSaveBundleItems(bundleId: number, items: { product_id: number; qty: number }[]): void {
  const d = loadDemo()
  const b = d.bundles.find((x) => x.id === bundleId)
  if (b) b.items = items
  saveDemo(d)
}

export function demoDeleteBundle(id: number): void {
  const d = loadDemo()
  d.bundles = d.bundles.filter((b) => b.id !== id)
  saveDemo(d)
}

// ================= API portal customer (demo) =================

export const demoPortal = {
  register(phone: string, name: string, pin: string): { token: string; name: string } {
    const d = loadDemo()
    if (!/^[0-9+ -]{9,17}$/.test(phone)) err('Nomor WhatsApp tidak valid')
    if (!/^[0-9]{6}$/.test(pin)) err('PIN harus 6 angka')
    if (d.customer && d.customer.phone === phone) err('Nomor sudah terdaftar di perangkat ini, silakan masuk')
    const c: DemoCustomer = { id: ++d.seq, phone, name, pin, address: '', lat: null, lng: null, distanceKm: null }
    d.customer = c
    saveDemo(d)
    return { token: 'demo-' + c.id, name }
  },
  login(phone: string, pin: string): { token: string; name: string } {
    const d = loadDemo()
    const c = d.customer
    if (!c || c.phone !== phone || c.pin !== pin) err('Nomor atau PIN salah')
    return { token: 'demo-' + c.id, name: c.name }
  },
  profile(token: string): { phone: string; name: string; address: string; label: string } {
    const d = loadDemo()
    const c = d.customer
    if (!c || 'demo-' + c.id !== token) err('Sesi habis, silakan masuk lagi')
    return { phone: c.phone, name: c.name, address: c.address, label: 'Rumah' }
  },
  updateProfile(token: string, name: string, address: string): void {
    const d = loadDemo()
    const c = d.customer
    if (!c || 'demo-' + c.id !== token) err('Sesi habis, silakan masuk lagi')
    c.name = name
    c.address = address
    saveDemo(d)
  },
  changePin(token: string, oldPin: string, newPin: string): void {
    const d = loadDemo()
    const c = d.customer
    if (!c || 'demo-' + c.id !== token) err('Sesi habis, silakan masuk lagi')
    if (c.pin !== oldPin) err('PIN lama salah')
    if (!/^[0-9]{6}$/.test(newPin)) err('PIN baru harus 6 angka')
    c.pin = newPin
    saveDemo(d)
  },
  listAddresses(token: string): PortalAddress[] {
    const d = loadDemo()
    const c = d.customer
    if (!c || 'demo-' + c.id !== token) err('Sesi habis, silakan masuk lagi')
    if (!c.address) return []
    return [{ id: 1, label: c.addressLabel ?? 'Rumah', address: c.address, lat: c.lat, lng: c.lng, distance_km: c.distanceKm }]
  },
  saveAddress(token: string, _id: number | null, label: string, address: string, lat: number | null, lng: number | null): number {
    const d = loadDemo()
    const c = d.customer
    if (!c || 'demo-' + c.id !== token) err('Sesi habis, silakan masuk lagi')
    c.address = address
    c.addressLabel = label
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
  },
  deleteAddress(): void {
    // demo: satu alamat, tidak ada yang bisa dihapus
  },
  availability(): Map<number, number> {
    const d = loadDemo()
    const { recipeByProduct } = mapsOf(d)
    const ings = ingIndex(d.ingredients)
    const m = new Map<number, number>()
    for (const p of d.products.filter((x) => x.is_active)) m.set(p.id, maxAvailableQty(p.id, recipeByProduct, ings))
    return m
  },
  createOrder(token: string, items: { product_id: number; qty: number }[], _addressId: number, note: string): number {
    const d = loadDemo()
    const c = d.customer
    if (!c || 'demo-' + c.id !== token) err('Sesi habis, silakan masuk lagi')
    const selfPickup = c.addressLabel === 'Ambil Sendiri' || c.address === 'Ambil di outlet'
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
        return { name: p.name, qty: it.qty, price: p.price, product_id: p.id }
      })
    })
    saveDemo(d)
    return id
  },
  orders(token: string): PortalOrder[] {
    const d = loadDemo()
    const c = d.customer
    if (!c || 'demo-' + c.id !== token) return []
    return [...d.orders].reverse()
  },
  confirmPaid(_token: string, orderId: number): void {
    const d = loadDemo()
    const o = d.orders.find((x) => x.id === orderId)
    if (!o || o.status !== 'qris_dikirim') err('Pesanan tidak bisa dikonfirmasi')
    o.status = 'menunggu_verifikasi'
    saveDemo(d)
  },
  cancelOrder(_token: string, orderId: number): void {
    const d = loadDemo()
    const o = d.orders.find((x) => x.id === orderId)
    if (!o || !['menunggu', 'qris_dikirim'].includes(o.status)) err('Pesanan tidak bisa dibatalkan')
    o.status = 'batal'
    saveDemo(d)
  }
}

// ================= Langganan pesanan (demo: polling) =================

export function demoSubscribeOrders(cb: () => void): () => void {
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

// ================= Simpan pesanan / bill (pembayaran nanti) =================

export function demoSaveHeldOrder(p: {
  orderType: OrderType
  items: { product_id: number; name: string; qty: number; price: number }[]
  subtotal: number
  discount: number
  total: number
  note: string | null
  label: string | null
}): HeldOrder {
  const d = loadDemo()
  const shift = d.shifts.find((s) => s.status === 'buka')
  if (!shift) err('Buka shift dulu sebelum menyimpan pesanan')
  if (p.items.length === 0) err('Keranjang kosong')
  const held: HeldOrder = {
    id: ++d.seq,
    shift_id: shift.id,
    user_id: null,
    order_type: p.orderType,
    items: p.items,
    subtotal: p.subtotal,
    discount: p.discount,
    total: p.total,
    note: p.note,
    label: p.label,
    created_at: new Date().toISOString()
  }
  d.heldOrders.push(held)
  saveDemo(d)
  return held
}

export function demoLoadHeldOrders(): HeldOrder[] {
  return loadDemo().heldOrders.slice().sort((a, b) => a.created_at.localeCompare(b.created_at))
}

/**
 * Bayar bill tersimpan: buat transaksi (stok dipotong di sini, aturan sama
 * dgn create_tx) lalu hapus bill — semuanya di SATU dataset supaya tidak ada
 * penulisan lama yang menimpa transaksi/stok baru. Kalau transaksi gagal,
 * bill tetap ada.
 */
export function demoPayHeldOrder(
  heldId: number,
  method: 'cash' | 'qris' | 'transfer',
  amount: number,
  discountOverride?: number
): TxResult {
  const d = loadDemo()
  const held = d.heldOrders.find((h) => h.id === heldId) ?? err('Bill tidak ditemukan (mungkin sudah dibayar)')
  const tx = createTxIn(d, {
    orderType: held.order_type,
    items: held.items.map((i) => ({ product_id: i.product_id, qty: i.qty })),
    payments: [{ method, amount }],
    discount: discountOverride ?? held.discount,
    note: held.note ?? undefined
  })
  d.heldOrders = d.heldOrders.filter((h) => h.id !== heldId)
  saveDemo(d)
  return tx
}

/** Void bill: batal tanpa jadi transaksi, stok tidak tersentuh. */
export function demoVoidHeldOrder(heldId: number): void {
  const d = loadDemo()
  if (!d.heldOrders.some((h) => h.id === heldId)) err('Bill tidak ditemukan (mungkin sudah dibayar)')
  d.heldOrders = d.heldOrders.filter((h) => h.id !== heldId)
  saveDemo(d)
}
