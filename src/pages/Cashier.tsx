import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { loadCatalog, loadSettings, createTx, currentShift, openShift, subscribeOrders, type Catalog, type TxResult } from '../lib/db'
import { ingIndex, maxAvailableQty } from '../lib/hpp'
import { fmtRp, fmtRpPlain } from '../lib/money'
import type { OrderType, Payment, Product, Settings, Shift } from '../lib/types'
import { Numpad } from '../components/Numpad'
import { Modal } from '../components/Modal'
import { beepRegister, startOrderAlert, stopOrderAlert, vibrateSuccess } from '../lib/sound'
import { buildReceiptHtml, buildReceiptText, receiptFromTx, CHANNEL_LABEL } from '../lib/escpos'
import { bluetoothAvailable, printTextBluetooth, printHtmlFallback } from '../lib/bluetooth-printer'

interface CartLine {
  product_id: number
  name: string
  qty: number
  price: number
  max: number
}

const ORDER_TYPES: { key: OrderType; label: string; online: boolean }[] = [
  { key: 'dinein', label: 'Makan di tempat', online: false },
  { key: 'takeaway', label: 'Bungkus', online: false },
  { key: 'gofood', label: 'GoFood', online: true },
  { key: 'grabfood', label: 'GrabFood', online: true },
  { key: 'shopeefood', label: 'ShopeeFood', online: true },
  { key: 'delivery', label: 'Delivery sendiri', online: false }
]

const METHOD_LABEL: Record<string, string> = { cash: 'Tunai', qris: 'QRIS', transfer: 'Transfer' }

