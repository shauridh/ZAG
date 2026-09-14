import type { Settings, Transaction } from './types'

const METHOD_LABEL: Record<string, string> = { cash: 'Tunai', qris: 'QRIS', transfer: 'Transfer' }

export const methodLabel = (m: string): string => METHOD_LABEL[m] ?? m

/**
 * Kas tunai murni dari satu transaksi: uang diterima MINUS kembalian.
 * payments menyimpan UANG DITERIMA (nota 27rb dibayar 50rb → kas masuk 27rb).
 * Refund berupa payment tunai negatif — mengurangi kas tanpa clamp.
 */
export function txCashNet(t: Transaction): number {
  const paid = (t.payments ?? []).filter((p) => p.method === 'cash').reduce((a, p) => a + p.amount, 0)
  const allPaid = (t.payments ?? []).reduce((a, p) => a + p.amount, 0)
  const change = allPaid > t.total ? allPaid - t.total : 0
  return paid - change
}

export interface ReportTotals {
  revenue: number
  hpp: number
  fee: number
  gross: number
  count: number
  avg: number
}

export function totalsOf(txs: Transaction[]): ReportTotals {
  const revenue = txs.reduce((s, t) => s + t.total, 0)
  const hpp = txs.reduce((s, t) => s + t.hpp, 0)
  const fee = txs.reduce((s, t) => s + t.channel_fee, 0)
  const gross = revenue - hpp - fee
  return { revenue, hpp, fee, gross, count: txs.length, avg: txs.length ? revenue / txs.length : 0 }
}

export function byChannel(txs: Transaction[]): { key: string; revenue: number; count: number; fee: number }[] {
  const m = new Map<string, { revenue: number; count: number; fee: number }>()
  for (const t of txs) {
    const cur = m.get(t.order_type) ?? { revenue: 0, count: 0, fee: 0 }
    cur.revenue += t.total
    cur.count += 1
    cur.fee += t.channel_fee
    m.set(t.order_type, cur)
  }
  return [...m.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.revenue - a.revenue)
}

export function byPayment(
  txs: Transaction[]
): { method: string; amount: number }[] {
  const m = new Map<string, number>()
  for (const t of txs) {
    for (const p of t.payments ?? []) m.set(p.method, (m.get(p.method) ?? 0) + p.amount)
    // payments menyimpan UANG DITERIMA; kembalian tunai bukan kas masuk
    const change = (t.payments ?? []).reduce((s, p) => s + p.amount, 0) - t.total
    if (change > 0 && m.has('cash')) m.set('cash', (m.get('cash') ?? 0) - change)
  }
  return [...m.entries()].map(([method, amount]) => ({ method, amount }))
}

export function byItem(
  txs: Transaction[]
): { name: string; qty: number; revenue: number; margin: number }[] {
  const m = new Map<string, { qty: number; revenue: number; hpp: number }>()
  for (const t of txs)
    for (const it of t.items ?? []) {
      const cur = m.get(it.name) ?? { qty: 0, revenue: 0, hpp: 0 }
      cur.qty += it.qty
      cur.revenue += it.qty * it.price
      cur.hpp += it.hpp
      m.set(it.name, cur)
    }
  return [...m.entries()]
    .map(([name, v]) => ({ name, qty: v.qty, revenue: v.revenue, margin: v.revenue - v.hpp }))
    .sort((a, b) => b.revenue - a.revenue)
}

/** Laba rugi sederhana: penjualan, HPP, komisi, beban lain, laba bersih. */
export function profitLoss(
  txs: Transaction[],
  expenses: { amount: number; note: string | null }[],
  otherIncome: { amount: number; source: string }[],
  fixedCosts: Settings['fixed_costs']
): { label: string; amount: number }[] {
  const t = totalsOf(txs)
  const exp = expenses.reduce((s, e) => s + e.amount, 0)
  const inc = otherIncome.reduce((s, i) => s + i.amount, 0)
  const fixed = fixedCosts.reduce((s, f) => s + f.amount, 0)
  return [
    { label: 'Penjualan', amount: t.revenue },
    { label: 'HPP bahan', amount: -t.hpp },
    { label: 'Komisi channel online', amount: -t.fee },
    { label: 'Beban usaha (pengeluaran tercatat)', amount: -exp },
    { label: 'Beban tetap bulanan', amount: -fixed },
    { label: 'Pemasukan lain', amount: inc },
    { label: 'Laba bersih', amount: t.revenue - t.hpp - t.fee - exp - fixed + inc }
  ]
}

