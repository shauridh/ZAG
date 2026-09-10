// Antrean transaksi offline (localStorage).
// Pure module: tidak import db.ts supaya tidak ada siklus — db.ts yang
// memanggil modul ini dan mengorkestrasi sinkronisasi ke Supabase.
import type { OrderType } from './types'

export interface QueuedTx {
  id: string
  orderType: OrderType
  items: { product_id: number; qty: number }[]
  /** Nama & harga utk struk provisional saat offline (dari keranjang kasir). */
  itemsDisplay?: { name: string; qty: number; price: number }[]
  payments: { method: 'cash' | 'qris' | 'transfer'; amount: number }[]
  discount?: number
  note?: string
  queuedAt: string
  attempts: number
  lastError?: string
}

const LS_KEY = 'sabana-tx-queue-v1'
export const QUEUE_EVENT = 'sabana-queue-changed'

export function readQueue(): QueuedTx[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as QueuedTx[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeQueue(q: QueuedTx[]): void {
  localStorage.setItem(LS_KEY, JSON.stringify(q))
  window.dispatchEvent(new CustomEvent(QUEUE_EVENT, { detail: { count: q.length } }))
}

export function queueCount(): number {
  return readQueue().length
}

let seqCounter = 0

export function enqueueTx(p: Omit<QueuedTx, 'id' | 'queuedAt' | 'attempts'>): QueuedTx {
  const entry: QueuedTx = {
    ...p,
    id: `off-${Date.now()}-${++seqCounter}`,
    queuedAt: new Date().toISOString(),
    attempts: 0
  }
  writeQueue([...readQueue(), entry])
  return entry
}

export function removeQueued(id: string): void {
  writeQueue(readQueue().filter((e) => e.id !== id))
}

export function markAttempt(id: string, errMsg: string): void {
  writeQueue(readQueue().map((e) => (e.id === id ? { ...e, attempts: e.attempts + 1, lastError: errMsg } : e)))
}

/** Error jaringan → layak dicoba lagi. Error bisnis (stok kurang, dsb.) → bukan. */
export function isNetworkError(ex: unknown): boolean {
  const msg = String((ex as Error)?.message ?? ex ?? '').toLowerCase()
  return (
    msg.includes('fetch') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('Failed to fetch') ||
    msg.includes('load failed') ||
    msg === ''
  )
}