export default function Cashier(): ReactElement {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [shift, setShift] = useState<Shift | null>(null)
  const [shiftGate, setShiftGate] = useState(false) // popup kunci shift
  const [openingShift, setOpeningShift] = useState(false)
  const [cat, setCat] = useState<number | 'all'>('all')
  const [q, setQ] = useState('')
  const [hideSoldOut, setHideSoldOut] = useState(false)
  const [cart, setCart] = useState<CartLine[]>([])
  const [orderType, setOrderType] = useState<OrderType>('dinein')
  const [discount, setDiscount] = useState(0)
  const [note, setNote] = useState('')
  const [checkout, setCheckout] = useState(false) // layar penuh checkout
  const [payMethod, setPayMethod] = useState<Payment['method']>('cash')
  const [cashVal, setCashVal] = useState(0)
  const [done, setDone] = useState<{ tx: TxResult; change: number } | null>(null)
  const [err, setErr] = useState('')
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [newOrders, setNewOrders] = useState(false)

  const reload = useCallback(async () => {
    try {
      const [c, s, sh] = await Promise.all([loadCatalog(), loadSettings(), currentShift()])
      setCatalog(c)
      setSettings(s)
      setShift(sh)
      setLoadError('')
    } catch (ex) {
      setLoadError((ex as Error).message)
    }
  }, [])

  useEffect(() => {
    void reload().then(() => {
      // popup kunci shift hanya saat menu kasir dibuka tanpa shift aktif
      currentShift().then((sh) => {
        if (!sh) setShiftGate(true)
      })
    })
    const off = subscribeOrders(() => {
      setNewOrders(true)
      startOrderAlert()
    })
    return off
  }, [reload])

  const online = ORDER_TYPES.find((o) => o.key === orderType)?.online ?? false

  const ingById = useMemo(() => ingIndex(catalog?.ingredients ?? []), [catalog])

  const maxOf = useCallback(
    (productId: number): number => {
      if (!catalog) return 0
      return maxAvailableQty(productId, catalog.recipeByProduct, ingById)
    },
    [catalog, ingById]
  )

  // Katalog dipartisi: yang siap jual selalu di depan, habis di ekor.
  // Kasir scan yang ready dulu; item habis tetap ada utk menjawab pelanggan.
  const { ready, soldOut } = useMemo(() => {
    const readyL: Product[] = []
    const soldOutL: Product[] = []
    for (const p of catalog?.products ?? []) {
      if (
        !p.is_active ||
        (cat !== 'all' && p.category_id !== cat) ||
        (q.trim() !== '' && !p.name.toLowerCase().includes(q.trim().toLowerCase()))
      )
        continue
      ;(maxOf(p.id) > 0 ? readyL : soldOutL).push(p)
    }
    return { ready: readyL, soldOut: soldOutL }
  }, [catalog, cat, q, maxOf])
  const products = hideSoldOut ? ready : [...ready, ...soldOut]
  const totalMenu = ready.length + soldOut.length
  const readyPct = totalMenu === 0 ? 0 : Math.round((ready.length / totalMenu) * 100)

  const addToCart = (p: { id: number; name: string; price: number }): void => {
    const max = maxOf(p.id)
    setCart((c) => {
      const found = c.find((x) => x.product_id === p.id)
      if (found) {
        if (found.qty + 1 > found.max) return c
        return c.map((x) => (x.product_id === p.id ? { ...x, qty: x.qty + 1 } : x))
      }
      if (max < 1) return c
      return [...c, { product_id: p.id, name: p.name, qty: 1, price: p.price, max }]
    })
  }

  const setQty = (pid: number, qty: number): void =>
    setCart((c) =>
      c.map((x) => (x.product_id === pid ? { ...x, qty: Math.max(0, Math.min(x.max, qty)) } : x)).filter((x) => x.qty > 0)
    )

  const subtotal = cart.reduce((s, l) => s + l.qty * l.price, 0)
  const total = Math.max(0, subtotal - discount)

  const closeCheckout = (): void => {
    setCheckout(false)
    setDone(null)
    setCashVal(0)
    setPayMethod('cash')
    setErr('')
  }

  const doOpenShift = async (): Promise<void> => {
    setOpeningShift(true)
    setErr('')
    try {
      await openShift(settings?.shift.float_cash ?? 350000)
      await reload()
      setShiftGate(false)
    } catch (ex) {
      setErr((ex as Error).message)
    } finally {
      setOpeningShift(false)
    }
  }

  const receiptText = (tx: TxResult): string =>
    buildReceiptText(receiptFromTx(settings!, tx, tx.items, tx.payments, ''), settings!.receipt.width_mm)

  /** Struk HTML utk panel kanan popup: preview hidup saat belum bayar, struk asli setelah bayar. */
  const receiptHtml = useMemo(() => {
    if (!settings) return ''
    if (done) return buildReceiptHtml(receiptFromTx(settings, done.tx, done.tx.items, done.tx.payments, ''), settings.receipt.width_mm)
    const pays = online ? [] : [{ method: payMethod, amount: payMethod === 'cash' ? cashVal : total }]
    const draft = {
      receipt_no: 'MENUNGGU BAYAR',
      order_type: orderType as string,
      subtotal,
      discount,
      total,
      created_at: new Date().toISOString()
    }
    return buildReceiptHtml(
      receiptFromTx(settings, draft, cart.map((l) => ({ name: l.name, qty: l.qty, price: l.price })), pays, ''),
      settings.receipt.width_mm
    )
  }, [done, settings, cart, subtotal, discount, total, payMethod, cashVal, online, orderType])

  const doPrint = async (mode: 'bt' | 'dialog'): Promise<void> => {
    if (!done || !settings) return
    const html = buildReceiptHtml(receiptFromTx(settings, done.tx, done.tx.items, done.tx.payments, ''), settings.receipt.width_mm)
    if (mode === 'bt') {
      const how = await printTextBluetooth(receiptText(done.tx))
      if (how === 'bt') return
      if (how === 'fallback') {
        printHtmlFallback(html)
        return
      }
      // printer tersimpan tapi tidak terjangkau: jangan buka dialog pair, cukup arahkan
      setErr('Printer Bluetooth tidak terjangkau. Nyalakan printer, lalu coba lagi atau buka Pengaturan → Printer.')
    } else {
      printHtmlFallback(html)
    }
  }

  const shareReceipt = async (): Promise<void> => {
    if (!done) return
    const text = receiptText(done.tx)
    try {
      if (navigator.share) {
        await navigator.share({ title: `Struk ${done.tx.receipt_no}`, text })
      } else {
        await navigator.clipboard.writeText(text)
        window.alert('Struk disalin ke clipboard.')
      }
    } catch {
      // user membatalkan share
    }
  }

  const submitTx = async (): Promise<void> => {
    setBusy(true)
    setErr('')
    try {
      const payments: Payment[] = online ? [] : [{ method: payMethod, amount: cashVal }]
      const tx = await createTx({
        orderType,
        items: cart.map((l) => ({ product_id: l.product_id, qty: l.qty })),
        payments,
        discount,
        note: note || undefined,
        itemsDisplay: cart.map((l) => ({ name: l.name, qty: l.qty, price: l.price }))
      })
      beepRegister()
      vibrateSuccess()
      const change = payMethod === 'cash' ? Math.max(0, cashVal - total) : 0
      setDone({ tx, change })
      setCart([])
      setDiscount(0)
      setNote('')
      void reload()
      // print otomatis bila diaktifkan di Pengaturan; gagal sambung tidak
      // menghentikan kasir dan tidak memunculkan dialog pair mendadak
      if (settings?.printer.auto_print) {
        void printTextBluetooth(receiptText(tx)).then((how) => {
          if (how === 'reconnect-gagal') {
            setErr('Print otomatis gagal: printer Bluetooth tidak terjangkau. Transaksi tetap tersimpan.')
          }
        })
      }
    } catch (ex) {
      setErr((ex as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!catalog || !settings) {
    const loadErr = loadError
    return (
      <div className="p-6">
        <p className="text-sm font-bold text-brand-muted">{loadErr ? 'Gagal memuat menu:' : 'Memuat menu...'}</p>
        {loadErr && (
          <>
            <p className="mt-1 max-w-md text-sm text-brand-redtext" role="alert">{loadErr}</p>
            <button type="button" className="btn-primary mt-3" onClick={() => void reload()}>
              Coba lagi
            </button>
          </>
        )}
      </div>
    )
  }

  const chipOf = (p: { id: number }): string => {
    const m = maxOf(p.id)
    if (m <= 0) return 'Habis'
    if (m <= 5) return `sisa ${m}`
    return ''
  }

  return (
    <div className="flex h-full flex-col lg:flex-row">
      {/* Katalog — min-h agar grid menu tak pernah gepeng saat keranjang tinggi (layout kolom <lg) */}
      <section className="flex min-h-[300px] flex-1 flex-col p-3 lg:min-h-0 lg:p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            className="input min-w-40 max-w-56 flex-1"
            placeholder="Cari menu..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Cari menu"
          />
          {/* Tanda tangan: bar ketersediaan ala nota — kebenaran stok adalah kebenaran menu kasir */}
          <div
            className="flex min-w-36 items-center gap-2"
            title={`${ready.length} dari ${totalMenu} menu siap dijual`}
          >
            <div className="flex h-2.5 flex-1 overflow-hidden rounded border border-brand-line bg-brand-card" role="img" aria-label={`${ready.length} dari ${totalMenu} menu siap dijual`}>
              <div className="h-full bg-brand-btn" style={{ width: `${readyPct}%` }} />
            </div>
            <span className="text-[11px] font-extrabold tabular-nums text-brand-muted">
              {ready.length}/{totalMenu} siap
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={hideSoldOut}
            onClick={() => setHideSoldOut(!hideSoldOut)}
            className={`chip h-9 px-3 ${hideSoldOut ? 'bg-brand-btn text-white' : 'border-[1.5px] border-brand-line bg-brand-card'}`}
          >
            {hideSoldOut ? 'Tampilkan habis' : 'Sembunyikan habis'}
          </button>
          {newOrders && (
            <button
              type="button"
              className="btn-gold pulse-new"
              onClick={() => {
                setNewOrders(false)
                stopOrderAlert()
                window.alert('Ada pesanan baru dari portal. Buka halaman Pesanan untuk memproses.')
              }}
            >
              Pesanan baru masuk!
            </button>
          )}
          {!shift && (
            <button type="button" className="chip bg-brand-redtext font-bold text-white" onClick={() => setShiftGate(true)}>
              Shift belum dibuka — ketuk untuk buka
            </button>
          )}
        </div>
        <div className="no-scrollbar mb-3 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Kategori">
          <button
            type="button"
            role="tab"
            aria-selected={cat === 'all'}
            className={`chip h-9 shrink-0 px-3 ${cat === 'all' ? 'bg-brand-btn text-white' : 'border-[1.5px] border-brand-line bg-brand-card'}`}
            onClick={() => setCat('all')}
          >
            Semua
          </button>
          {catalog.categories.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={cat === c.id}
              className={`chip h-9 shrink-0 px-3 ${cat === c.id ? 'bg-brand-btn text-white' : 'border-[1.5px] border-brand-line bg-brand-card'}`}
              onClick={() => setCat(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-2 overflow-y-auto sm:grid-cols-3 xl:grid-cols-4">
          {products.map((p) => {
            const habis = maxOf(p.id) <= 0
            const tag = chipOf(p)
            // preferensi ukuran kartu dari Pengaturan → Tablet & Layar (default besar)
            const besar = (settings?.tablet?.card_size ?? 'besar') === 'besar'
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => addToCart(p)}
                disabled={habis}
                title={p.name}
                className={`card relative flex flex-col overflow-hidden p-0 text-left ${habis ? 'opacity-50' : 'hover:border-brand-btn'} ${besar ? 'min-h-[220px]' : 'min-h-[150px]'}`}
              >
                {/* slot foto tinggi tetap: kartu dengan/tanpa foto selalu sama tinggi; contain agar foto tidak terpotong */}
                {p.photo ? (
                  <img
                    src={p.photo}
                    alt={p.name}
                    className={`${besar ? 'h-[110px]' : 'h-[64px]'} w-full shrink-0 border-b-[1.5px] border-brand-line object-contain`}
                    style={{ background: 'linear-gradient(135deg,#F6E7D8,#EFD9C4)' }}
                    loading="lazy"
                  />
                ) : (
                  <div
                    className={`${besar ? 'h-[110px]' : 'h-[64px]'} w-full shrink-0 border-b-[1.5px] border-brand-line`}
                    style={{ background: 'linear-gradient(135deg,#F6E7D8,#EFD9C4)' }}
                    aria-hidden
                  />
                )}
                {/* chip stok menempel di pojok foto: status habis/sisa terlihat sekali lirik */}
                {tag && (
                  <span className={`chip absolute right-1.5 top-1.5 ${tag === 'Habis' ? 'bg-brand-redtext text-white' : 'bg-brand-gold'}`}>{tag}</span>
                )}
                {/* nama & harga satu grup di tengah: tanpa celah kosong di antara keduanya */}
                <span className="flex flex-1 flex-col items-start justify-center gap-0.5 p-2.5">
                  <span className="line-clamp-2 text-base font-extrabold leading-snug">{p.name}</span>
                  <span className="text-base font-extrabold tabular-nums">{fmtRp(p.price)}</span>
                </span>
              </button>
            )
          })}
          {products.length === 0 && (
            <div className="col-span-full py-8 text-center">
              <p className="text-sm font-bold text-brand-muted">
                {hideSoldOut && soldOut.length > 0 && ready.length === 0
                  ? 'Semua menu di filter ini sedang habis.'
                  : 'Tidak ada menu yang cocok.'}
              </p>
              <button type="button" className="btn-ghost !min-h-0 mt-2 !py-1.5 text-xs" onClick={() => { setQ(''); setCat('all'); setHideSoldOut(false) }}>
                Reset pencarian
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Keranjang */}
      <aside className="flex w-full shrink-0 flex-col border-t-[1.5px] border-brand-line bg-brand-card lg:w-[340px] lg:border-l-[1.5px] lg:border-t-0 xl:w-[380px]">
        <div className="strip px-4 pb-2 pt-3">
          <h2 className="font-extrabold">Pesanan Baru</h2>
          <div className="no-scrollbar mt-2 flex flex-wrap gap-1" role="radiogroup" aria-label="Jenis pesanan">
            {ORDER_TYPES.map((o) => (
              <button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={orderType === o.key}
                onClick={() => setOrderType(o.key)}
                className={`chip h-8 px-2.5 ${orderType === o.key ? 'bg-brand-btn text-white' : 'border-[1.5px] border-brand-line bg-brand-card'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div className="max-h-[32vh] min-h-0 flex-1 overflow-y-auto px-3 py-2 lg:max-h-none">
          {cart.length === 0 && <p className="py-10 text-center text-sm text-brand-muted">Keranjang kosong. Ketuk menu di kiri.</p>}
          {cart.map((l) => (
            <div key={l.product_id} className="mb-2 rounded-lg border border-brand-line p-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-bold leading-snug">{l.name}</p>
                <button type="button" className="text-sm font-extrabold text-brand-redtext" onClick={() => setQty(l.product_id, 0)} aria-label={`Hapus ${l.name}`}>
                  ✕
                </button>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <button type="button" className="btn-ghost !min-h-0 !h-9 !w-9 !px-0 text-lg" onClick={() => setQty(l.product_id, l.qty - 1)} aria-label="Kurangi">
                    −
                  </button>
                  <input
                    className="input !h-9 !w-14 !px-1 text-center"
                    value={l.qty}
                    onChange={(e) => setQty(l.product_id, parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)}
                    inputMode="numeric"
                    aria-label={`Jumlah ${l.name}`}
                  />
                  <button type="button" className="btn-ghost !min-h-0 !h-9 !w-9 !px-0 text-lg" onClick={() => setQty(l.product_id, l.qty + 1)} aria-label="Tambah">
                    +
                  </button>
                </div>
                <p className="text-sm font-extrabold tabular-nums">{fmtRp(l.qty * l.price)}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t-[1.5px] border-brand-line p-3">
          <div className="mb-2 flex items-center gap-2">
            <label className="text-xs font-bold text-brand-muted" htmlFor="disc">
              Diskon Rp
            </label>
            <input
              id="disc"
              className="input !h-9 flex-1 text-right"
              inputMode="numeric"
              value={discount ? fmtRpPlain(discount) : ''}
              onChange={(e) => setDiscount(Math.min(subtotal, parseInt(e.target.value.replace(/\D/g, ''), 10) || 0))}
              placeholder="0"
            />
          </div>
          <input className="input !h-9 mb-2 text-sm" placeholder="Catatan (opsional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Catatan pesanan" />
          <div className="mb-1 flex justify-between text-sm font-bold text-brand-muted">
            <span>Subtotal</span>
            <span className="tabular-nums">{fmtRp(subtotal)}</span>
          </div>
          <div className="mb-2 flex justify-between text-xl font-extrabold">
            <span>Total</span>
            <span className="tabular-nums">{fmtRp(total)}</span>
          </div>
          {err && (
            <p className="mb-2 rounded-lg bg-brand-redtext/10 px-3 py-2 text-sm font-bold text-brand-redtext" role="alert">
              {err}
            </p>
          )}
          {/* Total di dalam tombol: kasir tak perlu baca dua tempat sebelum menekan */}
          <button
            type="button"
            className="btn-primary w-full !py-3.5 text-lg"
            disabled={cart.length === 0 || busy || (!shift && !online)}
            onClick={() => {
              setCashVal(online ? total : 0)
              setPayMethod('cash')
              setCheckout(true)
            }}
          >
            {online ? `Catat · ${fmtRp(total)}` : `Bayar · ${fmtRp(total)}`}
          </button>
          {!shift && !online && <p className="mt-1 text-center text-xs font-bold text-brand-redtext">Buka shift dulu untuk checkout.</p>}
        </div>
      </aside>

      {/* ===== Popup checkout 2 sisi: kiri numpad/lunas, kanan struk ===== */}
      {checkout && (
        <Modal open title={done ? 'Lunas — Transaksi Selesai' : `Checkout — ${CHANNEL_LABEL[orderType]}`} onClose={closeCheckout} wide>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            {/* Kiri: pembayaran (numpad), jadi ringkasan lunas setelah bayar */}
            <section className="min-w-0">
              {done ? (
                <div className="flex h-full flex-col gap-3">
                  <div className="card p-4 text-center">
                    <p className="text-4xl font-extrabold text-brand-btn">{done.change > 0 ? `Kembalian ${fmtRp(done.change)}` : 'Lunas'}</p>
                    <p className="mt-1 text-sm font-bold text-brand-muted">
                      {fmtRp(done.tx.total)} · {METHOD_LABEL[done.tx.payments[0]?.method ?? 'cash']}
                    </p>
                  </div>
                  {err && (
                    <p className="rounded-lg bg-brand-redtext/10 px-3 py-2 text-center text-sm font-bold text-brand-redtext" role="alert">
                      {err}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button type="button" className="btn-ghost flex-1" onClick={() => void doPrint('bt')}>
                      Cetak{bluetoothAvailable() ? '' : ' (dialog)'}
                    </button>
                    <button type="button" className="btn-ghost flex-1" onClick={() => void shareReceipt()}>
                      Bagikan
                    </button>
                  </div>
                  <button type="button" className="btn-primary mt-auto w-full !py-3 text-base" onClick={closeCheckout}>
                    Transaksi Baru
                  </button>
                  <p className="text-center text-xs text-brand-muted">
                    Print otomatis {settings.printer.auto_print ? 'aktif' : 'nonaktif'} — atur di Pengaturan → Printer
                  </p>
                </div>
              ) : (
                <>
                  <div className="mb-3 flex gap-1.5" role="radiogroup" aria-label="Metode pembayaran">
                    {(['cash', 'qris', 'transfer'] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={payMethod === m}
                        onClick={() => {
                          setPayMethod(m)
                          if (m !== 'cash') setCashVal(total)
                        }}
                        className={`chip h-10 flex-1 px-3 ${payMethod === m ? 'bg-brand-btn text-white' : 'border-[1.5px] border-brand-line bg-brand-card'}`}
                      >
                        {METHOD_LABEL[m]}
                      </button>
                    ))}
                  </div>
                  <Numpad
                    value={cashVal}
                    onChange={setCashVal}
                    total={total}
                    quick={[20000, 50000, 100000]}
                    submitLabel={busy ? 'Menyimpan...' : 'Selesai'}
                    onSubmit={() => {
                      if (payMethod === 'cash' && cashVal < total) return
                      void submitTx()
                    }}
                  />
                  {err && (
                    <p className="mt-2 rounded-lg bg-brand-redtext/10 px-3 py-2 text-sm font-bold text-brand-redtext" role="alert">
                      {err}
                    </p>
                  )}
                </>
              )}
            </section>

            {/* Kanan: struk (preview hidup → struk asli) */}
            <section
              className="mx-auto max-w-full overflow-y-auto rounded-lg border-[1.5px] border-brand-line bg-white p-2"
              aria-label="Pratinjau struk"
            >
              <div dangerouslySetInnerHTML={{ __html: receiptHtml }} />
            </section>
          </div>
        </Modal>
      )}

      {/* Popup kunci shift */}
      <Modal open={shiftGate} title={shift ? 'Shift Aktif' : 'Shift Belum Dibuka'} onClose={() => setShiftGate(false)}>
        {shift ? (
          <div>
            <p className="mb-3 text-sm text-brand-muted">
              Shift aktif sejak {new Date(shift.opened_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} · modal awal{' '}
              {fmtRp(shift.opening_cash)}
            </p>
            <button type="button" className="btn-primary w-full" onClick={() => setShiftGate(false)}>
              Lanjut Jualan
            </button>
          </div>
        ) : (
          <div>
            <p className="mb-3 text-sm font-bold">
              Kasir terkunci sampai shift dibuka. Hitung uang kembalian di drawer, lalu buka shift dengan modal:
            </p>
            <p className="mb-4 rounded-lg bg-brand-paper px-3 py-2 text-center text-2xl font-extrabold tabular-nums">
              {fmtRp(settings.shift.float_cash)}
            </p>
            {err && (
              <p className="mb-2 rounded-lg bg-brand-redtext/10 px-3 py-2 text-sm font-bold text-brand-redtext" role="alert">
                {err}
              </p>
            )}
            <button type="button" className="btn-primary w-full !py-3" disabled={openingShift} onClick={() => void doOpenShift()}>
              {openingShift ? 'Membuka...' : `Buka Shift (modal ${fmtRp(settings.shift.float_cash)})`}
            </button>
            <button type="button" className="btn-ghost mt-2 w-full" onClick={() => setShiftGate(false)}>
              Nanti saja
            </button>
          </div>
        )}
      </Modal>
    </div>
  )
}
