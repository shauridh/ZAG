import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { loadTransactions } from '../lib/db'
import { totalsOf, byChannel, byItem, byPayment, profitLoss } from '../lib/reports'
import { fmtRp, fmtRpPlain } from '../lib/money'
import { todayISO, startOfMonthISO, dayStart, dayEnd } from '../lib/dates'
import type { Settings, Transaction } from '../lib/types'
import { downloadCsv } from '../lib/csv'
import { loadSettings } from '../lib/db'

const CHAN_LABEL: Record<string, string> = {
  dinein: 'Makan di tempat',
  takeaway: 'Bungkus',
  gofood: 'GoFood',
  grabfood: 'GrabFood',
  shopeefood: 'ShopeeFood',
  delivery: 'Delivery sendiri'
}
const PAY_LABEL: Record<string, string> = { cash: 'Tunai', qris: 'QRIS', transfer: 'Transfer' }

export default function Reports(): ReactElement {
  const [from, setFrom] = useState(startOfMonthISO())
  const [to, setTo] = useState(todayISO())
  const [txs, setTxs] = useState<Transaction[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [err, setErr] = useState('')

  const reload = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([loadTransactions(dayStart(from), dayEnd(to)), loadSettings()])
      setTxs(t)
      setSettings(s)
    } catch (ex) {
      setErr((ex as Error).message)
    }
  }, [from, to])

  useEffect(() => {
    void reload()
  }, [reload])

  if (!settings) return <div className="p-6 text-sm font-bold text-brand-muted">Memuat...</div>

  const t = totalsOf(txs)
  const chans = byChannel(txs)
  const items = byItem(txs)
  const pays = byPayment(txs)
  const pl = profitLoss(txs, [], [], settings.fixed_costs)

  const quick = (label: string, f: string, e: string): ReactElement => (
    <button
      type="button"
      key={label}
      className={`chip h-9 px-3 ${from === f && to === e ? 'bg-brand-btn text-white' : 'border-[1.5px] border-brand-line bg-brand-card'}`}
      onClick={() => {
        setFrom(f)
        setTo(e)
      }}
    >
      {label}
    </button>
  )
  const shiftDay = (base: string, d: number): string => {
    const dt = new Date(base + 'T12:00:00')
    dt.setDate(dt.getDate() + d)
    return dt.toISOString().slice(0, 10)
  }

  return (
    <div className="p-3 lg:p-4">
      <h1 className="mb-3 text-xl font-extrabold">Laporan Penjualan</h1>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {quick('Hari ini', todayISO(), todayISO())}
        {quick('Kemarin', shiftDay(todayISO(), -1), shiftDay(todayISO(), -1))}
        {quick('7 hari', shiftDay(todayISO(), -6), todayISO())}
        {quick('Bulan ini', startOfMonthISO(), todayISO())}
        <input type="date" className="input !h-10 !w-40" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Dari tanggal" />
        <span className="text-sm font-bold text-brand-muted">s.d.</span>
        <input type="date" className="input !h-10 !w-40" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Sampai tanggal" />
        <button
          type="button"
          className="btn-ghost ml-auto"
          onClick={() =>
            downloadCsv(`laporan-${from}_${to}.csv`, [
              ['Ringkasan', `${from} s.d. ${to}`],
              ['Omzet', t.revenue],
              ['HPP', t.hpp],
              ['Komisi channel', t.fee],
              ['Laba kotor', t.gross],
              ['Jumlah transaksi', t.count],
              [],
              ['Per channel', 'Omzet', 'Trx', 'Komisi'],
              ...chans.map((c) => [CHAN_LABEL[c.key] ?? c.key, c.revenue, c.count, c.fee]),
              [],
              ['Per metode bayar', 'Jumlah'],
              ...pays.map((p) => [PAY_LABEL[p.method] ?? p.method, p.amount]),
              [],
              ['Item', 'Qty', 'Omzet', 'Margin'],
              ...items.map((i) => [i.name, i.qty, i.revenue, i.margin])
            ])
          }
        >
          Unduh CSV
        </button>
      </div>
      {err && (
        <p className="mb-2 rounded-lg bg-brand-redtext/10 px-3 py-2 text-sm font-bold text-brand-redtext" role="alert">
          {err}
        </p>
      )}

      {txs.length === 0 ? (
        <p className="card p-10 text-center text-sm text-brand-muted">Tidak ada transaksi pada rentang ini.</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="card strip p-4">
            <h2 className="mb-2 font-extrabold">Ringkasan</h2>
            <dl className="text-sm">
              <div className="flex justify-between border-b border-brand-line py-1">
                <dt>Omzet</dt>
                <dd className="font-extrabold tabular-nums">{fmtRp(t.revenue)}</dd>
              </div>
              <div className="flex justify-between border-b border-brand-line py-1">
                <dt>HPP bahan (snapshot)</dt>
                <dd className="tabular-nums">-{fmtRpPlain(t.hpp)}</dd>
              </div>
              <div className="flex justify-between border-b border-brand-line py-1">
                <dt>Komisi channel</dt>
                <dd className="tabular-nums">-{fmtRpPlain(t.fee)}</dd>
              </div>
              <div className="flex justify-between border-b-[1.5px] border-brand-line py-1 text-base">
                <dt className="font-extrabold">Laba kotor</dt>
                <dd className="font-extrabold tabular-nums">{fmtRp(t.gross)}</dd>
              </div>
              <div className="flex justify-between py-1">
                <dt>Jumlah transaksi</dt>
                <dd className="tabular-nums">{t.count}</dd>
              </div>
              <div className="flex justify-between py-1">
                <dt>Rata-rata / transaksi</dt>
                <dd className="tabular-nums">{fmtRp(t.avg)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-brand-muted">Beban tetap bulanan {fmtRp(settings.fixed_costs.reduce((s, f) => s + f.amount, 0))} belum diperhitungkan di laba kotor; lihat Keuangan untuk laba bersih.</p>
          </div>

          <div className="card overflow-x-auto p-4">
            <h2 className="mb-2 font-extrabold">Per channel</h2>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th className="text-right">Omzet</th>
                  <th className="text-right">Trx</th>
                </tr>
              </thead>
              <tbody>
                {chans.map((c) => (
                  <tr key={c.key}>
                    <td>{CHAN_LABEL[c.key] ?? c.key}</td>
                    <td className="text-right tabular-nums">{fmtRpPlain(c.revenue)}</td>
                    <td className="text-right tabular-nums">{c.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3 className="mt-3 mb-1 text-sm font-extrabold">Per metode bayar</h3>
            <ul className="text-sm font-bold">
              {pays.map((p) => (
                <li key={p.method} className="flex justify-between">
                  <span>{PAY_LABEL[p.method] ?? p.method}</span>
                  <span className="tabular-nums">{fmtRp(p.amount)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="card overflow-x-auto p-4">
            <h2 className="mb-2 font-extrabold">Item terlaris</h2>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Menu</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {items.slice(0, 15).map((i) => (
                  <tr key={i.name}>
                    <td className="font-bold">{i.name}</td>
                    <td className="text-right tabular-nums">{i.qty}</td>
                    <td className="text-right tabular-nums">{fmtRpPlain(i.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="mt-3 text-xs text-brand-muted">Estimasi laba bersih rentang ini setelah beban tetap: {fmtRp(pl.find((x) => x.label === 'Laba bersih')?.amount ?? 0)} (tanpa pengeluaran harian).</p>
    </div>
  )
}
