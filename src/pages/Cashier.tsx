import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { CircleAlert, Pause, Play, Plus, Printer, Scooter, Share2, ShoppingBag, Utensils, X, type LucideIcon } from 'lucide-react'
import { loadCatalog, loadSettings, createTx, currentShift, openShift, subscribeOrders, saveHeldOrder, loadHeldOrders, payHeldOrder, voidHeldOrder, type Catalog, type TxResult, type HeldOrder } from '../lib/db'
import { ingIndex, maxAvailableQty } from '../lib/hpp'
import { fmtRp, fmtRpPlain } from '../lib/money'
import type { OrderType, Payment, Product, Settings, Shift } from '../lib/types'
import { Numpad } from '../components/Numpad'
import { Modal } from '../components/Modal'
import { PreparedStockStrip } from '../components/PreparedStockStrip'
import { beepRegister, startOrderAlert, stopOrderAlert, vibrateSuccess } from '../lib/sound'
import { buildReceiptHtml, buildReceiptText, receiptFromTx, CHANNEL_LABEL } from '../lib/escpos'
import { printTextBluetooth, printHtmlFallback, openRawBtReceipt } from '../lib/bluetooth-printer'

interface CartLine {
  product_id: number
  name: string
  qty: number
  price: number
  max: number
}

