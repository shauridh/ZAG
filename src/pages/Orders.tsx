import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { loadPortalOrders, loadSettings, saveSetting, acceptOrder, rejectOrder, verifyOrderPayment, setOrderStatus, subscribeOrders, type PortalOrderT } from '../lib/db'
import { fmtRp } from '../lib/money'
import { fmtDateTime } from '../lib/dates'
import type { Settings } from '../lib/types'
import { Modal } from '../components/Modal'
import { startOrderAlert, stopOrderAlert } from '../lib/sound'
import { buildQrisContent } from '../lib/qris'
import { checkSchedule, DAY_LABELS } from '../lib/delivery-schedule'

const STATUS_LABEL: Record<string, string> = {
  menunggu: 'Menunggu validasi',
  ditolak: 'Ditolak',
  qris_dikirim: 'QRIS terkirim',
  menunggu_verifikasi: 'Cek pembayaran',
  diproses: 'Digoreng',
  dikirim: 'Diantar',
  selesai: 'Selesai',
  batal: 'Batal'
}

const STATUS_STYLE: Record<string, string> = {
  menunggu: 'bg-brand-gold text-brand-ink pulse-new',
  ditolak: 'bg-brand-line',
  qris_dikirim: 'bg-brand-redtext text-white',
  menunggu_verifikasi: 'bg-brand-redtext text-white',
  diproses: 'bg-brand-btn text-white',
  dikirim: 'bg-brand-btn text-white',
  selesai: 'bg-brand-paper text-brand-muted',
  batal: 'bg-brand-line text-brand-muted'
}