/** Jam sibuk: penjualan per jam 0-23. */
export function byHour(txs: Transaction[]): { hour: number; revenue: number }[] {
  const arr = Array.from({ length: 24 }, (_, hour) => ({ hour, revenue: 0 }))
  for (const t of txs) {
    const h = new Date(t.created_at).getHours()
    arr[h].revenue += t.total
  }
  return arr
}

export interface EndOfDayReport {
  count: number
  revenue: number
  discount: number
  hpp: number
  fee: number
  gross: number
  methods: { method: string; label: string; amount: number; count: number }[]
  topItems: { name: string; qty: number; revenue: number }[]
}

/**
 * Laporan akhir hari: total per metode bayar, HPP, laba kotor.
 * Komisi channel online dihitung dari pengaturan channel (fee % per order type).
 */
export function endOfDayReport(txs: Transaction[], channels: Settings['channels']): EndOfDayReport {
  const t = totalsOf(txs)
  const feeComputed = byChannel(txs).reduce(
    (s, c) => s + (c.revenue * ((channels as Record<string, { fee: number }>)[c.key]?.fee ?? 0)) / 100,
    0
  )
  const fee = feeComputed > 0 ? feeComputed : t.fee

  // per metode bayar: jumlah uang + jumlah transaksi yang memakai metode itu.
  // byPayment sudah mengoreksi kembalian tunai (payments = uang diterima).
  const mCnt = new Map<string, number>()
  for (const tx of txs)
    for (const m of new Set((tx.payments ?? []).map((p) => p.method))) mCnt.set(m, (mCnt.get(m) ?? 0) + 1)
  const methods = byPayment(txs)
    .map(({ method, amount }) => ({ method, label: methodLabel(method), amount, count: mCnt.get(method) ?? 0 }))
    .sort((a, b) => b.amount - a.amount)

  const discount = txs.reduce((s, x) => s + (x.discount ?? 0), 0)
  const items = byItem(txs).slice(0, 8).map((i) => ({ name: i.name, qty: i.qty, revenue: i.revenue }))

  return { count: t.count, revenue: t.revenue, discount, hpp: t.hpp, fee, gross: t.revenue - t.hpp - fee, methods, topItems: items }
}

/** Teks siap kirim WhatsApp. */
export function endOfDayText(rep: EndOfDayReport, storeName: string, dateISO: string): string {
  const rp = (n: number): string => 'Rp' + Math.round(n).toLocaleString('id-ID')
  const d = new Date(dateISO + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
  const lines: string[] = []
  lines.push(`*LAPORAN AKHIR HARI*
${storeName}
${d}`)
  lines.push(`
Transaksi: ${rep.count}
Omzet: ${rp(rep.revenue)}`)
  if (rep.discount > 0) lines.push(`Diskon: -${rp(rep.discount)}`)
  lines.push(`HPP bahan: ${rp(rep.hpp)}`)
  if (rep.fee > 0) lines.push(`Komisi channel: ${rp(rep.fee)}`)
  lines.push(`*Laba kotor: ${rp(rep.gross)}*`)
  if (rep.methods.length > 0) {
    lines.push('\nPer metode bayar:')
    for (const m of rep.methods) lines.push(`• ${m.label}: ${rp(m.amount)} (${m.count} trx)`)
  }
  if (rep.topItems.length > 0) {
    lines.push('\nMenu terlaris:')
    for (const i of rep.topItems.slice(0, 5)) lines.push(`• ${i.name} ×${i.qty} = ${rp(i.revenue)}`)
  }
  return lines.join('\n')
}
