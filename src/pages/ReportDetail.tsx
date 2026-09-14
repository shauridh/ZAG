// Laporan Detail: satu halaman pusat data transaksi ter-filter.
// Filter: waktu (preset + rentang kustom), channel, metode bayar, kategori/menu,
// status, shift, cari nomor nota — plus ringkasan ter-filter & unduh CSV.
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { loadTransactions, loadCatalog, type Catalog } from '../lib/db'
import { applyDetailFilters, CHANNELS, METHODS, detailCsv, detailRangeOf, type DetailFilters } from '../lib/report-detail'
import { downloadCsv } from '../lib/csv'
import { fmtRp, fmtRpPlain } from '../lib/money'
import { fmtDate, todayISO, dayStart, dayEnd, localDateISO } from '../lib/dates'
import { useToast } from '../components/Toast'
import { methodLabel } from '../lib/reports'
import type { Transaction } from '../lib/types'

const CHANNEL_LABEL: Record<string, string> = Object.fromEntries(CHANNELS.map((c) => [c.key, c.label]))

const PERIODS: [DetailFilters['period'], string][] = [
  ['today', 'Hari ini'],
  ['yesterday', 'Kemarin'],
  ['week7', '7 hari'],
  ['month', 'Bulan ini'],
  ['all', 'Semua'],
  ['custom', 'Rentang…']
]

const LS_FILTERS = 'sabana-report-detail-filters-v1'

const DEFAULT_FILTERS: DetailFilters = {
  period: 'today',
  customFrom: todayISO(),
  customTo: todayISO(),
  channel: '',
  method: '',
  status: '',
  productId: null,
  categoryId: null,
  shiftId: null,
  q: ''
}

function loadFilters(): DetailFilters {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_FILTERS) ?? '{}') as Partial<DetailFilters>
    return { ...DEFAULT_FILTERS, ...raw, customFrom: raw.customFrom || todayISO(), customTo: raw.customTo || todayISO() }
  } catch {
    return { ...DEFAULT_FILTERS }
  }
}

