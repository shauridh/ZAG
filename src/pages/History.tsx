import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { loadTransactions, loadCatalog, refundTx, deleteTx, editTx, txIsEditable, TX_STATUS_LABEL, type Catalog } from '../lib/db'
import { fmtRp, fmtRpPlain } from '../lib/money'
import type { Transaction, TxStatus } from '../lib/types'
import { Modal } from '../components/Modal'
import { fmtDate, fmtDateTime, todayISO } from '../lib/dates'
import { CHANNEL_LABEL } from '../lib/escpos'
import { buildReceiptHtml, receiptFromTx } from '../lib/escpos'
import { loadSettings } from '../lib/db'
import type { Settings } from '../lib/types'
import { useToast } from '../components/Toast'

const METHOD_LABEL: Record<string, string> = { cash: 'Tunai', qris: 'QRIS', transfer: 'Transfer' }

const STATUS_CHIP: Record<TxStatus, string> = {
  normal: '',
  direvisi: 'bg-brand-paper text-brand-muted',
  refund: 'bg-brand-gold',
  batal: 'bg-brand-redtext/10 text-brand-redtext'
}

export default function History(): ReactElement {
  const { toast } = useToast()
  const [txs, setTxs] = useState<Transaction[] | null>(null)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [date, setDate] = useState(todayISO())
  const [err, setErr] = useState('')
  const [detail, setDetail] = useState<Transaction | null>(null)
  const [confirm, setConfirm] = useState<{ tx: Transaction; act: 'refund' | 'delete' } | null>(null)
  const [reason, setReason] = useState('')
  const [edit, setEdit] = useState<Transaction | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async (d: string) => {
    setTxs(null)
    try {
      const rows = await loadTransactions(d + 'T00:00:00', d + 'T23:59:59', true)
      setTxs([...rows].reverse())
      setErr('')
    } catch (ex) {
      setErr((ex as Error).message)
      setTxs([])
    }
  }, [])

  useEffect(() => {
    void reload(date)
  }, [date, reload])

  useEffect(() => {
    void loadCatalog().then(setCatalog).catch(() => setCatalog(null))
    void loadSettings().then(setSettings).catch(() => setSettings(null))
  }, [])

  const dayTxs = txs ?? []
  const cashNet = useMemo(
    () =>
      dayTxs.reduce((s, t) => s + (t.payments ?? []).filter((p) => p.method === 'cash').reduce((a, p) => a + p.amount, 0), 0),
    [dayTxs]
  )
  const salesCount = dayTxs.filter((t) => t.total >= 0 && (t.status ?? 'normal') === 'normal').length
  const refunded = dayTxs.reduce((s, t) => s + (t.status === 'refund' ? t.refund_amount ?? 0 : 0), 0)

  const act = async (): Promise<void> => {
    if (!confirm) return
    setBusy(true)
    setErr('')
    try {
      if (confirm.act === 'refund') {
        const r = await refundTx(confirm.tx.id, reason)
        toast(`Refund ${fmtRp(r.amount)} tercatat, nota ${r.receipt_no}.`)
      } else {
        await deleteTx(confirm.tx.id, reason)
        toast(`Nota ${confirm.tx.receipt_no ?? confirm.tx.id} dibatalkan, stok sudah kembali.`)
      }
      setConfirm(null)
      setReason('')
      await reload(date)
    } catch (ex) {
      setErr((ex as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-3 lg:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-extrabold">Riwayat Transaksi</h1>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" className="btn-ghost !min-h-0 !px-3 !py-2" onClick={() => setDate((d) => prevDay(d))} aria-label="Hari sebelumnya">
            ‹
          </button>
          <input
            type="date"
            className="input !h-10 !w-44"
            value={date}
            max={todayISO()}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            aria-label="Pilih tanggal"
          />
          <button type="button" className="btn-ghost !min-h-0 !px-3 !py-2" onClick={() => setDate((d) => nextDay(d))} aria-label="Hari berikutnya">
            ›
          </button>
          {date !== todayISO() && (
            <button type="button" className="btn-ghost !min-h-0 !px-3 !py-2" onClick={() => setDate(todayISO())}>
              Hari ini
            </button>
          )}
        </div>
      </div>

      <dl className="mb-3 grid max-w-2xl grid-cols-3 gap-2 text-sm">
        <div className="card strip p-3">
          <dt className="text-xs font-bold text-brand-muted">Nota terjual</dt>
          <dd className="text-lg font-extrabold tabular-nums">{salesCount}</dd>
        </div>
        <div className="card strip p-3">
          <dt className="text-xs font-bold text-brand-muted">Tunai masuk-keluar</dt>
          <dd className={`text-lg font-extrabold tabular-nums ${cashNet < 0 ? 'text-brand-redtext' : ''}`}>{fmtRp(cashNet)}</dd>
        </div>
        <div className="card strip p-3">
          <dt className="text-xs font-bold text-brand-muted">Total refund</dt>
          <dd className="text-lg font-extrabold tabular-nums">{fmtRp(refunded)}</dd>
        </div>
      </dl>

      {err && (
        <p className="mb-2 max-w-2xl rounded-lg bg-brand-redtext/10 px-3 py-2 text-sm font-bold text-brand-redtext" role="alert">
          {err}
        </p>
      )}

      <div className="card max-w-3xl overflow-x-auto">
        <table className="tbl min-w-[640px]">
          <thead>
            <tr>
              <th>Nota</th>
              <th>Jam</th>
              <th>Channel</th>
              <th className="text-right">Total</th>
              <th>Status</th>
              <th className="text-center">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {txs === null && (
              <tr>
                <td colSpan={6} className="text-center text-brand-muted">
                  Memuat...
                </td>
              </tr>
            )}
            {txs !== null && dayTxs.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-brand-muted">
                  Tidak ada transaksi pada {fmtDate(date)}.
                </td>
              </tr>
            )}
            {dayTxs.map((t) => {
              const st = (t.status ?? 'normal') as TxStatus
              return (
                <tr key={t.id} className={st !== 'normal' ? 'opacity-70' : ''}>
                  <td className="whitespace-nowrap font-bold">{t.receipt_no ?? `#${t.id}`}</td>
                  <td className="whitespace-nowrap">{fmtDateTime(t.created_at).split(' ')[1]}</td>
                  <td>{CHANNEL_LABEL[t.order_type] ?? t.order_type}</td>
                  <td className={`whitespace-nowrap text-right font-extrabold tabular-nums ${t.total < 0 ? 'text-brand-redtext' : ''}`}>
                    {fmtRp(t.total)}
                  </td>
                  <td>
                    {st !== 'normal' ? (
                      <span className={`chip ${STATUS_CHIP[st]}`}>{TX_STATUS_LABEL[st]}</span>
                    ) : (
                      <span className="text-xs text-brand-muted">lunas</span>
                    )}
                  </td>
                  <td>
                    <div className="flex justify-center gap-1">
                      <button type="button" className="btn-ghost !min-h-0 !px-2 !py-1 text-xs" onClick={() => setDetail(t)}>
                        Lihat
                      </button>
                      {txIsEditable(t) && catalog && (
                        <>
                          <button type="button" className="btn-ghost !min-h-0 !px-2 !py-1 text-xs" onClick={() => setEdit(t)}>
                            Ubah
                          </button>
                          <button type="button" className="btn-ghost !min-h-0 !px-2 !py-1 text-xs" onClick={() => setConfirm({ tx: t, act: 'delete' })}>
                            Hapus
                          </button>
                          <button type="button" className="btn-ghost !min-h-0 !px-2 !py-1 text-xs font-bold text-brand-redtext" onClick={() => setConfirm({ tx: t, act: 'refund' })}>
                            Refund
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Detail nota */}
      <Modal open={detail !== null} title={`Nota ${detail?.receipt_no ?? ''}`} onClose={() => setDetail(null)}>
        {detail && settings && (
          <TxDetail
            tx={detail}
            receiptHtml={buildReceiptHtml(
              receiptFromTx(
                settings,
                { ...detail, receipt_no: detail.receipt_no ?? `#${detail.id}` },
                detail.items ?? [],
                detail.payments ?? [],
                ''
              ),
              settings.receipt.width_mm
            )}
          />
        )}
      </Modal>

      {/* Konfirmasi hapus / refund */}
      <Modal
        open={confirm !== null}
        title={confirm?.act === 'refund' ? 'Refund Transaksi' : 'Hapus Transaksi'}
        onClose={() => {
          setConfirm(null)
          setReason('')
        }}
      >
        {confirm && (
          <div>
            <p className="mb-2 text-sm">
              {confirm.act === 'refund' ? (
                <>
                  Kembalikan <b>{fmtRp(confirm.tx.total)}</b> untuk nota <b>{confirm.tx.receipt_no ?? confirm.tx.id}</b>? Stok barang juga dikembalikan.
                </>
              ) : (
                <>
                  Batalkan nota <b>{confirm.tx.receipt_no ?? confirm.tx.id}</b>? Dipakai kalau salah input: tanpa pergerakan uang, stok kembali, jejak nota tetap ada.
                </>
              )}
            </p>
            <p className="mb-3 text-xs font-bold text-brand-muted">
              Nota yang sudah diproses tidak bisa diubah lagi. Tindakan ini tercatat di sistem.
            </p>
            <label className="lbl" htmlFor="reason">
              Alasan {confirm.act === 'delete' ? '(opsional)' : '(opsional)'}
            </label>
            <input id="reason" className="input mb-3" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Contoh: pelanggan batal, salah input menu" />
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary flex-1"
                disabled={busy}
                onClick={() => void act()}
              >
                {busy ? 'Memproses...' : confirm.act === 'refund' ? 'Ya, Refund' : 'Ya, Batalkan Nota'}
              </button>
              <button
                type="button"
                className="btn-ghost flex-1"
                onClick={() => {
                  setConfirm(null)
                  setReason('')
                }}
              >
                Batal
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit nota */}
      {edit && catalog && (
        <EditModal
          tx={edit}
          catalog={catalog}
          onClose={() => setEdit(null)}
          onDone={async (newId) => {
            setEdit(null)
            toast(`Nota diperbarui. Nota baru #${newId} sudah diterbitkan.`)
            await reload(date)
          }}
          setErr={setErr}
        />
      )}
    </div>
  )
}

function prevDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() - 1)
  return localISO(d)
}

function nextDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  if (localISO(d) > todayISO()) return iso
  return localISO(d)
}

function localISO(d: Date): string {
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}

function TxDetail({ tx, receiptHtml }: { tx: Transaction; receiptHtml: string }): ReactElement {
  const st = (tx.status ?? 'normal') as TxStatus
  return (
    <div>
      <p className="mb-2 text-sm text-brand-muted">
        {fmtDateTime(tx.created_at)} · {CHANNEL_LABEL[tx.order_type] ?? tx.order_type}
        {st !== 'normal' && ` · ${TX_STATUS_LABEL[st]}`}
      </p>
      <table className="w-full text-sm">
        <tbody>
          {(tx.items ?? []).map((it, i) => (
            <tr key={i} className={it.qty < 0 ? 'text-brand-redtext' : ''}>
              <td className="py-0.5 font-bold">{it.name}</td>
              <td className="whitespace-nowrap text-right text-brand-muted">{fmtQty(it.qty)} × {fmtRpPlain(it.price)}</td>
              <td className="whitespace-nowrap text-right font-bold tabular-nums">{fmtRpPlain(it.qty * it.price)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 border-t-[1.5px] border-brand-line pt-2 text-sm">
        <div className="flex justify-between">
          <span className="text-brand-muted">Subtotal</span>
          <span className="tabular-nums">{fmtRpPlain(tx.subtotal)}</span>
        </div>
        {tx.discount > 0 && (
          <div className="flex justify-between">
            <span className="text-brand-muted">Diskon</span>
            <span className="tabular-nums">-{fmtRpPlain(tx.discount)}</span>
          </div>
        )}
        <div className="flex justify-between text-base font-extrabold">
          <span>Total</span>
          <span className="tabular-nums">{fmtRp(tx.total)}</span>
        </div>
        {(tx.payments ?? []).map((p, i) => (
          <div key={i} className="flex justify-between text-sm text-brand-muted">
            <span>{METHOD_LABEL[p.method] ?? p.method}</span>
            <span className="tabular-nums">{fmtRpPlain(p.amount)}</span>
          </div>
        ))}
      </div>
      {tx.note && <p className="mt-2 rounded-lg bg-brand-paper px-3 py-2 text-xs">Catatan: {tx.note}</p>}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-bold text-brand-muted">Tampilan struk</summary>
        <div className="mt-1 overflow-x-auto rounded-lg border border-brand-line bg-white p-2" dangerouslySetInnerHTML={{ __html: receiptHtml }} />
      </details>
    </div>
  )
}

const fmtQty = (n: number): string => (Number.isInteger(n) ? String(n) : n.toLocaleString('id-ID', { maximumFractionDigits: 2 }))

/** Edit nota: pilih ulang item dari katalog, ubah diskon, terbitkan nota revisi. */
function EditModal({
  tx,
  catalog,
  onClose,
  onDone,
  setErr
}: {
  tx: Transaction
  catalog: Catalog
  onClose: () => void
  onDone: (newId: number) => void
  setErr: (s: string) => void
}): ReactElement {
  const [lines, setLines] = useState<{ product_id: number; qty: number }[]>(() =>
    (tx.items ?? [])
      .map((it) => {
        const prod = catalog.products.find((p) => p.name === it.name)
        return prod ? { product_id: prod.id, qty: it.qty } : null
      })
      .filter((x): x is { product_id: number; qty: number } => x !== null)
  )
  const [discount, setDiscount] = useState(tx.discount)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const priceOf = (pid: number): number => catalog.products.find((p) => p.id === pid)?.price ?? 0
  const subtotal = lines.reduce((s, l) => s + l.qty * priceOf(l.product_id), 0)
  const paid = (tx.payments ?? []).reduce((s, p) => s + p.amount, 0)
  const total = Math.max(0, subtotal - discount)
  const overPaid = total > paid && !(tx.order_type === 'gofood' || tx.order_type === 'grabfood' || tx.order_type === 'shopeefood')

  const setQty = (pid: number, qty: number): void =>
    setLines((ls) => ls.map((l) => (l.product_id === pid ? { ...l, qty: Math.max(0, qty) } : l)).filter((l) => l.qty > 0))

  return (
    <Modal open title={`Ubah Nota ${tx.receipt_no ?? tx.id}`} onClose={onClose} wide>
      <p className="mb-3 text-sm text-brand-muted">
        Nota lama ditandai direvisi dan nota baru diterbitkan. Uang yang sudah diterima ({fmtRp(paid)}) dipakai ulang, jadi total revisi tidak boleh melebihinya.
      </p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {catalog.products.filter((p) => p.is_active).map((p) => (
          <button key={p.id} type="button" className="chip h-8 border-[1.5px] border-brand-line bg-brand-card" onClick={() => setLines((ls) => (ls.some((l) => l.product_id === p.id) ? ls : [...ls, { product_id: p.id, qty: 1 }]))}>
            + {p.name}
          </button>
        ))}
      </div>
      {lines.length === 0 && <p className="mb-2 text-sm font-bold text-brand-muted">Belum ada item. Ketuk menu di atas.</p>}
      <div className="mb-3 space-y-1.5">
        {lines.map((l) => {
          const p = catalog.products.find((x) => x.id === l.product_id)
          return (
            <div key={l.product_id} className="flex items-center gap-2 rounded-lg border border-brand-line p-2">
              <p className="mr-auto text-sm font-bold">{p?.name ?? l.product_id}</p>
              <button type="button" className="btn-ghost !min-h-0 !h-9 !w-9 !px-0 text-lg" onClick={() => setQty(l.product_id, l.qty - 1)} aria-label={`Kurangi ${p?.name}`}>
                −
              </button>
              <input
                className="input !h-9 !w-14 !px-1 text-center"
                value={l.qty}
                inputMode="numeric"
                onChange={(e) => setQty(l.product_id, parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)}
                aria-label={`Jumlah ${p?.name}`}
              />
              <button type="button" className="btn-ghost !min-h-0 !h-9 !w-9 !px-0 text-lg" onClick={() => setQty(l.product_id, l.qty + 1)} aria-label={`Tambah ${p?.name}`}>
                +
              </button>
              <p className="w-24 text-right text-sm font-extrabold tabular-nums">{fmtRpPlain(l.qty * priceOf(l.product_id))}</p>
            </div>
          )
        })}
      </div>
      <div className="mb-2 flex items-center gap-2">
        <label className="text-xs font-bold text-brand-muted" htmlFor="edisc">
          Diskon Rp
        </label>
        <input
          id="edisc"
          className="input !h-9 flex-1 text-right"
          inputMode="numeric"
          value={discount ? fmtRpPlain(discount) : ''}
          onChange={(e) => setDiscount(Math.min(subtotal, parseInt(e.target.value.replace(/\D/g, ''), 10) || 0))}
          placeholder="0"
        />
      </div>
      <input className="input !h-9 mb-2 text-sm" placeholder="Catatan revisi (opsional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Catatan revisi" />
      <div className="mb-1 flex justify-between text-sm font-bold text-brand-muted">
        <span>Subtotal</span>
        <span className="tabular-nums">{fmtRp(subtotal)}</span>
      </div>
      <div className="mb-1 flex justify-between text-lg font-extrabold">
        <span>Total baru</span>
        <span className="tabular-nums">{fmtRp(total)}</span>
      </div>
      <p className={`mb-3 text-xs font-bold ${overPaid ? 'text-brand-redtext' : 'text-brand-muted'}`}>
        {overPaid ? `Melebihi uang terbayar ${fmtRp(paid)}, kurangi item atau tambah diskon.` : `Uang terbayar ${fmtRp(paid)}.`}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-primary flex-1"
          disabled={busy || lines.length === 0 || overPaid}
          onClick={async () => {
            setBusy(true)
            setErr('')
            try {
              const newId = await editTx(tx.id, lines, discount, note)
              onDone(newId)
            } catch (ex) {
              setErr((ex as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'Menyimpan...' : 'Simpan Revisi'}
        </button>
        <button type="button" className="btn-ghost flex-1" onClick={onClose}>
          Batal
        </button>
      </div>
    </Modal>
  )
}
