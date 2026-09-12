// Kontrak bersama lapisan data (dipakai db-demo.ts, db-live.ts, dan facade db.ts).
// Aturan bisnis TIDAK ada di sini — hanya tipe, status koneksi, dan cache offline.

import type {
  Bundle,
  Category,
  Ingredient,
  IngredientRecipe,
  OrderType,
  PortalOrder,
  Product,
  RecipeItem,
  Transaction,
  TxStatus
} from './types'

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

export interface SessionInfo {
  email: string
  role: 'admin' | 'kasir'
  name: string
}

export interface RefundResult {
  refund_id: number
  receipt_no: string
  amount: number
  method: string
}

export interface PortalAddress {
  id: number
  label: string
  address: string
  lat: number | null
  lng: number | null
  distance_km: number | null
}

export type PortalOrderT = PortalOrder

export function err(m: string): never {
  throw new Error(m)
}

// ================= Status koneksi & sinkronisasi =================

let online = typeof navigator !== 'undefined' ? navigator.onLine : true

export const currentOnline = (): boolean => online

export function setOnline(v: boolean): void {
  online = v
}

const listeners = new Set<(online: boolean) => void>()
export function onSyncStateChange(fn: (online: boolean) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export function emit(): void {
  listeners.forEach((fn) => fn(online))
}

/** Simpan katalog/shift terakhir ke localStorage — dipakai saat offline. */
export function cachePut(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage penuh — abaikan */
  }
}
export function cacheGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

// ================= Kontrak nota =================

/**
 * Nota mana yang boleh diubah/dihapus/di-refund: hanya yang masih 'normal'.
 * Nota refund (total negatif) dan nota hasil revisi otomatis ikut tersembunyi
 * dari daftar aksi karena statusnya bukan 'normal'.
 */
export function txIsEditable(t: Transaction): boolean {
  return (t.status ?? 'normal') === 'normal' && t.total >= 0
}

/** Status label Indonesia utk ditampilkan di UI. */
export const TX_STATUS_LABEL: Record<TxStatus, string> = {
  normal: '',
  direvisi: 'Direvisi',
  refund: 'Refund',
  batal: 'Batal'
}

export const MENU_BUCKET = 'menu-photos'

// ================= PIN owner =================

/**
 * Aksi sensitif (hapus/refund nota, kelola beban tetap) diminta PIN owner.
 * PIN disimpan ter-hash di server/demo — nilainya tidak pernah dikirim ke client.
 */
export function requireOwnerPin(pin: string | null | undefined): void {
  const p = (pin ?? '').trim()
  if (p.length < 4 || !/\d{4,}/.test(p)) err('PIN owner wajib diisi (minimal 4 digit angka)')
}

/** Hash PIN sederhana utk penyimpanan demo (bukan kriminal-grade; live pakai pgcrypto). */
export async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode('sabana-owner-pin:' + pin)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
