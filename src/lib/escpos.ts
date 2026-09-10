import { fmtRpPlain } from './money'
import type { Settings } from './types'

export interface ReceiptData {
  storeName: string
  address: string
  phone: string
  receiptNo: string
  cashier: string
  orderType: string
  datetime: string
  items: { name: string; qty: number; price: number }[]
  subtotal: number
  discount: number
  total: number
  payments: { method: string; amount: number }[]
  footer: string
}

export const CHANNEL_LABEL: Record<string, string> = {
  dinein: 'Makan di tempat',
  takeaway: 'Bungkus',
  gofood: 'GoFood',
  grabfood: 'GrabFood',
  shopeefood: 'ShopeeFood',
  delivery: 'Delivery Sendiri'
}

export const METHOD_LABEL: Record<string, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  transfer: 'Transfer'
}

/** Lebar struk dalam karakter sesuai kertas. */
export function charsFor(widthMm: number): number {
  return widthMm >= 80 ? 42 : 30
}

function center(s: string, w: number): string {
  if (s.length >= w) return s.slice(0, w)
  const left = Math.floor((w - s.length) / 2)
  return ' '.repeat(left) + s
}

function line(ch: string, w: number): string {
  return ch.repeat(w)
}

function row(left: string, right: string, w: number): string {
  const r = right.length > w ? right.slice(0, w) : right
  const l = left.length > w - r.length ? left.slice(0, w - r.length) : left
  return l + ' '.repeat(w - l.length - r.length) + r
}

/** Struk versi teks (untuk ESC/POS ke printer Bluetooth). */
export function buildReceiptText(d: ReceiptData, widthMm = 58): string {
  const w = charsFor(widthMm)
  const out: string[] = []
  out.push(center(d.storeName.toUpperCase(), w))
  if (d.address) out.push(center(d.address, w))
  if (d.phone) out.push(center('Telp. ' + d.phone, w))
  out.push(line('-', w))
  out.push(row(d.receiptNo, d.datetime, w))
  if (d.cashier) out.push('Kasir: ' + d.cashier)
  out.push(d.orderType)
  out.push(line('-', w))
  for (const it of d.items) {
    out.push(it.name.slice(0, w))
    out.push(row(`  ${it.qty} x ${fmtRpPlain(it.price)}`, fmtRpPlain(it.qty * it.price), w))
  }
  out.push(line('-', w))
  out.push(row('Subtotal', fmtRpPlain(d.subtotal), w))
  if (d.discount > 0) out.push(row('Diskon', '-' + fmtRpPlain(d.discount), w))
  out.push(row('TOTAL', fmtRpPlain(d.total), w))
  for (const p of d.payments) out.push(row(METHOD_LABEL[p.method] ?? p.method, fmtRpPlain(p.amount), w))
  const paid = d.payments.reduce((s, p) => s + p.amount, 0)
  if (paid > d.total) out.push(row('Kembali', fmtRpPlain(paid - d.total), w))
  out.push(line('-', w))
  if (d.footer) out.push(center(d.footer, w))
  out.push('')
  return out.join('\n')
}

/** Struk versi HTML untuk preview & fallback print dialog. */
export function buildReceiptHtml(d: ReceiptData, widthMm = 58): string {
  const wpx = widthMm >= 80 ? 300 : 220
  const itemRows = d.items
    .map(
      (it) => `<tr>
        <td colspan="2" class="nm">${it.name}</td>
        <td class="r">${it.qty}x${fmtRpPlain(it.price)}</td>
        <td class="r">${fmtRpPlain(it.qty * it.price)}</td></tr>`
    )
    .join('')
  const payRows = d.payments
    .map(
      (p) =>
        `<tr><td colspan="3">${METHOD_LABEL[p.method] ?? p.method}</td><td class="r">${fmtRpPlain(p.amount)}</td></tr>`
    )
    .join('')
  const paid = d.payments.reduce((s, p) => s + p.amount, 0)
  return `<div style="font-family:'Courier New',monospace;font-size:11px;width:${wpx}px;color:#000;background:#fff;padding:6px">
    <div style="text-align:center;font-weight:700">${d.storeName}</div>
    ${d.address ? `<div style="text-align:center">${d.address}</div>` : ''}
    ${d.phone ? `<div style="text-align:center">Telp. ${d.phone}</div>` : ''}
    <div style="border-top:1px dashed #000;margin:4px 0"></div>
    <div style="display:flex;justify-content:space-between"><span>${d.receiptNo}</span><span>${d.datetime}</span></div>
    ${d.cashier ? `<div>Kasir: ${d.cashier}</div>` : ''}
    <div>${d.orderType}</div>
    <div style="border-top:1px dashed #000;margin:4px 0"></div>
    <table style="width:100%;border-collapse:collapse">
      ${itemRows}
      <tr><td colspan="3">Subtotal</td><td class="r">${fmtRpPlain(d.subtotal)}</td></tr>
      ${d.discount > 0 ? `<tr><td colspan="3">Diskon</td><td class="r">-${fmtRpPlain(d.discount)}</td></tr>` : ''}
      <tr style="font-weight:700"><td colspan="3">TOTAL</td><td class="r">${fmtRpPlain(d.total)}</td></tr>
      ${payRows}
      ${paid > d.total ? `<tr><td colspan="3">Kembali</td><td class="r">${fmtRpPlain(paid - d.total)}</td></tr>` : ''}
    </table>
    <div style="border-top:1px dashed #000;margin:4px 0"></div>
    <div style="text-align:center">${d.footer}</div>
    <style>td{padding:1px 0;vertical-align:top}td.r{text-align:right;white-space:nowrap}td.nm{font-weight:600}</style>
  </div>`
}

/** Bangun ReceiptData dari settings + hasil RPC transaksi. */
export function receiptFromTx(
  s: Settings,
  tx: { receipt_no: string; order_type: string; subtotal: number; discount: number; total: number; created_at: string },
  items: { name: string; qty: number; price: number }[],
  payments: { method: string; amount: number }[],
  cashier: string
): ReceiptData {
  return {
    storeName: s.store.name,
    address: s.store.address,
    phone: s.store.phone,
    receiptNo: tx.receipt_no,
    cashier,
    orderType: CHANNEL_LABEL[tx.order_type] ?? tx.order_type,
    datetime: new Date(tx.created_at).toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }),
    items,
    subtotal: tx.subtotal,
    discount: tx.discount,
    total: tx.total,
    payments,
    footer: s.receipt.footer
  }
}
