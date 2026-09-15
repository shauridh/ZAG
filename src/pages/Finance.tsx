import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { ArrowDownLeft, ArrowUpRight, KeyRound, Tags, Trash } from 'lucide-react'
import { loadFinance, loadTransactions, loadSettings, addExpense, addOtherIncome, saveSetting, setOwnerPin, verifyOwnerPin } from '../lib/db'
import { fmtRp, fmtRpPlain } from '../lib/money'
import { todayISO, fmtDate, dayStart, dayEnd } from '../lib/dates'
import { profitLoss, totalsOf } from '../lib/reports'
import type { Settings, Transaction } from '../lib/types'
import { downloadCsv } from '../lib/csv'
import { Modal } from '../components/Modal'
import { Numpad } from '../components/Numpad'
import { useToast } from '../components/Toast'

export default function Finance(): ReactElement {
  const { toast } = useToast()
  const [month, setMonth] = useState(todayISO().slice(0, 8) + '01')
  const [fin, setFin] = useState<{ expenses: { id: number; category_id: number | null; amount: number; note: string | null; spent_at: string }[]; expenseCats: { id: number; name: string }[]; otherIncome: { id: number; source: string; amount: number; note: string | null; earned_at: string }[] } | null>(null)
  const [txs, setTxs] = useState<Transaction[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [expOpen, setExpOpen] = useState(false)
  const [incOpen, setIncOpen] = useState(false)
  const [pinOpen, setPinOpen] = useState(false)
  const [catsOpen, setCatsOpen] = useState(false)
  const [err, setErr] = useState('')

  const endOfMonth = (m: string): string => {
    const d = new Date(parseInt(m.slice(0, 4), 10), parseInt(m.slice(5, 7), 10), 0)
    return d.toISOString().slice(0, 10)
  }

  const reload = useCallback(async () => {
    try {
      const [f, t, s] = await Promise.all([loadFinance(month, endOfMonth(month)), loadTransactions(dayStart(month), dayEnd(endOfMonth(month))), loadSettings()])
      setFin(f)
      setTxs(t)
      setSettings(s)
    } catch (ex) {
      setErr((ex as Error).message)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month])

  useEffect(() => {
    void reload()
  }, [reload])

  if (!fin || !settings) return <div className="p-6 text-sm font-bold text-brand-muted">Memuat...</div>

  const t = totalsOf(txs)
  const pl = profitLoss(txs, fin.expenses, fin.otherIncome, settings.fixed_costs)
  const monthLabel = new Date(month + 'T12:00:00').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })

  return (
    <div className="p-3 lg:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-extrabold">Keuangan</h1>
        <input type="month" className="input !h-10 !w-44" value={month.slice(0, 7)} onChange={(e) => setMonth(e.target.value + '-01')} aria-label="Pilih bulan" />
        <button type="button" className="btn-ghost" onClick={() => setExpOpen(true)}>
          <ArrowDownLeft size={16} strokeWidth={2.25} className="mr-1 inline-block align-[-3px] text-brand-redtext" aria-hidden /> Pengeluaran
        </button>
        <button type="button" className="btn-ghost" onClick={() => setIncOpen(true)}>
          <ArrowUpRight size={16} strokeWidth={2.25} className="mr-1 inline-block align-[-3px] text-[#16A34A]" aria-hidden /> Pemasukan Lain
        </button>
        <button type="button" className="btn-ghost" onClick={() => setCatsOpen(true)}>
          <Tags size={16} strokeWidth={2.25} className="mr-1 inline-block align-[-3px]" aria-hidden /> Kategori
        </button>
        <button type="button" className="btn-ghost" onClick={() => setPinOpen(true)}>
          <KeyRound size={16} strokeWidth={2.25} className="mr-1 inline-block align-[-3px]" aria-hidden /> {settings.owner_pin_set ? 'Ganti PIN Owner' : 'Atur PIN Owner'}
        </button>
      </div>
      {err && (
        <p className="mb-2 rounded-lg bg-brand-redtext/10 px-3 py-2 text-sm font-bold text-brand-redtext" role="alert">
          {err}
        </p>
      )}

      {/* KPI atas: tiga angka utama bulan terpilih */}
      <div className="card strip mb-3 grid grid-cols-1 gap-3 p-4 min-[480px]:grid-cols-3">
        <div>
          <p className="text-xs font-bold text-brand-muted">Kas masuk · {monthLabel}</p>
          <p className="text-2xl font-extrabold tabular-nums">{fmtRp(t.revenue)}</p>
          <p className="text-xs font-bold text-brand-muted">{t.count} transaksi</p>
        </div>
        <div>
          <p className="text-xs font-bold text-brand-muted">Pengeluaran · {monthLabel}</p>
          <p className="text-2xl font-extrabold tabular-nums">{fmtRp(fin.expenses.reduce((s, e) => s + e.amount, 0))}</p>
          <p className="text-xs font-bold text-brand-muted">{fin.expenses.length} catatan</p>
        </div>
        <div>
          <p className="text-xs font-bold text-brand-muted">Laba bersih · {monthLabel}</p>
          <p className={`whitespace-nowrap text-2xl font-extrabold tabular-nums ${(pl.find((x) => x.label === 'Laba bersih')?.amount ?? 0) < 0 ? 'text-brand-redtext' : ''}`}>
            {fmtRp(pl.find((x) => x.label === 'Laba bersih')?.amount ?? 0)}
          </p>
          <p className="text-xs font-bold text-brand-muted">setelah HPP, komisi & beban tetap</p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Laba rugi */}
        <div className="card strip overflow-x-auto p-4">
          <h2 className="mb-2 font-extrabold">Laba Rugi {monthLabel}</h2>
          <table className="tbl">
            <tbody>
              {pl.map((row) => (
                <tr key={row.label} className={row.label === 'Laba bersih' ? 'bg-brand-paper font-extrabold' : ''}>
                  <td>{row.label}</td>
                  <td className={`text-right tabular-nums ${row.amount < 0 ? 'text-brand-redtext' : ''}`}>
                    {row.amount < 0 ? '-' : ''}
                    {fmtRpPlain(Math.abs(row.amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-brand-muted">
            Omzet {fmtRp(t.revenue)} dari {t.count} transaksi. Beban tetap bulanan {settings.fixed_costs.reduce((s, f) => s + f.amount, 0).toLocaleString('id-ID')} (ubah di Pengaturan).
          </p>
        </div>

        {/* Pengeluaran */}
        <div className="card p-4">
          <h2 className="mb-2 font-extrabold">Pengeluaran ({fin.expenses.length})</h2>
          {fin.expenses.length === 0 && <p className="text-sm text-brand-muted">Belum ada pengeluaran bulan ini.</p>}
          <ul className="divide-y divide-brand-line">
            {fin.expenses.map((e) => (
              <li key={e.id} className="flex items-center gap-2 py-1.5 text-sm">
                <span className="font-bold">{fin.expenseCats.find((c) => c.id === e.category_id)?.name ?? 'Lainnya'}</span>
                <span className="text-brand-muted">{e.note}</span>
                <span className="ml-auto tabular-nums">{fmtRp(e.amount)}</span>
                <span className="text-xs text-brand-muted">{fmtDate(e.spent_at)}</span>
              </li>
            ))}
          </ul>
          <h3 className="mt-4 mb-1 text-sm font-extrabold">Pemasukan lain ({fin.otherIncome.length})</h3>
          <ul className="divide-y divide-brand-line">
            {fin.otherIncome.map((i) => (
              <li key={i.id} className="flex items-center gap-2 py-1.5 text-sm">
                <span className="font-bold">{i.source}</span>
                <span className="ml-auto tabular-nums">{fmtRp(i.amount)}</span>
                <span className="text-xs text-brand-muted">{fmtDate(i.earned_at)}</span>
              </li>
            ))}
            {fin.otherIncome.length === 0 && <li className="text-sm text-brand-muted">belum ada</li>}
          </ul>
        </div>
      </div>

      <button
        type="button"
        className="btn-ghost mt-3"
        onClick={() =>
          downloadCsv(`keuangan-${month.slice(0, 7)}.csv`, [
            ['Laba Rugi', monthLabel],
            ...pl.map((r) => [r.label, r.amount]),
            [],
            ['Pengeluaran', 'Kategori', 'Catatan', 'Tanggal'],
            ...fin.expenses.map((e) => [e.amount, fin.expenseCats.find((c) => c.id === e.category_id)?.name ?? '', e.note ?? '', e.spent_at]),
            [],
            ['Pemasukan lain', 'Sumber', 'Tanggal'],
            ...fin.otherIncome.map((i) => [i.amount, i.source, i.earned_at])
          ])
        }
      >
        Unduh CSV Keuangan
      </button>

      {/* Modal pengeluaran */}
      <ExpenseModal
        open={expOpen}
        cats={fin.expenseCats}
        onClose={() => setExpOpen(false)}
        onDone={async () => {
          setExpOpen(false)
          toast('Pengeluaran tercatat.')
          await reload()
        }}
        setErr={setErr}
      />
      <IncomeModal
        open={incOpen}
        onClose={() => setIncOpen(false)}
        onDone={async () => {
          setIncOpen(false)
          toast('Pemasukan lain tercatat.')
          await reload()
        }}
        setErr={setErr}
      />
      <OwnerPinModal
        open={pinOpen}
        pinSet={settings.owner_pin_set ?? false}
        onClose={() => {
          setPinOpen(false)
          void reload()
        }}
        setErr={setErr}
      />
      <CategoriesModal
        open={catsOpen}
        settings={settings}
        onClose={() => {
          setCatsOpen(false)
          void reload()
        }}
        setErr={setErr}
      />
    </div>
  )
}

/** Owner menetapkan/mengganti PIN. Verifikasi PIN lama dulu bila sudah pernah diatur. */
function OwnerPinModal({ open, pinSet, onClose, setErr }: { open: boolean; pinSet: boolean; onClose: () => void; setErr: (s: string) => void }): ReactElement {
  const { toast } = useToast()
  const [oldPin, setOldPin] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const ok = pin.length >= 4 && (!pinSet || oldPin.length >= 4)
  return (
    <Modal open={open} title={pinSet ? 'Ganti PIN Owner' : 'Atur PIN Owner'} onClose={onClose}>
      <p className="mb-3 text-sm text-brand-muted">
        PIN dipakai membuka aksi sensitif: hapus/refund nota di Riwayat Transaksi. Simpan PIN ini untuk owner, jangan dibagikan ke kasir.
      </p>
      {pinSet && (
        <div className="mb-3">
          <label className="lbl" htmlFor="oldpin">
            PIN lama
          </label>
          <input id="oldpin" className="input" type="password" inputMode="numeric" autoComplete="off" value={oldPin} onChange={(e) => setOldPin(e.target.value.replace(/\D/g, ''))} />
        </div>
      )}
      <div className="mb-3">
        <label className="lbl" htmlFor="newpin">
          PIN baru (4+ digit angka)
        </label>
        <input id="newpin" className="input" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="contoh: 2711" />
      </div>
      <button
        type="button"
        className="btn-primary w-full"
        disabled={!ok || busy}
        onClick={async () => {
          setBusy(true)
          try {
            if (pinSet) {
              if (!(await verifyOwnerPin(oldPin))) throw new Error('PIN lama salah')
            }
            await setOwnerPin(pin)
            toast('PIN owner tersimpan.')
            onClose()
          } catch (ex) {
            setErr((ex as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? 'Menyimpan...' : 'Simpan PIN'}
      </button>
    </Modal>
  )
}

/** Kelola kategori pengeluaran (tersimpan di settings, admin saja). */
function CategoriesModal({ open, settings, onClose, setErr }: { open: boolean; settings: Settings; onClose: () => void; setErr: (s: string) => void }): ReactElement {
  const { toast } = useToast()
  const [cats, setCats] = useState(settings.expense_categories ?? [])
  const [busy, setBusy] = useState(false)
  return (
    <Modal open={open} title="Kategori Pengeluaran" onClose={onClose}>
      <p className="mb-3 text-sm text-brand-muted">Dipakai saat mencatat pengeluaran di halaman ini.</p>
      {cats.map((c, i) => (
        <div key={c.id ?? i} className="mb-2 flex items-center gap-2">
          <input
            className="input !h-10"
            value={c.name}
            onChange={(e) => setCats(cats.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            aria-label="Nama kategori"
          />
          <button type="button" className="icon-btn-danger" onClick={() => setCats(cats.filter((_, j) => j !== i))} aria-label="Hapus kategori">
            <Trash size={15} strokeWidth={2.25} aria-hidden />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn-ghost !min-h-0 !py-1.5 text-xs"
        onClick={() => setCats([...cats, { id: -Date.now(), name: '' }])}
      >
        + Kategori
      </button>
      <button
        type="button"
        className="btn-primary mt-3 w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            // id negatif = baris baru: nomori ulang di sisi server (1..n) saat simpan
            const cleaned = cats.filter((c) => c.name.trim()).map((c, i) => ({ id: c.id > 0 ? c.id : i + 1, name: c.name.trim() }))
            await saveSetting('expense_categories', cleaned)
            toast('Kategori tersimpan.')
            onClose()
          } catch (ex) {
            setErr((ex as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        Simpan Kategori
      </button>
    </Modal>
  )
}

function ExpenseModal({
  open,
  cats,
  onClose,
  onDone,
  setErr
}: {
  open: boolean
  cats: { id: number; name: string }[]
  onClose: () => void
  onDone: () => Promise<void>
  setErr: (s: string) => void
}): ReactElement {
  const [amount, setAmount] = useState(0)
  const [cat, setCat] = useState<number | ''>(cats[0]?.id ?? '')
  const [note, setNote] = useState('')
  return (
    <Modal open={open} title="Catat Pengeluaran" onClose={onClose}>
      <div className="mb-3">
        <label className="lbl" htmlFor="ecat">
          Kategori
        </label>
        <select id="ecat" className="input" value={cat} onChange={(e) => setCat(e.target.value ? parseInt(e.target.value, 10) : '')}>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <Numpad value={amount} onChange={setAmount} quick={[20000, 50000, 100000]} />
      <div className="mt-3">
        <label className="lbl" htmlFor="enote">
          Keterangan
        </label>
        <input id="enote" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="contoh: beli gas 3kg" />
      </div>
      <button
        type="button"
        className="btn-primary mt-3 w-full"
        disabled={amount <= 0}
        onClick={async () => {
          try {
            await addExpense(cat === '' ? null : cat, amount, note)
            setAmount(0)
            setNote('')
            await onDone()
          } catch (ex) {
            setErr((ex as Error).message)
          }
        }}
      >
        Simpan Pengeluaran
      </button>
    </Modal>
  )
}

function IncomeModal({
  open,
  onClose,
  onDone,
  setErr
}: {
  open: boolean
  onClose: () => void
  onDone: () => Promise<void>
  setErr: (s: string) => void
}): ReactElement {
  const [amount, setAmount] = useState(0)
  const [source, setSource] = useState('')
  return (
    <Modal open={open} title="Catat Pemasukan Lain" onClose={onClose}>
      <div className="mb-3">
        <label className="lbl" htmlFor="isrc">
          Sumber
        </label>
        <input id="isrc" className="input" value={source} onChange={(e) => setSource(e.target.value)} placeholder="contoh: penjualan minyak jelantah" />
      </div>
      <Numpad value={amount} onChange={setAmount} quick={[20000, 50000]} />
      <button
        type="button"
        className="btn-primary mt-3 w-full"
        disabled={amount <= 0 || !source.trim()}
        onClick={async () => {
          try {
            await addOtherIncome(source.trim(), amount, '')
            setAmount(0)
            setSource('')
            await onDone()
          } catch (ex) {
            setErr((ex as Error).message)
          }
        }}
      >
        Simpan Pemasukan
      </button>
    </Modal>
  )
}
