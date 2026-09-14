export type OrderType = 'dinein' | 'takeaway' | 'gofood' | 'grabfood' | 'shopeefood' | 'delivery'

export type DeliveryDayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'
export interface DeliveryDayHours {
  /** "HH:MM"; close "24:00" berarti sampai tengah malam. */
  open: string | null
  close: string | null
  closed: boolean
}
export type DeliveryWeek = Record<DeliveryDayKey, DeliveryDayHours>

export interface Ingredient {
  id: number
  name: string
  code: string | null
  kind: 'raw' | 'prepared'
  buy_unit: string
  pack_content: number
  /** Satuan kecil hasil konversi isi kemasan (mis. pack isi 9 potong -> 'potong'). Kosong = pakai satuan beli. */
  small_unit?: string | null
  /** Hanya di form (tidak tersimpan): teks sementara saat ketik satuan kecil kustom. */
  small_unit_custom?: string
  price: number
  stock: number
  min_stock: number
  active: boolean
}

export interface Category { id: number; name: string; sort: number }

export interface RecipeItem { id?: number; product_id: number; kind: 'ingredient' | 'product'; component_id: number; qty: number }
export interface IngredientRecipe { id?: number; ingredient_id: number; component_id: number; qty: number }

export interface Product {
  id: number
  name: string
  category_id: number | null
  price: number
  unit: 'porsi' | 'potong' | 'ekor' | 'cup' | 'paket'
  is_active: boolean
  sort: number
  photo?: string | null
}

export interface Bundle { id: number; name: string; price: number; is_active: boolean; items?: { product_id: number; qty: number }[] }

export interface Fryer { id: number; name: string; capacity_l: number | null; is_active: boolean }

export interface OilCycle {
  id: number
  fryer_id: number
  oil_ingredient_id: number | null
  oil_liters: number
  oil_cost: number
  fry_count: number
  fried_grams: number
  started_at: string
  ended_at: string | null
  disposed_liters: number | null
  jelantah_income: number
  status: 'aktif' | 'selesai'
}

export interface Shift {
  id: number
  user_id: string | null
  opened_at: string
  closed_at: string | null
  opening_cash: number
  closing_cash: number | null
  expected_cash: number | null
  cash_diff: number | null
  note: string | null
  status: 'buka' | 'tutup'
  /** Uang non-penjualan: modal disetor ke drawer / belanja mendadak dari drawer. */
  cash_in?: number
  cash_out?: number
}

export interface Payment { method: 'cash' | 'qris' | 'transfer'; amount: number }

export type TxStatus = 'normal' | 'direvisi' | 'refund' | 'batal'

export interface Transaction {
  id: number
  receipt_no: string | null
  shift_id: number | null
  user_id: string | null
  order_type: OrderType
  channel_fee: number
  subtotal: number
  discount: number
  total: number
  hpp: number
  note: string | null
  created_at: string
  /** normal = terjual; direvisi = diganti nota baru; refund = uang kembali; batal = salah input */
  status?: TxStatus
  refund_of?: number | null
  refund_amount?: number
  items?: TransactionItem[]
  payments?: Payment[]
}

export interface TransactionItem { name: string; qty: number; price: number; hpp: number }

/**
 * Bill tersimpan (simpan pesanan / bill-in): keranjang kasir yang belum
 * dibayar. Stok baru dikurangi saat bill dibayar (payHeldOrder), bukan saat
 * disimpan — bahan belum keluar sebelum uang masuk.
 */
export interface HeldOrder {
  id: number
  shift_id: number | null
  user_id: string | null
  order_type: OrderType
  items: { product_id: number; name: string; qty: number; price: number }[]
  subtotal: number
  discount: number
  total: number
  note: string | null
  label: string | null
  created_at: string
}

export interface PortalOrder {
  id: number
  status: 'menunggu' | 'ditolak' | 'qris_dikirim' | 'menunggu_verifikasi' | 'diproses' | 'dikirim' | 'selesai' | 'batal'
  subtotal: number
  delivery_fee: number
  total: number
  note: string | null
  reject_reason: string | null
  created_at: string
  items: { name: string; qty: number; price: number; product_id?: number }[]
}

export interface DeliveryZone { id: number; radius_km: number; fee: number }

export interface OutletSetting { lat: number | null; lng: number | null; max_radius_km: number }

export interface Expense { id: number; category_id: number | null; amount: number; note: string | null; spent_at: string }
export interface ExpenseCategory { id: number; name: string }
export interface OtherIncome { id: number; source: string; amount: number; note: string | null; earned_at: string }

export interface Settings {
  store: { name: string; tagline: string; address: string; phone: string; footer: string }
  shift: { float_cash: number }
  channels: Record<'gofood' | 'grabfood' | 'shopeefood', { fee: number }>
  oil: { max_days: number; max_fry_count: number }
  margin: { warn_pct: number }
  receipt: { width_mm: number; show_cashier: boolean; show_channel: boolean; header: string; footer: string; show_qr: boolean }
  qris: { image: string }
  portal: { secret: string; outlet_note: string; delivery_enabled: boolean; delivery_schedule?: DeliveryWeek | null }
  owner_email: { email: string; whatsapp: string }
  /** Mode cetak: 'bt' Web Bluetooth langsung, 'rawbt' lewat dialog printer sistem (RawBT). */
  printer: { auto_print: boolean; mode?: 'bt' | 'rawbt' }
  tablet: { keep_awake: boolean; fullscreen: boolean; card_size?: 'normal' | 'besar' }
  fixed_costs: { name: string; amount: number }[]
  /** Kategori pengeluaran dikelola owner di menu Keuangan (bukan tabel terpisah). */
  expense_categories?: { id: number; name: string }[]
  /** True setelah owner menetapkan PIN (PIN-nya sendiri tidak pernah dikirim ke client). */
  owner_pin_set?: boolean
  /** Hanya ada di mode demo: hash SHA-256 PIN untuk verifikasi lokal. */
  owner_pin_hash?: string
}

export interface Availability { productId: number; maxQty: number }

export interface DailyTarget { product_id: number; qty: number }