export default function ReportDetail(): ReactElement {
  const { toast } = useToast()
  const [filters, setFilters] = useState<DetailFilters>(loadFilters)
  const [txs, setTxs] = useState<Transaction[] | null>(null)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [err, setErr] = useState('')
  const [openRow, setOpenRow] = useState<number | null>(null)

  const set = (patch: Partial<DetailFilters>): void => {
    setFilters((prev) => {
      const next = { ...prev, ...patch }
      localStorage.setItem(LS_FILTERS, JSON.stringify(next))
      return next
    })
  }

  const today = todayISO()
  const range = useMemo(() => detailRangeOf(filters, today), [filters, today])

  useEffect(() => {
    void loadCatalog().then(setCatalog).catch(() => setCatalog(null))
  }, [])

  const reload = useCallback(async () => {
    setTxs(null)
    setErr('')
    try {
      // ambil semua-status: laporan detail juga melihat refund/direvisi utk filter status
      const rows = await loadTransactions(dayStart(range.from), dayEnd(range.to), true)
      setTxs(rows)
    } catch (ex) {
      setErr((ex as Error).message)
      setTxs([])
    }
  }, [range.from, range.to])

  useEffect(() => {
    void reload()
  }, [reload])

  const nameToId = useMemo(() => new Map((catalog?.products ?? []).map((p) => [p.name, p.id])), [catalog])
  const idToCat = useMemo(() => new Map((catalog?.products ?? []).map((p) => [p.id, p.category_id])), [catalog])
  const result = useMemo(
    () => (txs ? applyDetailFilters(txs, filters, range, nameToId, idToCat) : null),
    [txs, filters, range, nameToId, idToCat]
  )
  const scoped = filters.productId != null || filters.categoryId != null

  const activeFilterCount =
    (filters.channel ? 1 : 0) + (filters.method ? 1 : 0) + (filters.status ? 1 : 0) + (filters.productId != null ? 1 : 0) + (filters.categoryId != null ? 1 : 0) + (filters.shiftId != null ? 1 : 0) + (filters.q ? 1 : 0)

  const download = (): void => {
    if (!result) return
    downloadCsv(`laporan-detail-${range.from}_${range.to}.csv`, detailCsv(result.rows, scoped))
    toast('CSV laporan detail terunduh.')
  }

  return (
    <div className="p-3 lg:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-extrabold">Laporan Detail</h1>
        <p className="text-xs font-bold text-brand-muted">Data transaksi ter-filter: waktu, channel, metode bayar, kategori/menu, status, shift &amp; nomor nota.</p>
        <div className="ml-auto flex gap-1">
          <button type="button" className="btn-ghost !min-h-0 !h-9 !px-3" onClick={() => void reload()} title="Muat ulang data">
            ↻ Muat ulang
          </button>
          <button type="button" className="btn-primary !min-h-0 !h-9 !px-3" onClick={download} disabled={!result || result.filteredCount === 0}>
            ⬇ Unduh CSV
          </button>
        </div>
      </div>

      {/* ===== Panel filter ===== */}
      <div className="card mb-3 p-3">
        <div className="mb-2 flex flex-wrap items-center gap-1" role="tablist" aria-label="Periode waktu">
          {PERIODS.map(([k, lbl]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={filters.period === k}
              className={`chip h-9 px-3 ${filters.period === k ? 'bg-brand-btn text-white' : 'border-[1.5px] border-brand-line bg-brand-card'}`}
              onClick={() => set({ period: k })}
            >
              {lbl}
            </button>
          ))}
          {filters.period === 'custom' && (
            <span className="ml-2 flex items-center gap-1">
              <input type="date" className="input !h-9 !w-36" value={filters.customFrom} max={filters.customTo} onChange={(e) => e.target.value && set({ customFrom: e.target.value })} aria-label="Dari tanggal" />
              <span className="text-xs font-bold text-brand-muted">s/d</span>
              <input type="date" className="input !h-9 !w-36" value={filters.customTo} min={filters.customFrom} max={today} onChange={(e) => e.target.value && set({ customTo: e.target.value })} aria-label="Sampai tanggal" />
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <label className="lbl !mb-0">
            Channel
            <select className="input !h-9" value={filters.channel} onChange={(e) => set({ channel: e.target.value })}>
              <option value="">Semua channel</option>
              {CHANNELS.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
          </label>
          <label className="lbl !mb-0">
            Metode bayar
            <select className="input !h-9" value={filters.method} onChange={(e) => set({ method: e.target.value })}>
              <option value="">Semua metode</option>
              {METHODS.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          </label>
          <label className="lbl !mb-0">
            Kategori menu
            <select className="input !h-9" value={filters.categoryId ?? ''} onChange={(e) => set({ categoryId: e.target.value ? parseInt(e.target.value, 10) : null, productId: null })}>
              <option value="">Semua kategori</option>
              {(catalog?.categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="lbl !mb-0">
            Menu
            <select className="input !h-9" value={filters.productId ?? ''} onChange={(e) => set({ productId: e.target.value ? parseInt(e.target.value, 10) : null, categoryId: null })}>
              <option value="">Semua menu</option>
              {(catalog?.products ?? []).filter((p) => p.is_active || result?.rows.some((r) => (r.tx.items ?? []).some((i) => i.name === p.name))).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className="lbl !mb-0">
            Status
            <select className="input !h-9" value={filters.status} onChange={(e) => set({ status: e.target.value as DetailFilters['status'] })}>
              <option value="">Semua status</option>
              <option value="normal">Terjual normal</option>
              <option value="refund">Refund</option>
            </select>
          </label>
          <label className="lbl !mb-0">
            Cari nota
            <input type="search" className="input !h-9" placeholder="SB260914-001" value={filters.q} onChange={(e) => set({ q: e.target.value })} aria-label="Cari nomor nota" />
          </label>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {activeFilterCount > 0 && (
            <button type="button" className="btn-ghost !min-h-0 !py-1 text-[11px]" onClick={() => set({ channel: '', method: '', status: '', productId: null, categoryId: null, shiftId: null, q: '' })}>
              ✕ Reset {activeFilterCount} filter
            </button>
          )}
          <span className="text-[11px] text-brand-muted">Filter tersimpan di perangkat ini.</span>
        </div>
      </div>

      {err && (
        <p className="mb-2 rounded-lg bg-brand-redtext/10 px-3 py-2 text-sm font-bold text-brand-redtext" role="alert">
          {err}
        </p>
      )}

      {/* ===== Ringkasan ter-filter ===== */}
      {result && (
        <dl className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="card strip p-3">
            <dt className="text-xs font-bold text-brand-muted">Nota lolos filter</dt>
            <dd className="text-lg font-extrabold tabular-nums">{result.filteredCount}</dd>
          </div>
          <div className="card strip p-3">
            <dt className="text-xs font-bold text-brand-muted">{scoped ? 'Omzet menu/kategori ter-filter' : 'Omzet ter-filter'}</dt>
            <dd className="text-lg font-extrabold tabular-nums">{fmtRp(result.filteredRevenue)}</dd>
          </div>
          <div className="card strip p-3">
            <dt className="text-xs font-bold text-brand-muted">Laba kotor (nota utuh)</dt>
            <dd className="text-lg font-extrabold tabular-nums">{fmtRp(result.totals.gross)}</dd>
          </div>
          <div className="card strip p-3">
            <dt className="text-xs font-bold text-brand-muted">Rata-rata nota</dt>
            <dd className="text-lg font-extrabold tabular-nums">{fmtRp(result.filteredCount ? Math.round(result.filteredRevenue / result.filteredCount) : 0)}</dd>
          </div>
        </dl>
      )}

      {/* ===== Tabel detail ===== */}
      <div className="card overflow-x-auto">
        <table className="tbl min-w-[720px]">
          <thead>
            <tr>
              <th>Nota</th>
              <th>Tanggal</th>
              <th>Jam</th>
              <th>Channel</th>
              <th>Metode</th>
              <th className="text-right">{scoped ? 'Total ter-filter' : 'Total'}</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {txs === null && (
              <tr><td colSpan={8} className="text-center text-brand-muted">Memuat…</td></tr>
            )}
            {result && result.filteredCount === 0 && (
              <tr><td colSpan={8} className="text-center text-brand-muted">Tidak ada transaksi yang lolos filter ({fmtDate(range.from)} – {fmtDate(range.to)}).</td></tr>
            )}
            {result?.rows.map(({ tx, scopedItems, scopedTotal }) => {
              const st = tx.status ?? 'normal'
              const isOpen = openRow === tx.id
              return (
                <>
                  <tr key={tx.id} className={st !== 'normal' ? 'opacity-70' : ''}>
                    <td className="whitespace-nowrap font-bold">{tx.receipt_no ?? `#${tx.id}`}</td>
                    <td className="whitespace-nowrap">{fmtDate(localDateISO(tx.created_at))}</td>
                    <td className="whitespace-nowrap">{tx.created_at.slice(11, 16)}</td>
                    <td>{CHANNEL_LABEL[tx.order_type] ?? tx.order_type}</td>
                    <td>{(tx.payments ?? []).map((p) => methodLabel(p.method)).join(' + ') || '—'}</td>
                    <td className={`whitespace-nowrap text-right font-extrabold tabular-nums ${tx.total < 0 ? 'text-brand-redtext' : ''}`}>
                      {scoped ? fmtRpPlain(scopedTotal) : fmtRpPlain(tx.total)}
                    </td>
                    <td>
                      {st !== 'normal' ? <span className="chip bg-brand-gold text-[10px]">{st === 'refund' ? 'Refund' : st === 'batal' ? 'Batal' : 'Direvisi'}</span> : <span className="text-xs text-brand-muted">lunas</span>}
                    </td>
                    <td className="text-right">
                      <button type="button" className="btn-ghost !min-h-0 !px-2 !py-1 text-xs" aria-expanded={isOpen} onClick={() => setOpenRow(isOpen ? null : tx.id)}>
                        {isOpen ? '▲ Tutup' : '▼ Rincian'}
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr key={`${tx.id}-detail`}>
                      <td colSpan={8} className="bg-brand-paper">
                        <div className="px-2 py-1">
                          <p className="mb-1 text-[11px] font-extrabold text-brand-muted">
                            {scoped ? 'Baris yang lolos filter menu/kategori ditandai ● — total nota tetap ditampilkan' : 'Semua baris nota'}
                            {' · '}HPP nota {fmtRp(tx.hpp)}{tx.note ? ` · catatan: ${tx.note}` : ''}
                          </p>
                          <ul className="text-sm">
                            {(tx.items ?? []).map((i, idx) => {
                              const inScope = scopedItems ? scopedItems.some((s) => s.name === i.name) : null
                              return (
                                <li key={idx} className="flex justify-between gap-3">
                                  <span>{inScope === false ? '' : inScope === true ? '● ' : ''}{i.name}</span>
                                  <span className="tabular-nums">{i.qty} × {fmtRpPlain(i.price)} = <b>{fmtRpPlain(i.qty * i.price)}</b></span>
                                </li>
                              )
                            })}
                          </ul>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
