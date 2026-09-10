import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { currentShift, loadShifts, loadTransactions, openShift, closeShift, loadSettings } from '../lib/db'
import { fmtRp, fmtRpPlain } from '../lib/money'
import type { Shift, Transaction, Settings } from '../lib/types'
import { Numpad } from '../components/Numpad'
import { Modal } from '../components/Modal'
import { fmtDateTime, todayISO } from '../lib/dates'
import { byChannel, byItem, byPayment, totalsOf, endOfDayReport, endOfDayText } from '../lib/reports'
import { downloadCsv } from '../lib/csv'

export default function ShiftPage(): ReactElement {
  const [shift, setShift] = useState<Shift | null>(null)
  const [history, setHistory] = useState<Shift[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [openModal, setOpenModal] = useState(false)
  const [cash, setCash] = useState(0)
  const [closeModal, setCloseModal] = useState(false)
  const [closeCash, setCloseCash] = useState(0)
  const [note, setNote] = useState('')
  const [xReport, setXReport] = useState(false)
  const [eodOpen, setEodOpen] = useState(false)
  const [txs, setTxs] = useState<Transaction[]>([])
  const [eodTxs, setEodTxs] = useState<Transaction[]>([])
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const reload = useCallback(async () => {
    try {
      const [s, h, st] = await Promise.all([currentShift(), loadShifts(), loadSettings()])
      setShift(s)
      setHistory(h)
      setSettings(st)
      if (s) {
        setTxs(await loadTransactions(s.opened_at, new Date().toISOString()))
      }
    } catch (ex) {
      setErr((ex as Error).message)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  if (!settings) return <div className="p-6 text-sm font-bold text-brand-muted">Memuat...</div>

  const cashSales = (t: Shift): number =>
    (txs ?? []).filter((x) => x.shift_id === t.id).reduce((sum, x) => sum + (x.payments ?? []).filter((p) => p.method === 'cash').reduce((a, p) => a + p.amount, 0), 0)

  return (
    <div className="p-3 lg:p-4">
      <h1 className="mb-3 text-xl font-extrabold">Shift Kasir</h1>
      {err && (
        <p className="mb-2 rounded-lg bg-brand-redtext/10 px-3 py-2 text-sm font-bold text-brand-redtext" role="alert">
          {err}
        </p>
      )}
      {msg && <p role="status" className="mb-2 rounded-lg bg-brand-gold/25 px-3 py-2 text-sm font-bold">{msg}</p>}

      {shift ? (
        <div className="card strip max-w-xl p-4">
          <div className="flex items-center gap-2">
            <p className="mr-auto text-lg font-extrabold">Shift #{shift.id} terbuka</p>
            <span className="chip bg-brand-gold">sejak {fmtDateTime(shift.opened_at)}</span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg bg-brand-paper p-2">
              <dt className="text-xs font-bold text-brand-muted">Modal awal</dt>
              <dd className="font-extrabold tabular-nums">{fmtRp(shift.opening_cash)}</dd>
            </div>
            <div className="rounded-lg bg-brand-paper p-2">
              <dt className="text-xs font-bold text-brand-muted">Penjualan tunai</dt>
              <dd className="font-extrabold tabular-nums">{fmtRp(cashSales(shift))}</dd>
            </div>
            <div className="rounded-lg bg-brand-paper p-2">
              <dt className="text-xs font-bold text-brand-muted">Seharusnya di drawer</dt>
              <dd className="font-extrabold tabular-nums">{fmtRp(shift.opening_cash + cashSales(shift))}</dd>
            </div>
            <div className="rounded-lg bg-brand-paper p-2">
              <dt className="text-xs font-bold text-brand-muted">Float wajib</dt>
              <dd className="font-extrabold tabular-nums">{fmtRp(settings.shift.float_cash)}</dd>
            </div>
          </dl>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn-ghost flex-1" onClick={() => setXReport(true)}>
              Laporan X
            </button>
            <button
              type="button"
              className="btn-ghost flex-1"
              onClick={() => {
                setEodOpen(true)
                void loadTransactions(todayISO() + 'T00:00:00', new Date().toISOString()).then(setEodTxs).catch((ex) => setErr((ex as Error).message))
              }}
            >
              Laporan Akhir Hari
            </button>
            <button
              type="button"
              className="btn-primary flex-1"
              onClick={() => {
                setCloseCash(shift.opening_cash + cashSales(shift))
                setCloseModal(true)
              }}
            >
              Tutup Shift
            </button>
          </div>
        </div>
      ) : (
        <div className="card strip max-w-xl p-4">
          <p className="font-extrabold">Belum ada shift terbuka</p>
          <p className="mt-1 text-sm text-brand-muted">
            Kasir harus buka shift sebelum menjual. Modal awal minimal float kembalian {fmtRp(settings.shift.float_cash)} yang wajib ada di drawer untuk uang kembalian.
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn-primary flex-1" onClick={() => { setCash(0); setOpenModal(true) }}>
              Buka Shift
            </button>
            <button
              type="button"
              className="btn-ghost flex-1"
              onClick={() => {
                setEodOpen(true)
                void loadTransactions(todayISO() + 'T00:00:00', new Date().toISOString()).then(setEodTxs).catch((ex) => setErr((ex as Error).message))
              }}
            >
              Laporan Akhir Hari
            </button>
          </div>
        </div>
      )}

      <h2 className="mt-5 mb-2 font-extrabold">Riwayat shift</h2>
      <div className="card max-w-3xl overflow-x-auto">
        <table className="tbl min-w-[560px]">
          <thead>
            <tr>
              <th>Dibuka</th>
              <th>Ditutup</th>
              <th className="whitespace-nowrap text-right">Modal</th>
              <th className="whitespace-nowrap text-right">Kas fisik</th>
              <th className="whitespace-nowrap text-right">Selisih</th>
              <th>Catatan</th>
            </tr>
          </thead>
          <tbody>
            {history.map((s) => (
              <tr key={s.id}>
                <td>{fmtDateTime(s.opened_at)}</td>
                <td>{s.closed_at ? fmtDateTime(s.closed_at) : '—'}</td>
                <td className="text-right tabular-nums">{fmtRp(s.opening_cash)}</td>
                <td className="text-right tabular-nums">{s.closing_cash !== null ? fmtRp(s.closing_cash) : '—'}</td>
                <td className={`text-right font-bold tabular-nums ${s.cash_diff !== null && s.cash_diff < 0 ? 'text-brand-redtext' : ''}`}>
                  {s.cash_diff !== null ? fmtRp(s.cash_diff) : '—'}
                </td>
                <td className="text-xs">{s.note ?? ''}</td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-brand-muted">
                  belum ada riwayat
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal buka shift */}
      <Modal open={openModal} title="Buka Shift" onClose={() => setOpenModal(false)}>
        <p className="mb-3 text-sm text-brand-muted">
          Uang di drawer saat ini. Minimal float kembalian {fmtRp(settings.shift.float_cash)}.
        </p>
        <Numpad
          value={cash}
          onChange={setCash}
          quick={[50000, 100000, 200000]}
          submitLabel="Buka Shift"
          onSubmit={async () => {
            try {
              await openShift(cash)
              setOpenModal(false)
              setMsg('Shift dibuka. Selamat bekerja!')
              await reload()
            } catch (ex) {
              setErr((ex as Error).message)
            }
          }}
        />
      </Modal>

      {/* Modal tutup shift */}
      <Modal open={closeModal} title="Tutup Shift" onClose={() => setCloseModal(false)}>
        <p className="mb-3 text-sm text-brand-muted">
          Hitung uang fisik di drawer sekarang. Wajib menyisakan float kembalian {fmtRp(settings.shift.float_cash)}. Laporan otomatis dikirim ke email pemilik
          {settings.owner_email.email ? ` (${settings.owner_email.email})` : ' (atur email di Pengaturan)'}.
        </p>
        <Numpad
          value={closeCash}
          onChange={setCloseCash}
          quick={[50000, 100000]}
          submitLabel="Tutup Shift & Kirim Laporan"
          onSubmit={async () => {
            try {
              const rep = await closeShift(closeCash, note)
              setCloseModal(false)
              // auto-kirim laporan akhir hari: email sudah dikirim otomatis di
              // closeShift; WhatsApp dibuka dengan teks terisi bila nomor diatur
              const notes: string[] = [`Shift ditutup. Selisih kas ${fmtRp(rep.cash_diff)}.`]
              notes.push(settings.owner_email.email ? 'Laporan email terkirim ke pemilik.' : 'Email pemilik belum diatur.')
              try {
                const todayTxs = await loadTransactions(todayISO() + 'T00:00:00', new Date().toISOString())
                const eodText = endOfDayText(endOfDayReport(todayTxs, settings.channels), settings.store.name, todayISO())
                const wa = settings.owner_email.whatsapp.replace(/\D/g, '')
                if (wa) {
                  window.open(`https://wa.me/${wa}?text=${encodeURIComponent(eodText)}`, '_blank')
                  notes.push('WhatsApp pemilik dibuka dengan laporan terisi.')
                }
              } catch {
                // laporan WhatsApp gagal dibuat — email tetap terkirim
              }
              setMsg(notes.join(' '))
              await reload()
            } catch (ex) {
              setErr((ex as Error).message)
            }
          }}
        />
        <div className="mt-3">
          <label className="lbl" htmlFor="cnote">
            Catatan kejadian (wajib bila kas minus)
          </label>
          <textarea id="cnote" className="input !h-20" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Contoh: ada kembalian kurang Rp5.000 karena..." />
        </div>
      </Modal>

      {/* Modal laporan X */}
      <Modal open={xReport} title="Laporan X (Shift Berjalan)" onClose={() => setXReport(false)} wide>
        <XReport txs={txs.filter((t) => t.shift_id === shift?.id)} />
      </Modal>

      {/* Modal laporan akhir hari */}
      <Modal open={eodOpen} title="Laporan Akhir Hari" onClose={() => setEodOpen(false)} wide>
        <EndOfDay txs={eodTxs} settings={settings} setErr={setErr} />
      </Modal>
    </div>
  )
}

/**
 * Laporan akhir hari: total per metode bayar, HPP, laba kotor —
 * tampil di modal + tombol bagikan ke WhatsApp (Web Share / salin teks).
 */
function EndOfDay({ txs, settings, setErr }: { txs: Transaction[]; settings: Settings; setErr: (s: string) => void }): ReactElement {
  const rep = endOfDayReport(txs, settings.channels)
  const text = endOfDayText(rep, settings.store.name, todayISO())
  const rp = (n: number): string => fmtRp(n)

  const share = async (): Promise<void> => {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Laporan Akhir Hari', text })
      } else {
        // fallback: buka WhatsApp dengan teks terisi
        window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank')
      }
    } catch {
      // user membatalkan share
    }
  }

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setErr('')
      window.alert('Laporan disalin ke clipboard.')
    } catch {
      setErr('Gagal menyalin laporan')
    }
  }

  return (
    <div>
      {txs.length === 0 && <p className="mb-3 text-sm font-bold text-brand-muted">Belum ada transaksi hari ini.</p>}
      <dl className="mb-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg bg-brand-paper p-2">
          <dt className="text-xs font-bold text-brand-muted">Transaksi</dt>
          <dd className="text-lg font-extrabold tabular-nums">{rep.count}</dd>
        </div>
        <div className="rounded-lg bg-brand-paper p-2">
          <dt className="text-xs font-bold text-brand-muted">Omzet</dt>
          <dd className="text-lg font-extrabold tabular-nums">{rp(rep.revenue)}</dd>
        </div>
        <div className="rounded-lg bg-brand-paper p-2">
          <dt className="text-xs font-bold text-brand-muted">HPP bahan</dt>
          <dd className="font-extrabold tabular-nums">{rp(rep.hpp)}</dd>
        </div>
        <div className="rounded-lg bg-brand-gold/25 p-2">
          <dt className="text-xs font-bold text-brand-muted">Laba kotor</dt>
          <dd className="text-lg font-extrabold tabular-nums">{rp(rep.gross)}</dd>
        </div>
      </dl>
      {rep.discount > 0 && (
        <p className="mb-2 text-sm font-bold text-brand-muted">
          Diskon diberikan: −{rp(rep.discount)}
        </p>
      )}
      <p className="text-xs font-bold text-brand-muted">Per metode bayar</p>
      <ul className="mb-3 text-sm font-bold">
        {rep.methods.map((m) => (
          <li key={m.method}>
            {m.label}: {rp(m.amount)} <span className="font-normal text-brand-muted">({m.count} trx)</span>
          </li>
        ))}
        {rep.methods.length === 0 && <li className="font-normal text-brand-muted">belum ada</li>}
      </ul>
      <p className="text-xs font-bold text-brand-muted">Menu terlaris</p>
      <ul className="mb-3 text-sm font-bold">
        {rep.topItems.map((i) => (
          <li key={i.name}>
            {i.name} ×{i.qty} = {rp(i.revenue)}
          </li>
        ))}
        {rep.topItems.length === 0 && <li className="font-normal text-brand-muted">belum ada</li>}
      </ul>
      <div className="flex gap-2">
        <button type="button" className="btn-primary flex-1" onClick={() => void share()}>
          Bagikan WhatsApp
        </button>
        <button type="button" className="btn-ghost flex-1" onClick={() => void copy()}>
          Salin Teks
        </button>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-bold text-brand-muted">Pratinjau teks</summary>
        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-brand-paper p-2 text-[11px] leading-snug">{text}</pre>
      </details>
    </div>
  )
}

function XReport({ txs }: { txs: Transaction[] }): ReactElement {
  const t = totalsOf(txs)
  const chans = byChannel(txs)
  const items = byItem(txs)
  const pays = byPayment(txs)
  const money = (n: number): string => fmtRpPlain(n)
  return (
    <div>
      <dl className="mb-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg bg-brand-paper p-2">
          <dt className="text-xs font-bold text-brand-muted">Transaksi</dt>
          <dd className="text-lg font-extrabold tabular-nums">{t.count}</dd>
        </div>
        <div className="rounded-lg bg-brand-paper p-2">
          <dt className="text-xs font-bold text-brand-muted">Omzet</dt>
          <dd className="text-lg font-extrabold tabular-nums">{money(t.revenue)}</dd>
        </div>
        <div className="rounded-lg bg-brand-paper p-2">
          <dt className="text-xs font-bold text-brand-muted">HPP bahan</dt>
          <dd className="font-extrabold tabular-nums">{money(t.hpp)}</dd>
        </div>
        <div className="rounded-lg bg-brand-paper p-2">
          <dt className="text-xs font-bold text-brand-muted">Laba kotor</dt>
          <dd className="font-extrabold tabular-nums">{money(t.gross)}</dd>
        </div>
      </dl>
      <p className="text-xs font-bold text-brand-muted">Per metode bayar</p>
      <ul className="mb-3 text-sm font-bold">
        {pays.map((p) => (
          <li key={p.method}>
            {p.method}: {money(p.amount)}
          </li>
        ))}
        {pays.length === 0 && <li className="font-normal text-brand-muted">belum ada</li>}
      </ul>
      <p className="text-xs font-bold text-brand-muted">Per channel</p>
      <ul className="mb-3 text-sm font-bold">
        {chans.map((c) => (
          <li key={c.key}>
            {c.key}: {money(c.revenue)} ({c.count} trx)
          </li>
        ))}
      </ul>
      <p className="text-xs font-bold text-brand-muted">Item terjual</p>
      <ul className="text-sm font-bold">
        {items.slice(0, 10).map((i) => (
          <li key={i.name}>
            {i.name} × {i.qty} = {money(i.revenue)}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn-ghost mt-3 w-full"
        onClick={() =>
          downloadCsv(`laporan-x-${todayISO()}.csv`, [
            ['Item', 'Qty', 'Omzet'],
            ...items.map((i) => [i.name, i.qty, i.revenue]),
            [],
            ['Total', t.count + ' trx', t.revenue]
          ])
        }
      >
        Unduh CSV
      </button>
    </div>
  )
}