// Ikon jenis pesanan — kanal online memakai LOGO RESMI (SVG di /public/brand,
// tajam di semua resolusi & ikut precache offline). Kanal lain pakai ikon lucide.
const ORDER_TYPES: { key: OrderType; label: string; Icon?: LucideIcon; logo?: string; online: boolean }[] = [
  { key: 'dinein', label: 'Makan di tempat', Icon: Utensils, online: false },
  { key: 'takeaway', label: 'Bungkus', Icon: ShoppingBag, online: false },
  { key: 'gofood', label: 'GoFood', logo: `${import.meta.env.BASE_URL}brand/gofood.svg`, online: true },
  { key: 'grabfood', label: 'GrabFood', logo: `${import.meta.env.BASE_URL}brand/grabfood.svg`, online: true },
  { key: 'shopeefood', label: 'ShopeeFood', logo: `${import.meta.env.BASE_URL}brand/shopeefood.svg`, online: true },
  { key: 'delivery', label: 'Delivery sendiri', Icon: Scooter, online: false }
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
  // peringatan sesaat saat menu habis diklik ke keranjang
  const [cartWarn, setCartWarn] = useState('')
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [newOrders, setNewOrders] = useState(false)
  // Simpan pesanan / bill: keranjang ditunda untuk dibayar nanti.
  const [held, setHeld] = useState<HeldOrder[]>([])
  const [billsOpen, setBillsOpen] = useState(false)
  const [billPay, setBillPay] = useState<HeldOrder | null>(null) // bill yg sedang dibayar dlm modal
  const [billMethod, setBillMethod] = useState<Payment['method']>('cash')
  const [voidConfirmId, setVoidConfirmId] = useState<number | null>(null)
  const [billLabel, setBillLabel] = useState('')
  const [billCash, setBillCash] = useState(0)

  const reload = useCallback(async () => {
    try {
      const [c, s, sh] = await Promise.all([loadCatalog(), loadSettings(), currentShift()])
      setCatalog(c)
      setSettings(s)
      setShift(sh)
      setLoadError('')
      // bill tersimpan dimuat sekalian; gagal tak boleh menghalangi kasir
      loadHeldOrders().then(setHeld).catch(() => {})
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

  /** Print otomatis setelah transaksi lunas (dipakai alur normal & bayar bill). */
  const autoPrint = (st: Settings, tx: TxResult): void => {
    if (!st.printer.auto_print) return
    if ((st.printer.mode ?? 'bt') === 'rawbt') {
      const html = buildReceiptHtml(receiptFromTx(st, tx, tx.items, tx.payments, ''), st.receipt.width_mm)
      if (!openRawBtReceipt(html)) {
        setErr('Print otomatis terblokir popup browser. Transaksi tetap tersimpan — izinkan popup lalu tekan Cetak.')
      }
    } else {
      void printTextBluetooth(buildReceiptText(receiptFromTx(st, tx, tx.items, tx.payments, ''), st.receipt.width_mm)).then((how) => {
        if (how === 'reconnect-gagal') {
          setErr('Print otomatis gagal (dialog pair butuh ketukan — normal di Chrome stabil). Transaksi tetap tersimpan — tekan Cetak untuk buka dialog, atau pakai Dialog/RawBT.')
        } else if (how === 'print-gagal') {
          setErr('Print otomatis gagal: printer tersambung tapi struk gagal terkirim. Transaksi tetap tersimpan — tekan Cetak untuk coba lagi.')
        }
      })
    }
  }

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
    // menu habis (max 0) TETAP BOLEH masuk keranjang: dapur bisa produksi dadakan /
    // stok opname tertinggal — tapi kasir diberi peringatan jelas (lihat cartWarn).
    const effMax = max >= 1 ? max : 99
    if (max < 1) setCartWarn(`${p.name} sedang HABIS menurut stok. Pastikan dapur sanggup sebelum jualan — sisa porsi dihitung dari resep × stok bahan.`)
    else setCartWarn('')
    setCart((c) => {
      const found = c.find((x) => x.product_id === p.id)
      if (found) {
        if (found.qty + 1 > found.max) return c
        return c.map((x) => (x.product_id === p.id ? { ...x, qty: x.qty + 1 } : x))
      }
      return [...c, { product_id: p.id, name: p.name, qty: 1, price: p.price, max: effMax }]
    })
  }

  const setQty = (pid: number, qty: number): void =>
    setCart((c) =>
      c.map((x) => (x.product_id === pid ? { ...x, qty: Math.max(0, Math.min(x.max, qty)) } : x)).filter((x) => x.qty > 0)
    )

  // peringatan item habis yang sedang di keranjang (bukan sekadar notifikasi sesaat)
  const cartHabis = useMemo(() => (catalog ? cart.filter((l) => maxOf(l.product_id) <= 0).map((l) => l.name) : []), [cart, catalog, maxOf])
  // penanda konfirmasi memaksa-jual sudah dilakukan (agar submit ke-2 tak ditanya ulang)
  const confirmDone = useRef(false)

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
    // Mode RawBT: semua cetakan lewat dialog printer sistem (RawBT) — tanpa Web Bluetooth
    if ((settings.printer.mode ?? 'bt') === 'rawbt') {
      if (!openRawBtReceipt(html)) setErr('Popup terblokir browser. Izinkan popup untuk situs ini lalu ketuk Cetak lagi.')
      return
    }
    if (mode === 'bt') {
      const how = await printTextBluetooth(receiptText(done.tx))
      if (how === 'bt') return
      if (how === 'fallback') {
        printHtmlFallback(html)
        return
      }
      if (how === 'print-gagal') {
        // printer TERsambung tapi data gagal terkirim — pesan jujur per tahap
        setErr('Printer tersambung, tetapi struk gagal terkirim. Coba lagi sekali — kalau tetap gagal, kertas/kapasitas printer perlu dicek, atau pakai Dialog printer.')
        return
      }
      // printer tak terjangkau / dialog pair ditutup / ditolak tanpa gesture
      setErr('Printer Bluetooth tidak terjangkau (atau dialog pair ditutup). Nyalakan printer lalu ketuk Cetak lagi — atau pakai Dialog printer / RawBT (Pengaturan → Printer).')
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
      // ada menu habis di keranjang → konfirmasi sekali, lalu kirim dgn stok minus
      const habisList = cartHabis
      if (habisList.length && !confirmDone.current) {
        setBusy(false)
        if (!window.confirm(`⚠ ${habisList.join(', ')} stok catatan HABIS. Tetap jual? (stok bahan jadi minus — segera produksi & opname)`)) {
          return
        }
        confirmDone.current = true
        setBusy(true)
      }
      const tx = await createTx({
        orderType,
        items: cart.map((l) => ({ product_id: l.product_id, qty: l.qty })),
        payments,
        discount,
        note: note || undefined,
        allowNegativeStock: habisList.length > 0,
        itemsDisplay: cart.map((l) => ({ name: l.name, qty: l.qty, price: l.price }))
      })
      confirmDone.current = false
      beepRegister()
      vibrateSuccess()
      const change = payMethod === 'cash' ? Math.max(0, cashVal - total) : 0
      setDone({ tx, change })
      setCart([])
      setDiscount(0)
      setNote('')
      void reload()
      // Print otomatis bila diaktifkan di Pengaturan; gagal sambung tidak
      // menghentikan kasir dan tidak memunculkan dialog pair mendadak.
      if (settings) autoPrint(settings, tx)
    } catch (ex) {
      setErr((ex as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // ===== Simpan pesanan / bill =====

  const [recallConfirmId, setRecallConfirmId] = useState<number | null>(null)
  useEffect(() => {
    if (recallConfirmId === null) return
    const t = window.setTimeout(() => setRecallConfirmId(null), 4000)
    return () => window.clearTimeout(t)
  }, [recallConfirmId])

  /** Panggil bill: muat ke keranjang + hapus dari daftar (server ikut dihapus; gagal → chip dikembalikan). */
  const loadBillInto = (h: HeldOrder): void => {
    setRecallConfirmId(null)
    setOrderType(h.order_type)
    setDiscount(h.discount)
    setNote(h.note ?? '')
    setBillLabel(h.label ?? '')
    setCart(h.items.map((i) => ({ product_id: i.product_id, name: i.name, qty: i.qty, price: i.price, max: Math.max(maxOf(i.product_id), i.qty) })))
    setHeld((hs) => hs.filter((x) => x.id !== h.id))
    void voidHeldOrder(h.id).catch((ex) => {
      setErr(`Bill gagal dihapus dari server: ${(ex as Error).message}`)
      setHeld((hs) => [...hs, h].sort((a, b) => a.created_at.localeCompare(b.created_at)))
    })
  }

  const recallBill = (h: HeldOrder): void => {
    // keranjang masih isi: butuh konfirmasi 2-ketuk supaya tak menimpa tanpa sengaja
    if (cart.length > 0) {
      if (recallConfirmId === h.id) loadBillInto(h)
      else setRecallConfirmId(h.id)
      return
    }
    loadBillInto(h)
  }

  const doSaveBill = async (): Promise<void> => {
    if (cart.length === 0) return
    setBusy(true)
    setErr('')
    try {
      const label = billLabel.trim() || null
      const h = await saveHeldOrder({
        orderType,
        items: cart.map((l) => ({ product_id: l.product_id, name: l.name, qty: l.qty, price: l.price })),
        subtotal,
        discount,
        total,
        note: note || null,
        label
      })
      setHeld((hs) => [...hs, h].sort((a, b) => a.created_at.localeCompare(b.created_at)))
      setCart([])
      setDiscount(0)
      setNote('')
      setBillLabel('')
    } catch (ex) {
      setErr((ex as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const doPayBill = async (method: Payment['method'], amount: number, discountOverride?: number): Promise<void> => {
    if (!billPay) return
    setBusy(true)
    setErr('')
    try {
      const tx = await payHeldOrder(billPay.id, method, amount, discountOverride)
      setHeld((hs) => hs.filter((h) => h.id !== billPay.id))
      setBillPay(null)
      beepRegister()
      vibrateSuccess()
      void reload()
      if (settings) {
        autoPrint(settings, tx)
        // buka popup struk yang sama dgn alur normal supaya kasir bisa cetak ulang
        setCheckout(true)
        setCashVal(method === 'cash' ? amount : tx.total)
        setPayMethod(method)
        setDone({ tx, change: method === 'cash' ? Math.max(0, amount - tx.total) : 0 })
      }
    } catch (ex) {
      setErr((ex as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const doVoidBill = async (id: number): Promise<void> => {
    setVoidConfirmId(null)
    setErr('')
    try {
      await voidHeldOrder(id)
      setHeld((hs) => hs.filter((h) => h.id !== id))
    } catch (ex) {
      setErr((ex as Error).message)
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
        {/* Strip stok siap jual: sticky di atas — kasir langsung notice sisa porsi */}
        <div className="sticky top-0 z-10 -mx-3 mb-2 lg:-mx-4">
          <PreparedStockStrip prepared={(catalog?.ingredients ?? []).filter((i) => i.kind === 'prepared' && i.active)} />
        </div>
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
            className={`chip h-9 px-3 ${hideSoldOut ? 'bg-brand-btn text-white' : 'border border-brand-line bg-brand-card'}`}
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
            className={`chip h-9 shrink-0 px-3 ${cat === 'all' ? 'bg-brand-btn text-white' : 'border border-brand-line bg-brand-card'}`}
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
              className={`chip h-9 shrink-0 rounded-ctl px-3 ${cat === c.id ? 'bg-brand-btn text-white shadow-lift' : 'border border-brand-line bg-brand-card'}`}
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
                title={habis ? `${p.name} — stok habis, tetap bisa dipaksa masuk (akan diberi peringatan)` : p.name}
                aria-label={habis ? `${p.name} (habis — ketuk untuk tetap masukkan)` : p.name}
                className={`card group relative flex flex-col overflow-hidden p-0 text-left transition-all duration-150 ${
                  habis ? 'opacity-60 ring-2 ring-brand-redtext/40' : 'hover:-translate-y-0.5 hover:shadow-lift'
                } ${besar ? 'min-h-[220px]' : 'min-h-[150px]'}`}
              >
                {/* slot foto tinggi tetap: kartu dengan/tanpa foto selalu sama tinggi; contain agar foto tidak terpotong */}
                {p.photo ? (
                  <img
                    src={p.photo}
                    alt={p.name}
                    className={`${besar ? 'h-[110px]' : 'h-[64px]'} w-full shrink-0 border-b border-brand-line object-contain`}
                    style={{ background: 'linear-gradient(135deg,#F6E7D8,#EFD9C4)' }}
                    loading="lazy"
                  />
                ) : (
                  <div
                    className={`${besar ? 'h-[110px]' : 'h-[64px]'} w-full shrink-0 border-b border-brand-line`}
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
          <div className="no-scrollbar mt-2 flex gap-1" role="radiogroup" aria-label="Jenis pesanan">
            {ORDER_TYPES.map((o) => (
              <button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={orderType === o.key}
                title={o.label}
                aria-label={o.label}
                onClick={() => setOrderType(o.key)}
                className={`icon-btn !min-h-11 !h-11 !w-11 !min-w-0 ${
                  orderType === o.key
                    ? o.logo
                      ? 'bg-white ring-2 ring-brand-btn shadow' // logo asli tetap berwarna di atas putih
                      : 'bg-brand-btn text-white shadow'
                    : 'border border-brand-line bg-brand-card'
                }`}>
                {o.logo ? (
                  <img src={o.logo} alt="" width={30} height={24} draggable={false} style={{ objectFit: 'contain' }} aria-hidden />
                ) : o.Icon ? (
                  <o.Icon size={18} strokeWidth={2.5} className={orderType === o.key ? 'text-white' : undefined} aria-hidden />
                ) : null}
              </button>
            ))}
          </div>
        {/* Bill tersimpan: chip bar 1-ketuk utk recall tanpa buka modal.
            Keranjang masih isi → ketuk 2x (konfirmasi) supaya tak menimpa. */}
        {held.length > 0 && (
          <div className="no-scrollbar -mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="list" aria-label={`Bill tersimpan, ${held.length} bill — ketuk untuk panggil ke keranjang`}>
            {held.map((h) => (
              <button
                key={h.id}
                type="button"
                role="listitem"
                onClick={() => recallBill(h)}
                className={`chip h-auto shrink-0 flex-col items-start !gap-0 !py-1 pl-2.5 pr-2 text-left ${
                  recallConfirmId === h.id ? 'bg-brand-redtext text-white' : 'border border-brand-line bg-brand-paper'
                }`}
                title={recallConfirmId === h.id ? 'Ketuk lagi: ganti keranjang dengan bill ini' : 'Panggil bill ke keranjang'}
              >
                <span className="max-w-36 truncate text-xs font-extrabold">{h.label || 'Bill'}</span>
                <span className="text-[11px] font-bold tabular-nums opacity-80">
                  {fmtRp(h.total)} · {h.items.reduce((s, i) => s + i.qty, 0)} item
                </span>
                {recallConfirmId === h.id && <span className="text-[10px] font-extrabold">Ketuk lagi: ganti keranjang</span>}
              </button>
            ))}
          </div>
        )}
        </div>
        <div className="max-h-[32vh] min-h-0 flex-1 overflow-y-auto px-3 py-2 lg:max-h-none">
          {cart.length === 0 && <p className="py-10 text-center text-sm text-brand-muted">Keranjang kosong. Ketuk menu di kiri.</p>}
          {cart.map((l) => (
            <div key={l.product_id} className="mb-2 rounded-lg border border-brand-line p-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-bold leading-snug">{l.name}</p>
                <button type="button" className="icon-btn-danger !h-9 !w-9 shrink-0" onClick={() => setQty(l.product_id, 0)} aria-label={`Hapus ${l.name}`}>
                  <X size={16} strokeWidth={2.5} aria-hidden />
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
          {cartWarn && (
            <p className="mb-2 rounded-lg bg-brand-gold/20 px-3 py-2 text-xs font-bold text-brand-ink" role="alert">
              <CircleAlert size={14} className="mr-1 inline-block shrink-0 align-[-2px]" aria-hidden />
              {cartWarn}
            </p>
          )}
          {cartHabis.length > 0 && !cartWarn && (
            <p className="mb-2 rounded-lg bg-brand-redtext/10 px-3 py-2 text-xs font-bold text-brand-redtext" role="alert">
              <CircleAlert size={14} className="mr-1 inline-block shrink-0 align-[-2px]" aria-hidden />
              Di keranjang: {cartHabis.join(', ')} — stok catatan HABIS. Jangan dijual bila dapur tidak sanggup.
            </p>
          )}
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
          {/* Simpan pesanan: keranjang ditunda sbg bill, stok belum dipotong,
              dipanggil lagi lewat tombol bill utk dibayar/dibatalkan. */}
          <div className="mt-2 flex items-center gap-2">
            <input
              className="input !h-10 flex-1 text-sm"
              placeholder="Nama bill (opsional)"
              value={billLabel}
              onChange={(e) => setBillLabel(e.target.value)}
              aria-label="Nama bill — nama pelanggan atau meja"
            />
            <button
              type="button"
              className="btn-ghost relative !min-h-11 !h-11 !w-11 shrink-0 !px-0"
              disabled={cart.length === 0 || busy || (!shift && !online)}
              onClick={() => void doSaveBill()}
              title="Simpan pesanan — tunda pembayaran (stok belum dipotong)"
              aria-label="Simpan pesanan sebagai bill — tunda pembayaran"
            >
              <Pause size={18} strokeWidth={2.5} aria-hidden />
              {held.length > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-btn px-1 text-[10px] font-extrabold text-white">
                  {held.length}
                </span>
              )}
            </button>
            <button
              type="button"
              className="btn-ghost relative !min-h-11 !h-11 !w-11 shrink-0 !px-0"
              onClick={() => setBillsOpen(true)}
              title={`Daftar bill tersimpan (${held.length}) — panggil untuk dilanjutkan / dibayar`}
              aria-label={`Daftar bill tersimpan, ${held.length} bill`}
            >
              <Play size={18} strokeWidth={2.5} aria-hidden />
              {held.length > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-redtext px-1 text-[10px] font-extrabold text-white">
                  {held.length}
                </span>
              )}
            </button>
          </div>
          {!shift && !online && <p className="mt-1 text-center text-xs font-bold text-brand-redtext">Buka shift dulu untuk checkout.</p>}
        </div>
      </aside>

      {/* ===== Daftar bill tersimpan (simpan pesanan) ===== */}
      <Modal open={billsOpen} title="Bill Tersimpan" onClose={() => setBillsOpen(false)}>
        <p className="mb-3 text-xs font-bold text-brand-muted">
          Pesanan yang disimpan belum memotong stok. Panggil untuk melanjutkan, bayar, atau batalkan.
        </p>
        {held.length === 0 && <p className="py-6 text-center text-sm text-brand-muted">Belum ada bill tersimpan.</p>}
        <div className="flex flex-col gap-2">
          {held.map((h) => (
            <div key={h.id} className="rounded-lg border border-brand-line p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold">{h.label || 'Tanpa nama'} · {fmtRp(h.total)}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-brand-muted">
                    {h.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}
                  </p>
                  <p className="mt-0.5 text-[11px] text-brand-muted">
                    {CHANNEL_LABEL[h.order_type] ?? h.order_type} · {new Date(h.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <button type="button" className="btn-primary !min-h-0 !py-1.5 text-xs" onClick={() => { setBillPay(h); setBillMethod('cash'); setBillCash(0) }}>
                    Bayar
                  </button>
                  {voidConfirmId === h.id ? (
                    <div className="flex gap-1">
                      <button type="button" className="btn-ghost !min-h-0 !px-2 !py-1 text-[11px] font-extrabold text-brand-redtext" onClick={() => void doVoidBill(h.id)}>
                        Yakin hapus
                      </button>
                      <button type="button" className="btn-ghost !min-h-0 !px-2 !py-1 text-[11px]" onClick={() => setVoidConfirmId(null)}>
                        Batal
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="btn-ghost !min-h-0 !py-1.5 text-xs" onClick={() => setVoidConfirmId(h.id)}>
                      Void
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Modal>

      {/* ===== Bayar bill tersimpan: numpad ala checkout ===== */}
      <Modal open={billPay !== null} title={billPay ? `Bayar Bill — ${billPay.label || 'Tanpa nama'}` : ''} onClose={() => { setBillPay(null); setErr('') }}>
        {billPay && (
          <>
            <div className="mb-3 rounded-lg border border-brand-line bg-brand-paper p-2.5">
              <p className="text-xs text-brand-muted">Total bill</p>
              <p className="text-2xl font-extrabold tabular-nums">{fmtRp(billPay.total)}</p>
              <p className="mt-0.5 line-clamp-2 text-xs text-brand-muted">{billPay.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</p>
            </div>
            <div className="mb-3 flex gap-1.5" role="radiogroup" aria-label="Metode pembayaran bill">
              {(['cash', 'qris', 'transfer'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={billMethod === m}
                  onClick={() => setBillMethod(m)}
                  className={`chip h-10 flex-1 px-3 ${billMethod === m ? 'bg-brand-btn text-white' : 'border border-brand-line bg-brand-card'}`}
                >
                  {METHOD_LABEL[m]}
                </button>
              ))}
            </div>
            {err && (
              <p className="mb-2 rounded-lg bg-brand-redtext/10 px-3 py-2 text-sm font-bold text-brand-redtext" role="alert">
                {err}
              </p>
            )}
            <Numpad
              value={billCash}
              onChange={setBillCash}
              total={billPay.total}
              submitLabel="Bayar Bill"
              onSubmit={() => void doPayBill(billMethod, billCash)}
            />
          </>
        )}
      </Modal>

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
                    <div className="rounded-lg bg-brand-redtext/10 px-3 py-2 text-center text-sm font-bold text-brand-redtext" role="alert">
                      <p>{err}</p>
                      {/* err di panel lunas hanya berasal dari kegagalan print — kasir bisa coba ulang tanpa cari tombol */}
                      <button type="button" className="btn-ghost mt-2 !min-h-0 !py-1.5 text-xs" onClick={() => void doPrint('bt')}>
                        Coba Cetak Lagi
                      </button>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-ghost flex-1"
                      onClick={() => void doPrint('bt')}
                      title={(settings.printer.mode ?? 'bt') === 'rawbt' ? 'Buka pratinjau cetak — satu ketuk CETAK, pilih RawBT' : 'Kirim struk ke printer Bluetooth tersimpan'}
                    >
                      {(settings.printer.mode ?? 'bt') === 'rawbt' ? 'Cetak (RawBT)' : 'Cetak'}
                    </button>
                    <button type="button" className="btn-ghost flex-1" onClick={() => doPrint('dialog')} title="Kirim struk ke dialog cetak sistem">
                      <Printer size={16} strokeWidth={2.25} className="mr-1 inline-block align-[-3px]" aria-hidden /> Dialog
                    </button>
                    <button type="button" className="btn-ghost flex-1" onClick={() => void shareReceipt()}>
                      <Share2 size={16} strokeWidth={2.25} className="mr-1 inline-block align-[-3px]" aria-hidden /> Bagikan
                    </button>
                  </div>
                  <button type="button" className="btn-primary mt-auto w-full !py-3 text-base" onClick={closeCheckout}>
                    <Plus size={18} strokeWidth={2.75} className="mr-1 inline-block align-[-3px]" aria-hidden /> Transaksi Baru
                  </button>
                  <p className="text-center text-xs text-brand-muted">
                    Mode cetak {(settings.printer.mode ?? 'bt') === 'rawbt' ? 'RawBT — satu ketuk CETAK di jendela struk' : 'Bluetooth langsung'} · Print otomatis {settings.printer.auto_print ? 'aktif' : 'nonaktif'} · atur di Pengaturan → Printer
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
                        className={`chip h-10 flex-1 px-3 ${payMethod === m ? 'bg-brand-btn text-white' : 'border border-brand-line bg-brand-card'}`}
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
              className="mx-auto max-w-full overflow-y-auto rounded-lg border border-brand-line bg-white p-2"
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