export default function Orders(): ReactElement {
  const [orders, setOrders] = useState<PortalOrderT[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [rejecting, setRejecting] = useState<PortalOrderT | null>(null)
  const [qrisFor, setQrisFor] = useState<PortalOrderT | null>(null)
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const [savingDelivery, setSavingDelivery] = useState(false)
  const known = useRef<Set<number>>(new Set())
  const firstLoad = useRef(true)

  const reload = useCallback(async () => {
    try {
      const [list, s] = await Promise.all([loadPortalOrders(), loadSettings()])
      // deteksi pesanan baru utk alarm (skip saat load pertama)
      if (!firstLoad.current) {
        const fresh = list.filter((o) => o.status === 'menunggu' && !known.current.has(o.id))
        if (fresh.length > 0) startOrderAlert()
      }
      firstLoad.current = false
      for (const o of list) known.current.add(o.id)
      setOrders(list)
      setSettings(s)
    } catch (ex) {
      setErr((ex as Error).message)
    }
  }, [])

  useEffect(() => {
    void reload()
    const off = subscribeOrders(() => void reload())
    return off
  }, [reload])

  const activeCount = orders.filter((o) => ['menunggu', 'qris_dikirim', 'menunggu_verifikasi', 'diproses'].includes(o.status)).length

  // Status gabungan saklar manual + jadwal (kalau dipasang) — sama dengan logika portal.
  // Dihitung ulang tiap menit supaya badge ikut pindah ON/LIBUR saat pergantian jam antar.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const iv = window.setInterval(() => setNow(new Date()), 60000)
    return () => window.clearInterval(iv)
  }, [])
  const sched = settings?.portal.delivery_schedule ?? null
  const schedToday = sched ? checkSchedule(sched, now) : null
  const manualOn = settings?.portal.delivery_enabled ?? true
  const deliveryOn = manualOn && (!schedToday || (schedToday.openToday && !schedToday.offHours))
  const schedOffReason = schedToday && (!schedToday.openToday || schedToday.offHours)
    ? !schedToday.openToday
      ? `hari ini libur${schedToday.next ? ` · buka lagi ${DAY_LABELS[schedToday.next.day]} ${schedToday.next.range}` : ''}`
      : `luar jam antar${schedToday.range ? ` (${schedToday.range})` : ''}${schedToday.next ? ` · buka lagi ${DAY_LABELS[schedToday.next.day]} ${schedToday.next.range}` : ''}`
    : ''

  const toggleDelivery = async (): Promise<void> => {
    if (!settings) return
    setSavingDelivery(true)
    try {
      await saveSetting('portal', { ...settings.portal, delivery_enabled: !settings.portal.delivery_enabled })
      await reload()
    } catch (ex) {
      setErr((ex as Error).message)
    } finally {
      setSavingDelivery(false)
    }
  }

  return (
    <div className="p-3 lg:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-extrabold">Pesanan Portal ({activeCount} aktif)</h1>
        {settings && (
          <>
            <button
              type="button"
              className={`!min-h-0 !py-2 text-xs font-extrabold ${manualOn ? 'btn-primary' : 'btn-ghost border-[1.5px] border-brand-gold text-brand-ink'}`}
              disabled={savingDelivery}
              aria-pressed={manualOn}
              onClick={() => void toggleDelivery()}
            >
              {savingDelivery ? 'Menyimpan...' : manualOn ? 'Antar: ON' : 'Antar: OFF'}
            </button>
            {manualOn && schedOffReason && (
              <span className="chip bg-brand-gold !py-1 text-xs" title={`Jadwal antar: ${schedOffReason}`}>
                Jadwal: libur
              </span>
            )}
          </>
        )}
        {orders.some((o) => o.status === 'menunggu') && (
          <button type="button" className="btn-gold" onClick={() => { stopOrderAlert(); void reload() }}>
            Diamkan alarm
          </button>
        )}
      </div>
      {!deliveryOn && (
        <p className="mb-2 rounded-lg bg-brand-gold/25 px-3 py-2 text-sm font-bold" role="status">
          Layanan antar sedang libur
          {manualOn ? schedOffReason && ` (${schedOffReason})` : ' (dimatikan manual)'}. Customer hanya bisa Ambil Sendiri di portal.
        </p>
      )}
      {err && (
        <p className="mb-2 rounded-lg bg-brand-redtext/10 px-3 py-2 text-sm font-bold text-brand-redtext" role="alert">
          {err}
        </p>
      )}
      {orders.length === 0 && <p className="py-10 text-center text-sm text-brand-muted">Belum ada pesanan masuk.</p>}

      {/* Papan alur: kartu terpenting dulu (cek bayar → menunggu → disiapkan → antrean lain) */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[...orders]
          .sort((a, b) => {
            const rank: Record<string, number> = { menunggu_verifikasi: 0, menunggu: 1, qris_dikirim: 2, diproses: 3, dikirim: 4, selesai: 5, batal: 6, ditolak: 7 }
            return (rank[a.status] ?? 8) - (rank[b.status] ?? 8)
          })
          .map((o) => (
          <div key={o.id} className={`card p-3 ${o.status === 'menunggu' ? 'border-brand-gold' : ''} ${o.status === 'menunggu_verifikasi' ? 'border-l-4 border-l-brand-gold' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-lg font-extrabold">#{o.id}</p>
                <p className="text-xs text-brand-muted">{fmtDateTime(o.created_at)}</p>
              </div>
              <span className={`chip ${STATUS_STYLE[o.status] ?? 'bg-brand-line'}`}>{STATUS_LABEL[o.status] ?? o.status}</span>
            </div>
            <ul className="mt-2 border-y border-brand-line py-2 text-sm font-bold">
              {o.items.map((it, i) => (
                <li key={i}>
                  {it.qty}× {it.name} <span className="font-normal text-brand-muted">{fmtRp(it.price)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm">
              Ongkir {fmtRp(o.delivery_fee)} · <span className="text-base font-extrabold">{fmtRp(o.total)}</span>
            </p>
            {o.note && <p className="mt-1 text-xs text-brand-muted">Catatan: {o.note}</p>}
            {o.reject_reason && <p className="mt-1 text-xs font-bold text-brand-redtext">Alasan tolak: {o.reject_reason}</p>}

            <div className="mt-2 flex flex-wrap gap-1.5">
              {o.status === 'menunggu' && (
                <>
                  <button
                    type="button"
                    className="btn-primary !min-h-0 !py-2 text-xs"
                    onClick={async () => {
                      try {
                        await acceptOrder(o.id)
                        setQrisFor(o)
                        await reload()
                      } catch (ex) {
                        setErr((ex as Error).message)
                      }
                    }}
                  >
                    Terima & Kirim QRIS
                  </button>
                  <button type="button" className="btn-danger !min-h-0 !py-2 text-xs" onClick={() => { setRejecting(o); setReason('') }}>
                    Tolak
                  </button>
                </>
              )}
              {o.status === 'menunggu_verifikasi' && (
                <button
                  type="button"
                  className="btn-primary !min-h-0 !py-2 text-xs"
                  onClick={async () => {
                    try {
                      await verifyOrderPayment(o.id)
                      stopOrderAlert()
                      await reload()
                    } catch (ex) {
                      setErr((ex as Error).message)
                    }
                  }}
                >
                  Pembayaran Masuk, Proses
                </button>
              )}
              {o.status === 'diproses' && (
                <button
                  type="button"
                  className="btn-primary !min-h-0 !py-2 text-xs"
                  onClick={async () => {
                    try {
                      await setOrderStatus(o.id, 'dikirim')
                      await reload()
                    } catch (ex) {
                      setErr((ex as Error).message)
                    }
                  }}
                >
                  Kirim
                </button>
              )}
              {o.status === 'dikirim' && (
                <button
                  type="button"
                  className="btn-primary !min-h-0 !py-2 text-xs"
                  onClick={async () => {
                    try {
                      await setOrderStatus(o.id, 'selesai')
                      await reload()
                    } catch (ex) {
                      setErr((ex as Error).message)
                    }
                  }}
                >
                  Tandai Selesai
                </button>
              )}
              {(o.status === 'qris_dikirim' || o.status === 'menunggu_verifikasi') && (
                <button type="button" className="btn-ghost !min-h-0 !py-2 text-xs" onClick={() => setQrisFor(o)}>
                  Lihat QRIS
                </button>
              )}
            </div>
          </div>
          ))}
      </div>

      {/* Modal tolak */}
      <Modal open={rejecting !== null} title={`Tolak Pesanan #${rejecting?.id ?? ''}`} onClose={() => setRejecting(null)}>
        <label className="lbl" htmlFor="rj">
          Alasan (dikirim ke customer)
        </label>
        <textarea id="rj" className="input !h-20" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Contoh: bahan habis untuk porsi ini" />
        <button
          type="button"
          className="btn-danger mt-3 w-full"
          disabled={!reason.trim()}
          onClick={async () => {
            try {
              await rejectOrder(rejecting!.id, reason.trim())
              setRejecting(null)
              await reload()
            } catch (ex) {
              setErr((ex as Error).message)
            }
          }}
        >
          Tolak Pesanan
        </button>
      </Modal>

      {/* Modal QRIS */}
      <Modal open={qrisFor !== null} title={`QRIS Pesanan #${qrisFor?.id ?? ''}`} onClose={() => setQrisFor(null)}>
        {qrisFor && settings && (
          <div className="text-center">
            {settings.qris.image ? (
              <img src={settings.qris.image} alt="Kode QRIS" className="mx-auto max-w-[240px] rounded-lg border border-brand-line" />
            ) : (
              <p className="rounded-lg bg-brand-paper p-4 text-sm font-bold text-brand-redtext">
                Gambar QRIS belum diatur. Unggah di Pengaturan, Halaman QRIS.
              </p>
            )}
            <p className="mt-2 text-sm text-brand-muted">
              Minta customer scan & bayar tepat <span className="font-extrabold text-brand-ink">{fmtRp(qrisFor.total)}</span>, lalu tekan "Sudah Bayar" di portal-nya.
            </p>
            <p className="mt-1 break-all text-[10px] text-brand-muted">
              {buildQrisContent(settings.store.name, qrisFor.total).slice(0, 90)}...
            </p>
          </div>
        )}
      </Modal>
    </div>
  )
}
