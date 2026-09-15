import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useSearchParams } from 'react-router-dom'
import { loadCatalog, loadTransactions, upsertIngredient, saveIngredientRecipe, deleteIngredient, createPurchase, logWaste, importPriceList, createStockAdjustment, loadStockAdjustments, updateStockAdjustment, deleteStockAdjustment, loadStockMoves, type Catalog, type PriceListItem } from '../lib/db'
import { ingIndex, preparedCost, smallUnitOf, packPriceOf, hppLines, hppTotal, marginPct, fmtHppQty } from '../lib/hpp'
import { buyPlanFromSales, buyPlanToText, dailySalesOf, type BuyPlan } from '../lib/forecast'
import { fmtRp, fmtRpPlain, fmtQty, parseNum } from '../lib/money'
import type { Ingredient, IngredientRecipe, Product, StockAdjustment, StockMove } from '../lib/types'
import { dayStart, dayEnd, todayISO, addDaysISO } from '../lib/dates'
import { Modal } from '../components/Modal'
import { NumInput } from '../components/NumInput'
import { useToast } from '../components/Toast'

/**
 * Bahan Baku & HPP — satu halaman merger untuk operasional:
 *  - tab "Bahan Baku": tabel ala Price List Sabana Sharing Mitra
 *    (Kode · Nama · Satuan · Isi · Harga Kemasan + Satuan Kecil · Stok · Min · Status · Saran Beli), CRUD penuh.
 *  - tab "Pembelian & Stok": catat pembelian (keranjang centang), stok opname, waste.
 *  - tab "Menu & HPP": satu baris per menu ala file HPP Reguler
 *    (Harga Jual · HPP · Margin Rp & %) + editor resep.
 */

/** Pilihan satuan beli yang umum — bukan hardcode mati: ada opsi "Lainnya" untuk ketik sendiri. */
const BUY_UNITS = ['pack', 'pouch', 'karung', 'dus', 'kg', 'gram', 'liter', 'pcs', 'ekor', 'potong', 'cup', 'tabung', 'ikat', 'porsi']
/** Kandidat satuan kecil yang sering dipakai resep. */
const SMALL_UNITS = ['', 'pcs', 'potong', 'gram', 'ml', 'liter', 'kg', 'cup', 'lembar', 'sachet', 'porsi', 'slice']

type Tab = 'bahan' | 'stok' | 'menu'

export default function Ingredients(): ReactElement {
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState<Partial<Ingredient> | null>(null)
  const [recipeFor, setRecipeFor] = useState<Ingredient | null>(null)
  const [q, setQ] = useState('')
  const [dirty, setDirty] = useState<Record<number, number>>({})
  const [deleting, setDeleting] = useState<Ingredient | null>(null)
  // Harga pembelian (per kemasan) yang sedang diketik di modal — basis perhitungan price-per-isi.
  // Disimpan terpisah supaya saat isi kemasan diubah, harga kemasan TETAP dan harga per-isi ikut dibagi ulang
  // (sebaliknya tampilan akan "melar": 54.000 tiba-tiba jadi 72.000 saat isi 9→12).
  const [packPriceDraft, setPackPriceDraft] = useState<number | null>(null)
  // filter tampil: semua / aktif saja / nonaktif saja
  const [activeFilter, setActiveFilter] = useState<'all' | 'on' | 'off'>('all')
  // bahan yang sedang di-toggle (mencegah dobel-klik saat RPC jalan)
  const [toggling, setToggling] = useState<number | null>(null)
  // keranjang pembelian: id bahan tercentang di tabel bahan
  const [checked, setChecked] = useState<Set<number>>(new Set())
  // tampilan daftar bahan: tabel (ala price list) atau kartu — tersimpan per perangkat
  const [bahanView, setBahanView] = useState<'table' | 'grid'>(() => (localStorage.getItem('sabana-bahan-view') === 'grid' ? 'grid' : 'table'))
  const setBahanViewPersist = (v: 'table' | 'grid'): void => {
    setBahanView(v)
    localStorage.setItem('sabana-bahan-view', v)
  }

  const tab = (searchParams.get('tab') as Tab) === 'stok' ? 'stok' : (searchParams.get('tab') as Tab) === 'menu' ? 'menu' : 'bahan'
  const setTab = (t: Tab): void => setSearchParams(t === 'bahan' ? {} : { tab: t })

  const reload = useCallback(async () => {
    try {
      setCatalog(await loadCatalog())
      setDirty({})
    } catch (ex) {
      setErr((ex as Error).message)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const ingById = useMemo(() => ingIndex(catalog?.ingredients ?? []), [catalog])

  if (!catalog) return <div className="p-6 text-sm font-bold text-brand-muted">Memuat...</div>

  const list = catalog.ingredients.filter((i) => {
    const s = q.toLowerCase()
    const matchQ = !s || i.name.toLowerCase().includes(s) || (i.code ?? '').toLowerCase().includes(s)
    const matchActive = activeFilter === 'all' || (activeFilter === 'on' ? i.active : !i.active)
    return matchQ && matchActive
  })
  const dirtyCount = Object.keys(dirty).length
  // ringkasan atas: nilai stok (stok × harga per satuan dasar) & jumlah bahan di bawah minimum
  const stockValue = catalog.ingredients.filter((i) => i.kind === 'raw').reduce((s, i) => s + i.stock * i.price, 0)
  const lowCount = catalog.ingredients.filter((i) => i.active && i.stock <= i.min_stock && i.min_stock > 0).length
  const kritisCount = catalog.ingredients.filter((i) => i.active && i.stock <= 0).length

  const savePrices = async (): Promise<void> => {
    try {
      for (const [idStr, price] of Object.entries(dirty)) {
        const ing = catalog.ingredients.find((i) => i.id === parseInt(idStr, 10))
        if (ing) await upsertIngredient({ ...ing, price })
      }
      await reload()
      toast('Harga tersimpan. HPP semua resep terkait ikut terhitung ulang.')
    } catch (ex) {
      setErr((ex as Error).message)
    }
  }

  const toggleCk = (id: number, on: boolean): void => {
    setChecked((s) => {
      const n = new Set(s)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })
  }

  /** Nonaktifkan/aktifkan bahan tanpa buka modal Edit — bahan nonaktif hilang dari dropdown produksi, resep, & saran beli. */
  const toggleActive = async (ing: Ingredient): Promise<void> => {
    setToggling(ing.id)
    setErr('')
    try {
      await upsertIngredient({
        id: ing.id,
        name: ing.name,
        code: ing.code,
        kind: ing.kind,
        buy_unit: ing.buy_unit,
        small_unit: ing.small_unit,
        pack_content: ing.pack_content,
        price: ing.price,
        min_stock: ing.min_stock,
        active: !ing.active
      })
      await reload()
    } catch (ex) {
      setErr((ex as Error).message)
    } finally {
      setToggling(null)
    }
  }

  // modal satuan "Lainnya (ketik sendiri)": aktif bila nilai bukan preset ATAU masih '?' penanda custom eksplisit.
  // PENTING: input custom hanya menulis *_custom; small_unit/buy_unit di-commit dari custom saat simpan —
  // kalau tidak, mengetik karakter pertama membuat kondisi render berubah dan input hilang di tengah ketik.
  const buyUnitCustom = editing === null || editing.buy_unit === '' || editing.buy_unit === '?' || (editing.buy_unit != null && editing.buy_unit !== '' && !BUY_UNITS.includes(editing.buy_unit))
  const smallUnitCustom = editing !== null && (editing.small_unit === '?' || (editing.small_unit != null && editing.small_unit !== '' && !SMALL_UNITS.includes(editing.small_unit)))
  return (
    <div className="p-3 lg:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-extrabold">Bahan Baku &amp; HPP</h1>
        <div className="flex gap-1" role="tablist" aria-label="Bagian">
          {(
            [
              ['bahan', '🥘 Bahan Baku'],
              ['stok', '📦 Pembelian & Stok'],
              ['menu', '🍗 Menu & HPP']
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              className={`chip h-9 px-3 ${tab === k ? 'bg-brand-btn text-white' : 'border-[1.5px] border-brand-line bg-brand-card'}`}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {err && (
        <p className="mb-2 rounded-lg bg-brand-redtext/10 px-3 py-2 text-sm font-bold text-brand-redtext" role="alert">
          {err}
        </p>
      )}

      {tab === 'bahan' && (
        <>
          {/* Bar ringkasan: keputusan belanja dibaca dari sini, bukan dari tiap baris */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="chip h-9 border-[1.5px] border-brand-line bg-brand-card px-3">📦 {catalog.ingredients.filter((i) => i.kind === 'raw').length} barang</span>
            <span className="chip h-9 border-[1.5px] border-brand-line bg-brand-card px-3">Nilai stok {fmtRp(stockValue)}</span>
            {lowCount > 0 && <span className="chip h-9 bg-brand-gold px-3">⚠ {lowCount} perlu beli</span>}
            {kritisCount > 0 && <span className="chip h-9 bg-brand-redtext px-3 text-white">🚨 {kritisCount} kritis</span>}
          </div>

          <BahanTable
            catalog={catalog}
            list={list}
            q={q}
            setQ={setQ}
            activeFilter={activeFilter}
            setActiveFilter={setActiveFilter}
            dirty={dirty}
            setDirty={setDirty}
            checked={checked}
            toggleCk={toggleCk}
            toggleActive={toggleActive}
            toggling={toggling}
            view={bahanView}
            setViewPersist={setBahanViewPersist}
            setEditing={setEditing}
            setDeleting={setDeleting}
            setRecipeFor={setRecipeFor}
          />

          {dirtyCount > 0 && (
            <div className="card strip mt-3 flex items-center gap-3 p-3">
              <p className="mr-auto text-sm font-bold">{dirtyCount} harga berubah, belum disimpan.</p>
              <button type="button" className="btn-ghost" onClick={() => setDirty({})}>
                Batalkan
              </button>
              <button type="button" className="btn-primary" onClick={() => void savePrices()}>
                Simpan Semua Harga
              </button>
            </div>
          )}

          <BuyInsight catalog={catalog} setErr={setErr} />
        </>
      )}

      {tab === 'stok' && <StokTab catalog={catalog} reload={reload} setErr={setErr} checked={checked} clearChecked={() => setChecked(new Set())} />}

      {tab === 'menu' && <MenuHppTab catalog={catalog} ingById={ingById} reload={reload} setErr={setErr} toast={toast} goBahan={() => setTab('bahan')} />}

      {/* Modal bahan (ala price list) */}
      <Modal open={editing !== null} title={editing?.id ? 'Edit Barang' : 'Barang Baru'} onClose={() => { setEditing(null); setPackPriceDraft(null) }}>
        {editing && (
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault()
              try {
                // satuan "Lainnya" diketik di input custom → commit ke kolom aslinya saat simpan
                const finalBuyUnit = BUY_UNITS.includes(editing.buy_unit ?? '') ? editing.buy_unit : (editing.buy_unit_custom || '').trim() || 'pack'
                const finalSmallUnit = editing.small_unit === '?' || (editing.small_unit != null && !SMALL_UNITS.includes(editing.small_unit))
                  ? (editing.small_unit_custom || '').trim()
                  : (editing.small_unit ?? '')
                await upsertIngredient({
                  id: editing.id,
                  name: editing.name ?? '',
                  code: editing.code ?? '',
                  kind: editing.kind ?? 'raw',
                  buy_unit: finalBuyUnit || 'pack',
                  small_unit: finalSmallUnit || null,
                  pack_content: editing.pack_content ?? 1,
                  price: editing.price ?? 0,
                  min_stock: editing.min_stock ?? 0,
                  active: editing.active ?? true,
                  // komposisi potongan per kemasan (audit jual) — baris kosong dibuang
                  pack_breakdown: (editing.pack_breakdown ?? []).filter((b) => b.name.trim() && b.qty > 0)
                })
                setEditing(null)
                await reload()
                toast('Barang tersimpan.')
              } catch (ex) {
                setErr((ex as Error).message)
              }
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="lbl" htmlFor="ikode">
                  Kode barang
                </label>
                <input id="ikode" className="input" value={editing.code ?? ''} onChange={(e) => setEditing({ ...editing, code: e.target.value })} placeholder="cth: 200053" />
              </div>
              <div>
                <label className="lbl" htmlFor="iname">
                  Nama barang
                </label>
                <input id="iname" className="input" value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="lbl" htmlFor="iunit">
                  Satuan beli
                </label>
                <select id="iunit" className="input" value={buyUnitCustom ? '__custom__' : BUY_UNITS.includes(editing.buy_unit ?? '') ? editing.buy_unit : '__custom__'} onChange={(e) => setEditing({ ...editing, buy_unit: e.target.value === '__custom__' ? '' : e.target.value })}>
                  {BUY_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                  <option value="__custom__">Lainnya (ketik sendiri)…</option>
                </select>
                {buyUnitCustom && (
                  <input
                    className="input mt-2"
                    value={editing.buy_unit_custom ?? (editing.buy_unit && editing.buy_unit !== '?' ? editing.buy_unit : '')}
                    onChange={(e) => setEditing({ ...editing, buy_unit_custom: e.target.value })}
                    placeholder="contoh: slop / tray"
                  />
                )}
              </div>
              <div>
                <label className="lbl" htmlFor="ismall">
                  Satuan kecil (untuk resep)
                </label>
                <select id="ismall" className="input" value={smallUnitCustom ? '__custom__' : SMALL_UNITS.includes(editing.small_unit ?? '') ? (editing.small_unit ?? '') : '__custom__'} onChange={(e) => setEditing({ ...editing, small_unit: e.target.value === '__custom__' ? '?' : e.target.value })}>
                  {SMALL_UNITS.map((u) => (
                    <option key={u || '__none__'} value={u}>
                      {u === '' ? '— sama dgn satuan beli —' : u}
                    </option>
                  ))}
                  <option value="__custom__">Lainnya (ketik sendiri)…</option>
                </select>
                {smallUnitCustom && (
                  <input
                    className="input mt-2"
                    value={editing.small_unit_custom ?? (editing.small_unit === '?' ? '' : editing.small_unit ?? '')}
                    onChange={(e) => setEditing({ ...editing, small_unit_custom: e.target.value })}
                    placeholder="contoh: potong"
                  />
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="lbl" htmlFor="ikind">
                  Jenis
                </label>
                <select id="ikind" className="input" value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value as 'raw' | 'prepared' })}>
                  <option value="raw">Mentah (dibeli)</option>
                  <option value="prepared">Setengah jadi (diproduksi)</option>
                </select>
              </div>
              <div>
                <label className="lbl" htmlFor="icontent">
                  Isi kemasan (per {editing.buy_unit || 'kemasan'})
                </label>
                <NumInput
                  id="icontent"
                  className="input text-right"
                  value={editing.pack_content ?? 1}
                  onChange={(n) => {
                    const next = n || 1
                    // harga kemasan TETAP, harga per-isi dihitung ulang = harga kemasan ÷ isi baru
                    const pack = packPriceDraft ?? packPriceOf({ price: editing.price ?? 0, pack_content: editing.pack_content || 1 })
                    setEditing({ ...editing, pack_content: next, price: Math.round(pack / next) || 0 })
                  }}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="lbl" htmlFor="iprice">
                  Harga pembelian (Rp / {editing.buy_unit || 'kemasan'})
                </label>
                {/* user mengetik HARGA KEMASAN utuh (mis. 48.000) — dibagi isi kemasan otomatis */}
                <NumInput
                  id="iprice"
                  className="input text-right"
                  format={fmtRpPlain}
                  parse={(s) => {
                    const pack = parseInt(s.replace(/\D/g, ''), 10) || 0
                    setPackPriceDraft(pack)
                    return Math.round(pack / (editing.pack_content || 1)) || 0
                  }}
                  value={packPriceDraft ?? packPriceOf({ price: editing.price ?? 0, pack_content: editing.pack_content || 1 })}
                  onChange={(n) => setEditing({ ...editing, price: n })}
                />
                <p className="mt-1 text-xs text-brand-muted">
                  ≈ <b>{fmtRpPlain(editing.price ?? 0)}</b>/{smallUnitOf({ buy_unit: editing.buy_unit || 'pack', small_unit: editing.small_unit, pack_content: editing.pack_content || 1 })} — hasil bagi harga pembelian ÷ isi kemasan; ini yang dipakai hitung HPP.
                </p>
              </div>
              <div>
                <label className="lbl" htmlFor="imin">
                  Stok minimum
                </label>
                <NumInput
                  id="imin"
                  className="input text-right"
                  value={editing.min_stock ?? 0}
                  onChange={(n) => setEditing({ ...editing, min_stock: n })}
                />
              </div>
            </div>
            {/* Komposisi potongan per kemasan (opsional): 1 pack isi 9 = 2 sayap +
                2 paha atas + 2 paha bawah + 3 dada — kasir/dapur tahu yg bisa dijual. */}
            <details className="rounded-lg border-[1.5px] border-brand-line p-2.5" open={!!editing.pack_breakdown?.length}>
              <summary className="cursor-pointer text-xs font-extrabold text-brand-muted">
                Rincian isi kemasan per potongan (opsional)
              </summary>
              <p className="mt-1.5 mb-2 text-[11px] text-brand-muted">\n               cth: pack Ayam isi 9 = 2 Sayap + 2 Paha Atas + 2 Paha Bawah + 3 Dada. Hanya utk tampilan & audit jual — tidak mengubah stok/HPP.
              </p>
              {(editing.pack_breakdown ?? []).map((b, bi) => (
                <div key={bi} className="mb-1.5 grid grid-cols-[1fr_80px_32px] gap-2">
                  <input
                    className="input !h-9"
                    value={b.name}
                    placeholder="cth: Sayap"
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        pack_breakdown: (editing.pack_breakdown ?? []).map((x, j) => (j === bi ? { ...x, name: e.target.value } : x))
                      })
                    }
                    aria-label={`Nama potongan ${bi + 1}`}
                  />
                  <NumInput
                    className="input !h-9 text-right"
                    value={b.qty}
                    ariaLabel={`Jumlah ${b.name || `potongan ${bi + 1}`}`}
                    onChange={(n) =>
                      setEditing({
                        ...editing,
                        pack_breakdown: (editing.pack_breakdown ?? []).map((x, j) => (j === bi ? { ...x, qty: n } : x))
                      })
                    }
                  />
                  <button type="button" className="icon-btn-danger !h-9 !w-9" aria-label={`Hapus ${b.name || `potongan ${bi + 1}`}`} onClick={() => setEditing({ ...editing, pack_breakdown: (editing.pack_breakdown ?? []).filter((_, j) => j !== bi) })}>
                    🗑
                  </button>
                </div>
              ))}
              <div className="mt-1 flex items-center gap-2">
                <button type="button" className="btn-ghost !min-h-0 !py-1.5 text-xs" onClick={() => setEditing({ ...editing, pack_breakdown: [...(editing.pack_breakdown ?? []), { name: '', qty: 1 }] })}>
                  + Potongan
                </button>
                {(() => {
                  const sum = (editing.pack_breakdown ?? []).reduce((s, b) => s + (b.qty || 0), 0)
                  const target = editing.pack_content || 1
                  if ((editing.pack_breakdown ?? []).length === 0) return null
                  const ok = Math.abs(sum - target) < 0.0001
                  return (
                    <span className={`text-[11px] font-extrabold ${ok ? 'text-brand-muted' : 'text-brand-redtext'}`}>
                      total {fmtQty(sum)} / isi kemasan {fmtQty(target)}{ok ? ' ✓' : ' — belum cocok!'}
                    </span>
                  )
                })()}
              </div>
            </details>
            <button type="submit" className="btn-primary">
              Simpan Barang
            </button>
          </form>
        )}
      </Modal>

      {/* Modal konfirmasi hapus bahan */}
      <Modal open={deleting !== null} title="Hapus Barang" onClose={() => setDeleting(null)}>
        {deleting && (
          <div>
            <p className="mb-2 text-sm">
              Hapus barang <b>{deleting.name}</b>?
            </p>
            <p className="mb-3 text-xs font-bold text-brand-muted">
              Barang yang sudah pernah dipakai di resep tidak bisa dihapus — cukup nonaktifkan lewat tombol Edit supaya riwayat stok tetap rapi.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary flex-1"
                onClick={async () => {
                  try {
                    await deleteIngredient(deleting.id)
                    setDeleting(null)
                    await reload()
                    toast('Barang dihapus.')
                  } catch (ex) {
                    setDeleting(null)
                    setErr((ex as Error).message)
                  }
                }}
              >
                Ya, Hapus
              </button>
              <button type="button" className="btn-ghost flex-1" onClick={() => setDeleting(null)}>
                Batal
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal resep produksi */}
      <Modal open={recipeFor !== null} title={`Resep Produksi: ${recipeFor?.name ?? ''}`} onClose={() => setRecipeFor(null)} wide>
        {recipeFor && <IngRecipeEditor catalog={catalog} ingredient={recipeFor} onDone={() => { setRecipeFor(null); void reload() }} setErr={setErr} />}
      </Modal>
    </div>
  )
}

// Mengisi custom buy_unit tanpa state tambahan di tipe Partial<Ingredient>
declare module '../lib/types' {
  interface Ingredient {
    buy_unit_custom?: string
  }
}

/** Impor Price List Sabana Sharing Mitra — data resmi supplier, di-hardcode dari PDF supaya impor 1 klik tanpa upload file. */
const PRICE_LIST: PriceListItem[] = [
  { code: '100001', name: 'AYAM POTONG 9', buy_unit: 'pack', pack_content: 9, pack_price: 48000, small_unit: 'potong' },
  { code: '100002', name: 'AYAM POTONG 12', buy_unit: 'pack', pack_content: 12, pack_price: 48000, small_unit: 'potong' },
  { code: '100003', name: 'AYAM BONELESS', buy_unit: 'pack', pack_content: 30, pack_price: 65000, small_unit: 'potong' },
  { code: '100004', name: 'KULIT AYAM', buy_unit: 'pack', pack_content: 500, pack_price: 20000, small_unit: 'gram' },
  { code: '100006', name: 'BERAS MENTIK WANGI 10 KG', buy_unit: 'karung', pack_content: 10, pack_price: 165000, small_unit: 'kg' },
  { code: '100007', name: 'BERAS MENTIK WANGI 25 KG', buy_unit: 'karung', pack_content: 25, pack_price: 412500, small_unit: 'kg' },
  { code: '100010', name: 'AYAM POTONG 9 (SBP)', buy_unit: 'pack', pack_content: 9, pack_price: 45000, small_unit: 'potong' },
  { code: '200001', name: 'TEPUNG FRIED CHICKEN', buy_unit: 'pack', pack_content: 1000, pack_price: 23500, small_unit: 'gram' },
  { code: '200002', name: 'SUNCO MINYAK GORENG 2 LITER', buy_unit: 'pouch', pack_content: 2, pack_price: 43400, small_unit: 'liter' },
  { code: '200003', name: 'CHICKEN PATTY', buy_unit: 'pcs', pack_content: 1, pack_price: 4500, small_unit: 'pcs' },
  { code: '200004', name: 'ROTI BURGER', buy_unit: 'pcs', pack_content: 1, pack_price: 2600, small_unit: 'pcs' },
  { code: '200005', name: 'BAKSO', buy_unit: 'pack', pack_content: 50, pack_price: 24000, small_unit: 'pcs' },
  { code: '200006', name: 'CHICKEN ROLL', buy_unit: 'pack', pack_content: 10, pack_price: 24400, small_unit: 'pcs' },
  { code: '200007', name: 'SAUS SAMBAL SABANA', buy_unit: 'pack', pack_content: 125, pack_price: 22500, small_unit: 'sachet' },
  { code: '200008', name: 'SAUS TOMAT DELMONTE', buy_unit: 'pack', pack_content: 20, pack_price: 5300, small_unit: 'sachet' },
  { code: '200009', name: 'SAUS SAMBAL REFILL 1 KG DELMONTE', buy_unit: 'pouch', pack_content: 1, pack_price: 20700, small_unit: 'gram' },
  { code: '200010', name: 'SAUS TOMAT REFILL 1 KG DELMONTE', buy_unit: 'pouch', pack_content: 1, pack_price: 15100, small_unit: 'gram' },
  { code: '200011', name: 'KEMASAN AYAM', buy_unit: 'pack', pack_content: 100, pack_price: 23500, small_unit: 'lembar' },
  { code: '200012', name: 'KEMASAN KULIT CRISPY', buy_unit: 'pack', pack_content: 100, pack_price: 15000, small_unit: 'lembar' },
  { code: '200013', name: 'KERTAS NASI', buy_unit: 'pack', pack_content: 100, pack_price: 13000, small_unit: 'lembar' },
  { code: '200014', name: 'BOX STANDARD', buy_unit: 'pack', pack_content: 100, pack_price: 125000, small_unit: 'pcs' },
  { code: '200015', name: 'LUNCH BOX', buy_unit: 'pack', pack_content: 100, pack_price: 115000, small_unit: 'pcs' },
  { code: '200016', name: 'BOX SERBAGUNA', buy_unit: 'pack', pack_content: 100, pack_price: 85000, small_unit: 'pcs' },
  { code: '200017', name: 'BOX SIAP SAJI', buy_unit: 'pack', pack_content: 100, pack_price: 60500, small_unit: 'pcs' },
  { code: '200018', name: 'BOX KENTANG', buy_unit: 'pack', pack_content: 200, pack_price: 119800, small_unit: 'pcs' },
  { code: '200019', name: 'SAMBAL GEPREK', buy_unit: 'pouch', pack_content: 500, pack_price: 64000, small_unit: 'gram' },
  { code: '200020', name: 'SAMBAL IJO', buy_unit: 'pouch', pack_content: 500, pack_price: 53000, small_unit: 'gram' },
  { code: '200021', name: 'SAMBAL HITAM', buy_unit: 'pouch', pack_content: 500, pack_price: 51500, small_unit: 'gram' },
  { code: '200022', name: 'CUP SAUCE 35 ML', buy_unit: 'pack', pack_content: 50, pack_price: 15000, small_unit: 'cup' },
  { code: '200023', name: 'PLASTIK KECIL', buy_unit: 'pack', pack_content: 25, pack_price: 7000, small_unit: 'pcs' },
  { code: '200024', name: 'PLASTIK SEDANG', buy_unit: 'pack', pack_content: 25, pack_price: 7000, small_unit: 'pcs' },
  { code: '200025', name: 'PLASTIK HITAM', buy_unit: 'pack', pack_content: 30, pack_price: 15600, small_unit: 'pcs' },
  { code: '200026', name: 'PLASTIK MERAH', buy_unit: 'pack', pack_content: 30, pack_price: 28000, small_unit: 'pcs' },
  { code: '200027', name: 'SARUNG TANGAN', buy_unit: 'pack', pack_content: 75, pack_price: 11000, small_unit: 'pcs' },
  { code: '200028', name: 'SAUS BULDAK', buy_unit: 'pouch', pack_content: 500, pack_price: 36800, small_unit: 'gram' },
  { code: '200029', name: 'SAUS TOMAT PRIMA', buy_unit: 'pack', pack_content: 20, pack_price: 9300, small_unit: 'sachet' },
  { code: '200030', name: 'SAUS KEJU MENTAI', buy_unit: 'pouch', pack_content: 500, pack_price: 27000, small_unit: 'gram' },
  { code: '200031', name: 'SAUS BLACK PAPPER', buy_unit: 'pack', pack_content: 10, pack_price: 16500, small_unit: 'sachet' },
  { code: '200032', name: 'SAUS BBQ', buy_unit: 'pack', pack_content: 10, pack_price: 8000, small_unit: 'sachet' },
  { code: '200033', name: 'SAUS EXTRA PEDAS (SADAS)', buy_unit: 'pouch', pack_content: 500, pack_price: 24500, small_unit: 'gram' },
  { code: '200034', name: 'MAYONAISE PRIMA 900 GR', buy_unit: 'pouch', pack_content: 900, pack_price: 36700, small_unit: 'gram' },
  { code: '200035', name: 'FRUIT TEA APPLE 250 ML', buy_unit: 'pcs', pack_content: 1, pack_price: 2500, small_unit: 'pcs' },
  { code: '200036', name: 'FRUIT TEA BLACKCURRANT 250 ML', buy_unit: 'pcs', pack_content: 1, pack_price: 2500, small_unit: 'pcs' },
  { code: '200037', name: 'FRUIT TEA LEMON 250 ML', buy_unit: 'pcs', pack_content: 1, pack_price: 2500, small_unit: 'pcs' },
  { code: '200038', name: 'THE BOTOL SOSRO 250 ML', buy_unit: 'pcs', pack_content: 1, pack_price: 2500, small_unit: 'pcs' },
  { code: '200039', name: 'CONCENTRATE FRUIT TEA BLACKCURRANT', buy_unit: 'botol', pack_content: 1, pack_price: 16700, small_unit: 'pcs' },
  { code: '200040', name: 'CONCENTRATE FRUIT TEA LEMON TEA', buy_unit: 'botol', pack_content: 1, pack_price: 16700, small_unit: 'pcs' },
  { code: '200041', name: 'AIR BOTOL 330 ML', buy_unit: 'dus', pack_content: 24, pack_price: 59400, small_unit: 'botol' },
  { code: '200042', name: 'AIR KESEHATAN CUP 220 ML', buy_unit: 'dus', pack_content: 48, pack_price: 28000, small_unit: 'gelas' },
  { code: '200043', name: 'KENTANG SIMPLOT 2.72 KG', buy_unit: 'pack', pack_content: 2.72, pack_price: 115000, small_unit: 'gram' },
  { code: '200044', name: 'KENTANG MC CAIN 2.5 KG', buy_unit: 'pack', pack_content: 2.5, pack_price: 110500, small_unit: 'gram' },
  { code: '200045', name: 'KARDUS UKURAN 30', buy_unit: 'pcs', pack_content: 1, pack_price: 9500, small_unit: 'pcs' },
  { code: '200046', name: 'KARDUS UKURAN 50', buy_unit: 'pcs', pack_content: 1, pack_price: 11000, small_unit: 'pcs' },
  { code: '200047', name: 'ROTI CHICKEN BUN', buy_unit: 'pack', pack_content: 4, pack_price: 8000, small_unit: 'pcs' },
  { code: '200048', name: 'PAPER BOWL 500 ML', buy_unit: 'pack', pack_content: 25, pack_price: 38750, small_unit: 'pcs' },
  { code: '200049', name: 'PAPER BOWL 650 ML', buy_unit: 'pack', pack_content: 25, pack_price: 41250, small_unit: 'pcs' },
  { code: '200050', name: 'OREGANO 25 GR', buy_unit: 'pcs', pack_content: 25, pack_price: 8000, small_unit: 'gram' },
  { code: '200051', name: 'SENDOK GARPU PLASTIK', buy_unit: 'pack', pack_content: 50, pack_price: 10000, small_unit: 'pcs' },
  { code: '200052', name: 'RICE BOX', buy_unit: 'pack', pack_content: 100, pack_price: 153200, small_unit: 'pcs' },
  { code: '200058', name: 'KENTANG SIMPLOT 2 KG', buy_unit: 'pack', pack_content: 2, pack_price: 83000, small_unit: 'gram' },
  { code: '200059', name: 'CHICKEN KATSU', buy_unit: 'pcs', pack_content: 1, pack_price: 4500, small_unit: 'pcs' },
  { code: '200060', name: 'KARDUS UKURAN 40', buy_unit: 'pcs', pack_content: 1, pack_price: 10000, small_unit: 'pcs' },
  { code: '200085', name: 'CUP SAUCE MIKA', buy_unit: 'pack', pack_content: 50, pack_price: 10000, small_unit: 'cup' },
  { code: '300001', name: 'AYAM POTONG 9 (MITRA)', buy_unit: 'pack', pack_content: 9, pack_price: 48000, small_unit: 'potong' },
  { code: '300014', name: 'AYAM BONELESS (MITRA)', buy_unit: 'pack', pack_content: 30, pack_price: 65000, small_unit: 'potong' },
  { code: '300056', name: 'KULIT AYAM (MITRA)', buy_unit: 'pack', pack_content: 500, pack_price: 20000, small_unit: 'gram' },
  { code: '300057', name: 'CHICKEN KATSU (MITRA)', buy_unit: 'pcs', pack_content: 1, pack_price: 4500, small_unit: 'pcs' },
  { code: '320001', name: 'TEPUNG FRIED CHICKEN (MITRA)', buy_unit: 'pack', pack_content: 1000, pack_price: 23500, small_unit: 'gram' },
  { code: '320006', name: 'KEMASAN AYAM (MITRA)', buy_unit: 'pack', pack_content: 100, pack_price: 23500, small_unit: 'lembar' }
]

function ImportPriceListButton({ reload, setErr, toast, disabled }: { reload: () => Promise<void>; setErr: (s: string) => void; toast: (s: string) => void; disabled?: boolean }): ReactElement {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await importPriceList(PRICE_LIST, false)
      await reload()
      toast(`Price list tersinkron: ${r.created} barang baru, ${r.updated} harga ter-update.`)
    } catch (ex) {
      setErr((ex as Error).message)
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }
  return (
    <>
      <button type="button" className="btn-ghost" disabled={disabled} onClick={() => setConfirming(true)}>
        📥 Impor Price List
      </button>
      <Modal open={confirming} title="Impor Price List" onClose={() => setConfirming(false)}>
        <p className="mb-2 text-sm">
          Sinkronkan <b>{PRICE_LIST.length} barang</b> dari Price List Sabana Sharing Mitra.
        </p>
        <ul className="mb-3 list-disc pl-5 text-xs text-brand-muted">
          <li>Barang baru → otomatis ditambah (stok 0, satuan &amp; satuan kecil terisi).</li>
          <li>Kode sudah ada → nama, satuan, isi &amp; harga di-update dari price list.</li>
          <li>Stok &amp; stok minimum <b>tidak</b> ikut ditimpa.</li>
        </ul>
        <div className="flex gap-2">
          <button type="button" className="btn-primary flex-1" disabled={busy} onClick={() => void run()}>
            {busy ? 'Mengimpor…' : 'Impor Sekarang'}
          </button>
          <button type="button" className="btn-ghost flex-1" onClick={() => setConfirming(false)}>
            Batal
          </button>
        </div>
      </Modal>
    </>
  )
}

/** Tabel bahan ala Price List: Kode · Nama · Satuan · Isi · Harga Kemasan + satuan kecil · Stok · Min · Status · Saran Beli. */
function BahanTable({
  catalog,
  list,
  q,
  setQ,
  activeFilter,
  setActiveFilter,
  dirty,
  setDirty,
  checked,
  toggleCk,
  toggleActive,
  toggling,
  setEditing,
  setDeleting,
  setRecipeFor,
  view,
  setViewPersist
}: {
  catalog: Catalog
  list: Ingredient[]
  q: string
  setQ: (s: string) => void
  activeFilter: 'all' | 'on' | 'off'
  setActiveFilter: (f: 'all' | 'on' | 'off') => void
  dirty: Record<number, number>
  setDirty: (d: Record<number, number>) => void
  checked: Set<number>
  toggleCk: (id: number, on: boolean) => void
  toggleActive: (i: Ingredient) => Promise<void>
  toggling: number | null
  setEditing: (i: Partial<Ingredient> | null) => void
  setDeleting: (i: Ingredient | null) => void
  setRecipeFor: (i: Ingredient | null) => void
  view: 'table' | 'grid'
  setViewPersist: (v: 'table' | 'grid') => void
}): ReactElement {
  const { toast } = useToast()
  // saran beli: kebutuhan buffer satu siklus belanja (min×2 − stok, satuan kecil)
  // dibulatkan KE ATAS ke kemasan penuh — kolom menampilkan pack, bukan satuan kecil
  const saranOf = (i: Ingredient): number => {
    if (i.kind !== 'raw' || i.stock > i.min_stock || i.min_stock <= 0) return 0
    const needSmall = Math.max(i.min_stock * 2 - i.stock, 1)
    return Math.max(Math.ceil(needSmall / (i.pack_content || 1)), 1)
  }
  const checkAll = (on: boolean): void => {
    for (const i of list) {
      const s = saranOf(i)
      if (on && s > 0 && i.kind === 'raw') toggleCk(i.id, true)
      if (!on) toggleCk(i.id, false)
    }
  }
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input className="input max-w-52" placeholder="Cari nama / kode…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari barang" />
        {/* filter status bahan: bahan nonaktif disembunyikan dari dropdown & saran beli di tempat lain */}
        <div className="flex gap-1" role="radiogroup" aria-label="Filter status bahan">
          {(
            [
              ['all', 'Semua'],
              ['on', 'Aktif'],
              ['off', 'Nonaktif']
            ] as ['all' | 'on' | 'off', string][]
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={activeFilter === k}
              className={`chip h-9 px-3 ${activeFilter === k ? 'bg-brand-btn text-white' : 'border-[1.5px] border-brand-line bg-brand-card'}`}
              onClick={() => setActiveFilter(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="btn-ghost" onClick={() => checkAll(true)} title="Centang semua barang yang perlu dibeli">
          ✅ Pilih yang perlu beli
        </button>
        {checked.size > 0 && (
          <span className="chip h-9 bg-brand-gold px-3">{checked.size} dipilih — lanjut di tab Pembelian</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {/* tampilan: tabel / kartu */}
          <div className="flex gap-1" role="radiogroup" aria-label="Tampilan">
            {(
              [
                ['table', '☰ Tabel'],
                ['grid', '▦ Kartu']
              ] as ['table' | 'grid', string][]
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={view === k}
                className={`chip h-9 px-3 ${view === k ? 'bg-brand-btn text-white' : 'border-[1.5px] border-brand-line bg-brand-card'}`}
                onClick={() => setViewPersist(k)}
              >
                {label}
              </button>
            ))}
          </div>
          <ImportPriceListButton reload={async () => {}} setErr={() => undefined} toast={toast} />
          <button type="button" className="btn-primary" onClick={() => setEditing({ kind: 'raw', buy_unit: 'pack', small_unit: '', pack_content: 1, price: 0, min_stock: 0, active: true })}>
            + Barang Baru
          </button>
        </div>
      </div>

      {/* Tampilan kartu: ringkas per barang, stok & harga terlihat sekilas */}
      {view === 'grid' && (
        <div className="grid grid-cols-2 content-start gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {list.map((i) => {
            const su = smallUnitOf(i)
            const low = i.stock <= i.min_stock && i.min_stock > 0
            const kritis = i.stock <= 0
            return (
              <div key={i.id} className={`card flex flex-col p-2.5 ${!i.active ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between gap-1">
                  <p className="line-clamp-2 text-sm font-bold leading-snug">
                    {i.name}
                    {i.code && <span className="ml-1 font-mono text-[10px] font-normal text-brand-muted">{i.code}</span>}
                  </p>
                  <span className={`chip shrink-0 text-[10px] ${kritis ? 'bg-brand-redtext text-white' : low ? 'bg-brand-gold' : 'bg-brand-gold/30'}`}>
                    {kritis ? 'Habis' : low ? 'Menipis' : 'Aman'}
                  </span>
                </div>
                <p className="mt-1 text-lg font-extrabold tabular-nums">
                  {fmtQty(i.stock)} <span className="text-[10px] font-bold text-brand-muted">{su}</span>
                </p>
                <p className="mt-0.5 text-[11px] font-bold text-brand-muted">
                  {fmtRp(packPriceOf(i))}/{i.buy_unit} · isi {fmtQty(i.pack_content)}
                  {i.kind === 'prepared' && ' · prepared'}
                </p>
                <p className="text-[11px] text-brand-muted">min {fmtQty(i.min_stock)} {su}</p>
                {i.pack_breakdown?.length ? (
                  <p className="mt-0.5 text-[11px] font-bold text-brand-muted" title="Komposisi 1 kemasan — dipakai audit jual per potongan">
                    {i.pack_breakdown.map((b) => `${b.qty} ${b.name}`).join(' + ')}
                  </p>
                ) : null}
                <div className="mt-auto flex justify-center gap-1.5 pt-2">
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={toggling === i.id}
                    title={i.active ? 'Matikan: hilang dari dropdown produksi, resep & saran beli' : 'Nyalakan lagi: bahan kembali dipakai'}
                    aria-label={i.active ? `Nonaktifkan ${i.name}` : `Aktifkan ${i.name}`}
                    onClick={() => void toggleActive(i)}
                  >
                    {i.active ? '⏻' : '⚡'}
                  </button>
                  {i.kind === 'prepared' && (
                    <button type="button" className="icon-btn" title="Resep produksi" aria-label={`Resep ${i.name}`} onClick={() => setRecipeFor(i)}>
                      🧾
                    </button>
                  )}
                  <button type="button" className="icon-btn" title="Edit barang" aria-label={`Edit ${i.name}`} onClick={() => setEditing(i)}>
                    ✏️
                  </button>
                  <button type="button" className="icon-btn-danger" title="Hapus barang" aria-label={`Hapus ${i.name}`} onClick={() => setDeleting(i)}>
                    🗑
                  </button>
                </div>
              </div>
            )
          })}
          {list.length === 0 && <p className="col-span-full py-8 text-center text-sm text-brand-muted">Tidak ada barang yang cocok.</p>}
        </div>
      )}

      <div className={view === 'table' ? 'card overflow-x-auto' : 'hidden'}>
        <table className="tbl min-w-[820px]">
          <thead>
            <tr>
              <th></th>
              <th>Nama Barang</th>
              <th>Satuan</th>
              <th>Isi</th>
              <th className="whitespace-nowrap text-right">Harga Kemasan</th>
              <th className="whitespace-nowrap text-right">Harga / satuan kecil</th>
              <th className="whitespace-nowrap text-right">Stok</th>
              <th className="text-right">Min</th>
              <th>Status</th>
              <th className="whitespace-nowrap text-right">Saran Beli</th>
              <th className="text-center">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {list.map((i) => {
              const low = i.stock <= i.min_stock && i.min_stock > 0
              const kritis = i.stock <= 0
              const su = smallUnitOf(i)
              const saran = saranOf(i)
              return (
                <tr key={i.id} className={!i.active ? 'opacity-60' : ''}>
                  <td>
                    {i.kind === 'raw' && <input type="checkbox" checked={checked.has(i.id)} onChange={(e) => toggleCk(i.id, e.target.checked)} aria-label={`Pilih ${i.name} untuk pembelian`} />}
                  </td>
                  <td className="font-bold">
                    {i.name}
                    {i.code && <span className="ml-1 font-mono text-[10px] font-normal text-brand-muted">{i.code}</span>}
                    {i.kind === 'prepared' && <span className="chip ml-1 border-[1.5px] border-brand-line bg-brand-paper">prepared</span>}
                    {!i.active && <span className="chip ml-1 bg-brand-line">nonaktif</span>}
                    {i.pack_breakdown?.length ? (
                      <span className="ml-1 text-[10px] font-bold text-brand-muted" title="Komposisi 1 kemasan">
                        ({i.pack_breakdown.map((b) => `${b.qty} ${b.name}`).join(' + ')})
                      </span>
                    ) : null}
                  </td>
                  <td>{i.buy_unit}</td>
                  <td className="whitespace-nowrap text-xs">{fmtQty(i.pack_content)} {su}</td>
                  <td className="text-right tabular-nums">
                    {i.kind === 'prepared' ? (
                      <span className="text-xs text-brand-muted">diproduksi</span>
                    ) : dirty[i.id] !== undefined ? (
                      <NumInput
                        className="input !h-9 !w-32 text-right"
                        format={fmtRpPlain}
                        parse={(s) => Math.round(parseInt(s.replace(/\D/g, ''), 10) / (i.pack_content || 1)) || 0}
                        value={dirty[i.id]}
                        onChange={(n) => setDirty({ ...dirty, [i.id]: n })}
                        ariaLabel={`Harga kemasan ${i.name}`}
                      />
                    ) : (
                      <button
                        type="button"
                        className="rounded px-1 font-bold tabular-nums underline decoration-brand-line underline-offset-4 hover:bg-brand-paper"
                        title="Klik untuk edit harga kemasan"
                        onClick={() => setDirty({ ...dirty, [i.id]: i.price })}
                      >
                        {fmtRp(packPriceOf(i))}
                      </button>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-right text-xs tabular-nums text-brand-muted">{i.kind === 'raw' ? `${fmtRpPlain(i.price)}/${su}` : `≈ ${fmtRp(preparedCost(i.id, catalog.ingRecipes, ingIndex(catalog.ingredients)))}/${su}`}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">
                    {fmtQty(i.stock)} {su}
                  </td>
                  <td className="text-right tabular-nums text-brand-muted">{fmtQty(i.min_stock)}</td>
                  <td>
                    <span className={`chip ${kritis ? 'bg-brand-redtext text-white' : low ? 'bg-brand-gold' : 'bg-brand-gold/30'}`}>
                      {kritis ? 'kritis' : low ? 'menipis' : 'aman'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap text-right font-bold tabular-nums">
                    {saran > 0 ? (
                      <>
                        {fmtQty(saran)} {i.buy_unit}
                        <br />
                        <span className="text-xs font-normal text-brand-muted">≈ {fmtRp(Math.round(saran * packPriceOf(i)))}</span>
                      </>
                    ) : (
                      <span className="font-normal text-brand-muted">—</span>
                    )}
                  </td>
                  <td>
                    <div className="flex justify-center gap-1">
                      {/* aksi ikon: ringkas satu baris — toggle, resep (prepared), edit, hapus */}
                      <button
                        type="button"
                        className="icon-btn"
                        disabled={toggling === i.id}
                        title={i.active ? 'Matikan: hilang dari dropdown produksi, resep & saran beli' : 'Nyalakan lagi: bahan kembali dipakai'}
                        aria-label={i.active ? `Nonaktifkan ${i.name}` : `Aktifkan ${i.name}`}
                        onClick={() => void toggleActive(i)}
                      >
                        {i.active ? '⏻' : '⚡'}
                      </button>
                      {i.kind === 'prepared' && (
                        <button type="button" className="icon-btn" title="Resep produksi" aria-label={`Resep ${i.name}`} onClick={() => setRecipeFor(i)}>
                          🧾
                        </button>
                      )}
                      <button type="button" className="icon-btn" title="Edit barang" aria-label={`Edit ${i.name}`} onClick={() => setEditing(i)}>
                        ✏️
                      </button>
                      <button type="button" className="icon-btn-danger" title="Hapus barang" aria-label={`Hapus ${i.name}`} onClick={() => setDeleting(i)}>
                        🗑
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {list.length === 0 && (
              <tr>
                <td colSpan={11} className="py-8 text-center text-sm text-brand-muted">
                  Tidak ada barang yang cocok.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** Tab Pembelian & Stok: keranjang dari barang tercentang + opname + waste + tabel stok. */
function StokTab({
  catalog,
  reload,
  setErr,
  checked,
  clearChecked
}: {
  catalog: Catalog
  reload: () => Promise<void>
  setErr: (s: string) => void
  checked: Set<number>
  clearChecked: () => void
}): ReactElement {
  const { toast } = useToast()
  const [lines, setLines] = useState<{ ingredient_id: number; packs: string; unit_cost: string }[]>([])
  const [note, setNote] = useState('')

  // bangun draft dari barang yang dicentang di tab Bahan (harga terakhir per kemasan)
  useEffect(() => {
    if (checked.size === 0) return
    setLines((prev) => {
      const have = new Set(prev.map((l) => l.ingredient_id))
      const add = [...checked].filter((id) => !have.has(id)).map((id) => {
        const ing = catalog.ingredients.find((i) => i.id === id)
        return { ingredient_id: id, packs: '', unit_cost: ing ? String(packPriceOf(ing)) : '' }
      })
      return add.length ? [...prev.filter((l) => checked.has(l.ingredient_id)), ...add] : prev.filter((l) => checked.has(l.ingredient_id))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked])

  const raws = useMemo(() => catalog.ingredients.filter((i) => i.kind === 'raw' && i.active), [catalog])
  const total = lines.reduce((s, l) => s + parseNum(l.packs) * (parseInt(l.unit_cost, 10) || 0), 0)

  const submitPurchase = async (): Promise<void> => {
    try {
      await createPurchase(
        lines.filter((l) => parseNum(l.packs) > 0).map((l) => ({ ingredient_id: l.ingredient_id, packs: parseNum(l.packs), unit_cost: parseInt(l.unit_cost, 10) || 0 })),
        note
      )
      setLines([])
      setNote('')
      clearChecked()
      await reload()
      toast('Pembelian tercatat, stok & harga bahan diperbarui.')
    } catch (ex) {
      setErr((ex as Error).message)
    }
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="flex flex-col gap-3">
        {/* Form pembelian ala price list: isi kemasan + harga per kemasan */}
        <div className="card strip h-fit p-4">
          <p className="mb-1 text-sm font-extrabold">Catat Pembelian</p>
          <p className="mb-3 text-sm text-brand-muted">
            {lines.length > 0 ? 'Barang dari tab Bahan siap diisi — centang lagi di tab Bahan untuk menambah.' : 'Isi manual di bawah, atau centang barang di tab Bahan dulu (kotak centang kiri).'}
          </p>
          {lines.length === 0 && (
            <div className="mb-2 grid grid-cols-[1fr_90px_120px_28px] gap-2">
              <select
                className="input !h-10"
                value={raws[0]?.id ?? 0}
                onChange={(e) => setLines([{ ingredient_id: parseInt(e.target.value, 10), packs: '', unit_cost: String(packPriceOf(catalog.ingredients.find((i) => i.id === parseInt(e.target.value, 10)) ?? { price: 0, pack_content: 1 })) }])}
                aria-label="Bahan"
              >
                {raws.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({o.buy_unit})
                  </option>
                ))}
              </select>
              <span />
              <span />
              <span />
            </div>
          )}
          {lines.map((l, i) => {
            const ing = catalog.ingredients.find((x) => x.id === l.ingredient_id)
            return (
              <div key={l.ingredient_id} className="mb-2 grid grid-cols-[1fr_90px_120px_28px] items-center gap-2">
                <span className="truncate text-sm font-bold">
                  {ing?.name} <span className="text-xs font-normal text-brand-muted">({ing?.buy_unit} isi {fmtQty(ing?.pack_content ?? 1)})</span>
                </span>
                <input
                  className="input !h-10 text-right"
                  placeholder={ing ? ing.buy_unit : ''}
                  inputMode="decimal"
                  value={l.packs}
                  onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, packs: e.target.value } : x)))}
                  aria-label={`Jumlah ${ing?.name ?? ''} (${ing?.buy_unit ?? ''})`}
                />
                <input
                  className="input !h-10 text-right"
                  placeholder="Harga/kemasan"
                  inputMode="numeric"
                  value={l.unit_cost}
                  onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unit_cost: e.target.value.replace(/\D/g, '') } : x)))}
                  aria-label="Harga per kemasan"
                />
                <button type="button" className="icon-btn-danger" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Hapus baris">
                  🗑
                </button>
              </div>
            )
          })}
          <button type="button" className="btn-ghost !min-h-0 !py-1.5 text-xs" onClick={() => { const first = raws.find((r) => !lines.some((l) => l.ingredient_id === r.id)) ?? raws[0]; if (first) setLines((ls) => [...ls, { ingredient_id: first.id, packs: '', unit_cost: String(packPriceOf(first)) }]) }}>
            + Baris
          </button>
          <div className="mt-3">
            <label className="lbl" htmlFor="pnote">
              Catatan (supplier, no. nota)
            </label>
            <input id="pnote" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="cth: Mitra Sabana — nota #2213" />
          </div>
          <p className="mt-2 text-lg font-extrabold">Total belanja: {fmtRp(total)}</p>
          <button type="button" className="btn-primary mt-2" disabled={total <= 0} onClick={() => void submitPurchase()}>
            Simpan Pembelian
          </button>
          <p className="mt-2 text-xs text-brand-muted">Setelah disimpan: stok bertambah (kemasan × isi), harga terakhir jadi harga bahan baru, HPP ikut terhitung ulang.</p>
        </div>

        <OpnameForm catalog={catalog} reload={reload} setErr={setErr} toast={toast} />
        <WasteForm catalog={catalog} reload={reload} setErr={setErr} toast={toast} />
      </div>
      <StokTable catalog={catalog} />
      <StockMoveTable catalog={catalog} />
    </div>
  )
}

/** Tabel stok: urut paling kritis di atas + saran beli. */
function StokTable({ catalog }: { catalog: Catalog }): ReactElement {
  const rows = catalog.ingredients
    .filter((i) => i.active)
    .sort((a, b) => {
      const ra = a.stock <= 0 ? -1 : a.min_stock > 0 ? a.stock / a.min_stock : 9
      const rb = b.stock <= 0 ? -1 : b.min_stock > 0 ? b.stock / b.min_stock : 9
      return ra - rb
    })
  const needBuy = rows.filter((i) => i.stock <= i.min_stock).length

  return (
    <div className="card h-fit overflow-hidden">
      <div className="flex items-center gap-2 border-b-[1.5px] border-brand-line px-4 py-2.5">
        <p className="mr-auto text-sm font-extrabold">Stok bahan</p>
        {needBuy > 0 && <span className="chip bg-brand-gold">{needBuy} bahan perlu beli</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="tbl min-w-[460px]">
          <thead>
            <tr>
              <th>Bahan</th>
              <th className="text-right">Stok</th>
              <th className="text-right">Min</th>
              <th>Status</th>
              <th className="text-right">Saran beli</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => {
              const low = i.stock <= i.min_stock
              const kritis = i.stock <= 0
              const saran = low ? Math.max(Math.ceil((i.min_stock * 2 - i.stock) / (i.pack_content || 1)), 1) : 0
              return (
                <tr key={i.id}>
                  <td className="font-bold">{i.name}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">
                    {fmtQty(i.stock)} {smallUnitOf(i)}
                  </td>
                  <td className="text-right tabular-nums text-brand-muted">{fmtQty(i.min_stock)}</td>
                  <td>
                    <span className={`chip ${kritis ? 'bg-brand-redtext text-white' : low ? 'bg-brand-gold' : 'bg-brand-gold/30'}`}>
                      {kritis ? 'kritis' : low ? 'menipis' : 'aman'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap text-right font-bold tabular-nums">
                    {saran > 0 ? (
                      <>
                        {fmtQty(saran)} {i.buy_unit}
                      </>
                    ) : (
                      <span className="font-normal text-brand-muted">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Chip warna jenis pergerakan stok. */
const MOVE_CHIP: Record<StockMove['kind'], string> = {
  pembelian: 'bg-[#22aa55] text-white',
  produksi: 'bg-[#2563eb] text-white',
  penjualan: 'bg-brand-ink/10',
  opname: 'bg-brand-gold',
  waste: 'bg-brand-redtext text-white',
  isifryer: 'bg-brand-ink/10',
  refund: 'bg-brand-redtext/20',
  batal: 'bg-brand-redtext/20',
  revisi: 'bg-brand-gold/40',
  lainnya: 'bg-brand-ink/10'
}

/**
 * Riwayat Stok: ledger audit semua pergerakan (pembelian, produksi, penjualan,
 * waste, opname/penyesuaian, refund/batal/revisi) dalam satu tabel — filter
 * bahan, rentang tanggal, dan jenis pergerakan.
 */
function StockMoveTable({ catalog }: { catalog: Catalog }): ReactElement {
  const [ingId, setIngId] = useState(0) // 0 = semua bahan
  const [from, setFrom] = useState(addDaysISO(todayISO(), -7))
  const [to, setTo] = useState(todayISO())
  const [kind, setKind] = useState('') // '' = semua jenis
  const [moves, setMoves] = useState<StockMove[] | null>(null)
  const [err, setErrLocal] = useState('')

  const load = useCallback(async () => {
    try {
      setMoves(await loadStockMoves({ ingredientId: ingId || undefined, fromISO: dayStart(from), toISO: dayEnd(to) }))
      setErrLocal('')
    } catch (ex) {
      setErrLocal((ex as Error).message)
    }
  }, [ingId, from, to])
  useEffect(() => {
    void load()
  }, [load])

  const shown = useMemo(() => (moves ?? []).filter((m) => !kind || m.kind === kind), [moves, kind])
  const totalIn = shown.filter((m) => m.qty > 0).reduce((s, m) => s + m.qty, 0)
  const totalOut = shown.filter((m) => m.qty < 0).reduce((s, m) => s + m.qty, 0)
  const ingName = (id: number): string => catalog.ingredients.find((i) => i.id === id)?.name ?? `#${id}`
  const unitOf = (id: number): string => {
    const i = catalog.ingredients.find((x) => x.id === id)
    return i ? smallUnitOf(i) : ''
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b-[1.5px] border-brand-line px-4 py-2.5">
        <p className="mr-auto text-sm font-extrabold">Riwayat Stok (audit)</p>
        <select className="input !h-9 !w-48" value={ingId} onChange={(e) => setIngId(parseInt(e.target.value, 10))} aria-label="Filter bahan">
          <option value={0}>Semua bahan</option>
          {catalog.ingredients.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        <select className="input !h-9 !w-40" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Filter jenis">
          <option value="">Semua jenis</option>
          {Object.keys(MOVE_CHIP).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <input type="date" className="input !h-9 !w-36" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="Dari tanggal" />
        <input type="date" className="input !h-9 !w-36" value={to} min={from} max={todayISO()} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="Sampai tanggal" />
        <button type="button" className="icon-btn !h-9 !w-9" title="Muat ulang riwayat" aria-label="Muat ulang riwayat stok" onClick={() => void load()}>
          ⟳
        </button>
      </div>
      {err && <p className="px-4 py-2 text-sm text-brand-redtext">{err}</p>}
      <div className="overflow-x-auto">
        <table className="tbl min-w-[560px]">
          <thead>
            <tr>
              <th>Waktu</th>
              <th>Bahan</th>
              <th>Jenis</th>
              <th className="text-right">Qty</th>
              <th>Sumber / catatan</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.id}>
                <td className="whitespace-nowrap text-xs text-brand-muted">{new Date(m.created_at).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                <td className="font-bold">{m.ingredient_name ?? ingName(m.ingredient_id)}</td>
                <td>
                  <span className={`chip ${MOVE_CHIP[m.kind] ?? 'bg-brand-ink/10'}`}>{m.kind}</span>
                </td>
                <td className={`whitespace-nowrap text-right font-bold tabular-nums ${m.qty > 0 ? 'text-[#22aa55]' : 'text-brand-redtext'}`}>
                  {m.qty > 0 ? '+' : ''}
                  {fmtQty(m.qty)} {unitOf(m.ingredient_id)}
                </td>
                <td className="text-xs text-brand-muted">{[m.ref, m.note].filter(Boolean).join(' · ') || '—'}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-sm text-brand-muted">
                  {moves === null ? 'Memuat…' : 'Tidak ada pergerakan pada filter ini.'}
                </td>
              </tr>
            )}
          </tbody>
          {shown.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={3} className="text-right text-xs font-bold text-brand-muted">Total masuk / keluar</td>
                <td className="whitespace-nowrap text-right text-xs font-bold tabular-nums">
                  <span className="text-[#22aa55]">+{fmtQty(totalIn)}</span> / <span className="text-brand-redtext">{fmtQty(totalOut)}</span>
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="px-4 py-2 text-xs text-brand-muted">Maks 500 baris terakhir per muatan — persempit filter untuk melihat lebih detail.</p>
    </div>
  )
}

/**
 * Stok opname sebagai penyesuaian CRUD: catat hasil hitung fisik (+ catatan),
 * lalu riwayat penyesuaian bisa diedit/hapus — salah ketik tidak permanen lagi.
 */
function OpnameForm({
  catalog,
  reload,
  setErr,
  toast
}: {
  catalog: Catalog
  reload: () => Promise<void>
  setErr: (s: string) => void
  toast: (s: string) => void
}): ReactElement {
  const [ingId, setIngId] = useState(catalog.ingredients[0]?.id ?? 0)
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [history, setHistory] = useState<StockAdjustment[]>([])
  const [editing, setEditing] = useState<{ adj: StockAdjustment; qty: string; note: string } | null>(null)
  const ing = catalog.ingredients.find((i) => i.id === ingId)

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await loadStockAdjustments(30))
    } catch {
      setHistory([])
    }
  }, [])
  useEffect(() => {
    void refreshHistory()
  }, [refreshHistory])

  return (
    <div className="card strip h-fit p-4">
      <p className="mb-1 text-sm font-extrabold">Stok opname</p>
      <p className="mb-3 text-sm text-brand-muted">Samakan stok sistem dengan hitungan fisik. Tercatat sebagai penyesuaian — bisa diedit/dihapus bila keliru.</p>
      <div className="mb-2">
        <label className="lbl" htmlFor="oing">
          Bahan
        </label>
        <select id="oing" className="input" value={ingId} onChange={(e) => setIngId(parseInt(e.target.value, 10))}>
          {catalog.ingredients.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} (sistem: {fmtQty(i.stock)} {smallUnitOf(i)})
            </option>
          ))}
        </select>
      </div>
      <div className="mb-2">
        <label className="lbl" htmlFor="oqty">
          Hasil hitung fisik ({ing ? smallUnitOf(ing) : ''})
        </label>
        <input id="oqty" className="input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.,]/g, ''))} />
      </div>
      <div className="mb-3">
        <label className="lbl" htmlFor="onote">
          Catatan (opsional)
        </label>
        <input id="onote" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="cth: beda 1 pack — pecah di rak" />
      </div>
      <button
        type="button"
        className="btn-primary"
        disabled={!qty.trim()}
        onClick={async () => {
          try {
            await createStockAdjustment(ingId, parseNum(qty), note)
            setQty('')
            setNote('')
            await Promise.all([reload(), refreshHistory()])
            toast('Stok disesuaikan — tercatat di riwayat penyesuaian.')
          } catch (ex) {
            setErr((ex as Error).message)
          }
        }}
      >
        Sesuaikan Stok
      </button>

      {history.length > 0 && (
        <div className="mt-4 border-t border-brand-line pt-3">
          <p className="mb-2 text-sm font-extrabold">Riwayat penyesuaian</p>
          <ul className="flex flex-col gap-2">
            {history.map((h) => {
              const delta = h.qty - h.prev_qty
              const su = smallUnitOf(catalog.ingredients.find((i) => i.id === h.ingredient_id) ?? ({ buy_unit: '', small_unit: null, pack_content: 1 } as Ingredient))
              return (
                <li key={h.id} className="flex items-center justify-between gap-2 rounded-lg border border-brand-line px-2 py-1.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">
                      {h.ingredient_name ?? `#${h.ingredient_id}`}{' '}
                      <span className="tabular-nums">
                        {fmtQty(h.prev_qty)} → {fmtQty(h.qty)} {su}
                      </span>{' '}
                      <span className={delta > 0 ? 'text-xs font-bold text-[#22aa55]' : delta < 0 ? 'text-xs font-bold text-brand-redtext' : 'text-xs text-brand-muted'}>
                        ({delta > 0 ? '+' : ''}
                        {fmtQty(delta)})
                      </span>
                    </p>
                    <p className="truncate text-xs text-brand-muted">
                      {new Date(h.created_at).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      {h.note ? ` · ${h.note}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button type="button" className="icon-btn !h-8 !w-8" title="Edit penyesuaian" aria-label={`Edit penyesuaian ${h.ingredient_name ?? h.id}`} onClick={() => setEditing({ adj: h, qty: String(h.qty), note: h.note ?? '' })}>
                      ✏️
                    </button>
                    <button
                      type="button"
                      className="icon-btn-danger !h-8 !w-8"
                      title="Hapus penyesuaian (stok kembali ke nilai sebelum)"
                      aria-label={`Hapus penyesuaian ${h.ingredient_name ?? h.id}`}
                      onClick={async () => {
                        if (!window.confirm(`Hapus penyesuaian ${h.ingredient_name ?? '#'+h.ingredient_id}? Stok kembali ke ${fmtQty(h.prev_qty)}.`)) return
                        try {
                          await deleteStockAdjustment(h.id)
                          await Promise.all([reload(), refreshHistory()])
                          toast('Penyesuaian dihapus — stok dikembalikan.')
                        } catch (ex) {
                          setErr((ex as Error).message)
                        }
                      }}
                    >
                      🗑
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <Modal open={editing !== null} title="Edit Penyesuaian Stok" onClose={() => setEditing(null)}>
        {editing && (
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault()
              try {
                await updateStockAdjustment(editing.adj.id, parseNum(editing.qty), editing.note)
                setEditing(null)
                await Promise.all([reload(), refreshHistory()])
                toast('Penyesuaian diperbarui — stok ikut disesuaikan.')
              } catch (ex) {
                setErr((ex as Error).message)
              }
            }}
          >
            <p className="text-sm text-brand-muted">
              Ubah hasil hitung fisik <b>{editing.adj.ingredient_name ?? `#${editing.adj.ingredient_id}`}</b>. Stok terkini akan digeser selisihnya — penjualan setelah penyesuaian ini tetap terhitung.
            </p>
            <div>
              <label className="lbl" htmlFor="eadjq">Jumlah fisik yang benar</label>
              <input
                id="eadjq"
                className="input"
                inputMode="decimal"
                autoFocus
                value={editing.qty}
                onChange={(e) => setEditing({ ...editing, qty: e.target.value })}
              />
            </div>
            <div>
              <label className="lbl" htmlFor="eadjn">Catatan</label>
              <input
                id="eadjn"
                className="input"
                value={editing.note}
                onChange={(e) => setEditing({ ...editing, note: e.target.value })}
              />
            </div>
            <button type="submit" className="btn-primary">Simpan Perubahan</button>
          </form>
        )}
      </Modal>
    </div>
  )
}

function WasteForm({
  catalog,
  reload,
  setErr,
  toast
}: {
  catalog: Catalog
  reload: () => Promise<void>
  setErr: (s: string) => void
  toast: (s: string) => void
}): ReactElement {
  const [mode, setMode] = useState<'bahan' | 'produk'>('bahan')
  const [ingId, setIngId] = useState(catalog.ingredients[0]?.id ?? 0)
  const [prodId, setProdId] = useState(catalog.products[0]?.id ?? 0)
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  return (
    <div className="card strip h-fit p-4">
      <p className="mb-1 text-sm font-extrabold">Waste / hangus</p>
      <p className="mb-3 text-sm text-brand-muted">Bahan terbuang/hangus dikurangi dari stok, jadi margin riil di laporan tetap jujur.</p>
      <div className="mb-2 flex gap-1" role="radiogroup" aria-label="Jenis waste">
        {(
          [
            ['bahan', 'Bahan mentah'],
            ['produk', 'Produk jadi']
          ] as ['bahan' | 'produk', string][]
        ).map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={mode === k} className={`chip h-9 px-3 ${mode === k ? 'bg-brand-btn text-white' : 'border-[1.5px] border-brand-line bg-brand-card'}`} onClick={() => setMode(k)}>
            {label}
          </button>
        ))}
      </div>
      {mode === 'bahan' ? (
        <div className="mb-2">
          <label className="lbl" htmlFor="wing">
            Bahan
          </label>
          <select id="wing" className="input" value={ingId} onChange={(e) => setIngId(parseInt(e.target.value, 10))}>
            {catalog.ingredients.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="mb-2">
          <label className="lbl" htmlFor="wprod">
            Produk jadi
          </label>
          <select id="wprod" className="input" value={prodId} onChange={(e) => setProdId(parseInt(e.target.value, 10))}>
            {catalog.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="mb-2">
        <label className="lbl" htmlFor="wqty">
          Jumlah ({mode === 'bahan' ? smallUnitOf(catalog.ingredients.find((i) => i.id === ingId) ?? { buy_unit: '', pack_content: 1, small_unit: '' }) : 'porsi'})
        </label>
        <input id="wqty" className="input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.,]/g, ''))} />
      </div>
      <div className="mb-3">
        <label className="lbl" htmlFor="wnote">
          Penyebab
        </label>
        <input id="wnote" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="hangus / jatuh / kadaluarsa" />
      </div>
      <button
        type="button"
        className="btn-primary"
        onClick={async () => {
          try {
            const q2 = parseNum(qty)
            if (q2 <= 0) return
            await logWaste(mode === 'bahan' ? [{ ingredient_id: ingId, qty: q2 }] : [{ product_id: prodId, qty: q2 }], note || 'waste')
            setQty('')
            setNote('')
            await reload()
            toast('Waste tercatat.')
          } catch (ex) {
            setErr((ex as Error).message)
          }
        }}
      >
        Catat Waste
      </button>
    </div>
  )
}

// ================= Tab Menu & HPP (ala file HPP Reguler) =================

function MenuHppTab({
  catalog,
  ingById,
  reload,
  setErr,
  toast,
  goBahan
}: {
  catalog: Catalog
  ingById: ReturnType<typeof ingIndex>
  reload: () => Promise<void>
  setErr: (s: string) => void
  toast: (s: string) => void
  goBahan: () => void
}): ReactElement {
  const [warnPct, setWarnPct] = useState(15)
  const [recipeFor, setRecipeFor] = useState<Product | null>(null)
  const [q, setQ] = useState('')
  const [onlyTipis, setOnlyTipis] = useState(false)

  useEffect(() => {
    void import('../lib/db')
      .then((m) => m.loadSettings())
      .then((s) => setWarnPct(s.margin.warn_pct))
      .catch(() => {})
  }, [])

  const rows = catalog.products
    .filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))
    .map((p) => {
      const lines = hppLines(p.id, catalog.recipeByProduct, catalog.ingRecipes, ingById)
      const hpp = hppTotal(lines)
      const mg = marginPct(p.price, hpp)
      return { p, lines, hpp, mg, tipis: hpp > 0 && mg < warnPct }
    })
    .filter((r) => !onlyTipis || r.tipis)
  const tipisCount = catalog.products.filter((p) => {
    const hpp = hppTotal(hppLines(p.id, catalog.recipeByProduct, catalog.ingRecipes, ingById))
    return hpp > 0 && marginPct(p.price, hpp) < warnPct
  }).length
  const avgMargin = (() => {
    const ms = catalog.products.map((p) => {
      const hpp = hppTotal(hppLines(p.id, catalog.recipeByProduct, catalog.ingRecipes, ingById))
      return hpp > 0 ? marginPct(p.price, hpp) : 0
    })
    return ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : 0
  })()

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="chip h-9 border-[1.5px] border-brand-line bg-brand-card px-3">🍗 {catalog.products.length} menu</span>
        <span className="chip h-9 border-[1.5px] border-brand-line bg-brand-card px-3">📈 Margin rata-rata {avgMargin.toFixed(0)}%</span>
        <span className={`chip h-9 px-3 ${tipisCount > 0 ? 'bg-brand-gold' : 'border-[1.5px] border-brand-line bg-brand-card'}`}>⚠ {tipisCount} menu margin &lt; {warnPct}%</span>
        <span className="chip h-9 border-[1.5px] border-brand-line bg-brand-card px-3">🔁 HPP otomatis ikut harga bahan</span>
        <div className="ml-auto flex gap-2">
          <input className="input max-w-52" placeholder="Cari menu…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari menu" />
          <button type="button" className={`btn-ghost ${onlyTipis ? '!border-brand-redtext !text-brand-redtext' : ''}`} onClick={() => setOnlyTipis(!onlyTipis)}>
            {onlyTipis ? 'Tampilkan semua' : 'Hanya margin tipis'}
          </button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="tbl min-w-[760px]">
          <thead>
            <tr>
              <th>Menu</th>
              <th className="text-right">Harga Jual</th>
              <th className="text-right">HPP</th>
              <th className="text-right">Margin</th>
              <th className="whitespace-nowrap">Margin %</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, hpp, mg, tipis }) => (
              <tr key={p.id} className={!p.is_active ? 'opacity-60' : ''}>
                <td className="font-bold">
                  {p.name} <span className="text-xs font-normal text-brand-muted">/ {p.unit}</span>
                  {!p.is_active && <span className="chip ml-1 bg-brand-line">nonaktif</span>}
                </td>
                <td className="text-right tabular-nums">{fmtRp(p.price)}</td>
                <td className="text-right tabular-nums">{hpp > 0 ? fmtRp(hpp) : <span className="chip bg-brand-redtext text-white">belum diatur</span>}</td>
                <td className={`text-right font-bold tabular-nums ${tipis ? 'text-brand-redtext' : ''}`}>{hpp > 0 ? fmtRp(p.price - hpp) : '—'}</td>
                <td className="min-w-32">
                  {hpp > 0 ? (
                    <>
                      <b className={tipis ? 'text-brand-redtext' : ''}>{mg.toFixed(1)}%</b>
                      <div className="mt-1 h-1.5 w-28 rounded border border-brand-line bg-brand-paper">
                        <div className={`h-full rounded ${tipis ? 'bg-brand-redtext' : 'bg-brand-gold'}`} style={{ width: `${Math.min(Math.max(mg, 0), 100)}%` }} />
                      </div>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  <span className={`chip ${tipis ? 'bg-brand-gold' : 'bg-brand-gold/30'}`}>{hpp <= 0 ? 'tanpa HPP' : tipis ? 'tipis' : 'aman'}</span>
                </td>
                <td className="whitespace-nowrap">
                  <button type="button" className={`btn-ghost !min-h-0 !px-2 !py-1 text-xs ${hpp <= 0 ? '!border-brand-redtext !text-brand-redtext' : ''}`} onClick={() => setRecipeFor(p)}>
                    {hpp > 0 ? 'Resep' : 'Atur resep'}
                  </button>{' '}
                  <button type="button" className="btn-ghost !min-h-0 !px-2 !py-1 text-xs" onClick={goBahan} title="Harga bahan diubah di tab Bahan Baku">
                    Harga bahan
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-sm text-brand-muted">
                  Tidak ada menu yang cocok.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-brand-muted">
        HPP dihitung dari resep × harga bahan sekarang — berubah otomatis begitu harga beli berubah. Nama, harga jual, kategori &amp; foto menu tetap dikelola di halaman <b>Menu &amp; Paket</b>.
      </p>

      <Modal open={recipeFor !== null} title={`Resep: ${recipeFor?.name ?? ''}`} onClose={() => setRecipeFor(null)} wide>
        {recipeFor && <RecipeEditorInline catalog={catalog} product={recipeFor} ingById={ingById} onDone={() => { setRecipeFor(null); void reload() }} setErr={setErr} toast={toast} />}
      </Modal>
    </>
  )
}

/** Editor resep produk (versi tabel Menu & HPP; sama dengan di Menu & Paket). */
function RecipeEditorInline({
  catalog,
  product,
  ingById,
  onDone,
  setErr,
  toast
}: {
  catalog: Catalog
  product: Product
  ingById: ReturnType<typeof ingIndex>
  onDone: () => void
  setErr: (s: string) => void
  toast: (s: string) => void
}): ReactElement {
  const existing = catalog.recipeByProduct.get(product.id) ?? []
  const [lines, setLines] = useState(existing.map((r) => ({ kind: r.kind, component_id: r.component_id, qty: r.qty })))

  const linesHpp = useMemo(() => {
    const m = lines.map((l) => ({ product_id: product.id, kind: l.kind, component_id: l.component_id, qty: l.qty }))
    const map = new Map(catalog.recipeByProduct)
    map.set(product.id, m)
    return hppLines(product.id, map, catalog.ingRecipes, ingById)
  }, [lines, product.id, catalog, ingById])

  const total = hppTotal(linesHpp)
  const mg = marginPct(product.price, total)

  const addLine = (kind: 'ingredient' | 'product'): void => {
    const pool = kind === 'ingredient' ? catalog.ingredients.filter((i) => i.kind === 'raw') : catalog.products.filter((p) => p.id !== product.id)
    if (pool.length === 0) return
    setLines((ls) => [...ls, { kind, component_id: pool[0].id, qty: 1 }])
  }

  return (
    <div>
      <p className="mb-3 text-sm text-brand-muted">
        Komponen per 1 {product.unit} jual. Qty memakai <b>satuan kecil</b> bahan (mis. potong / gram / sachet). HPP dihitung otomatis dari harga bahan sekarang.
      </p>
      <div className="flex flex-col gap-2">
        {lines.map((l, i) => {
          const pool = l.kind === 'ingredient' ? catalog.ingredients.filter((x) => x.kind === 'raw') : catalog.products.filter((x) => x.id !== product.id)
          const line = linesHpp.find((h) => h.ingredientId === l.component_id)
          const comp = pool.find((o) => o.id === l.component_id)
          return (
            <div key={i} className="grid grid-cols-[1fr_84px_88px_32px] items-center gap-2">
              <select
                className="input !h-10"
                value={l.component_id}
                onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, component_id: parseInt(e.target.value, 10) } : x)))}
                aria-label="Komponen"
              >
                {pool.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}{l.kind === 'ingredient' ? ` (${smallUnitOf(o as Ingredient)})` : ''}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1">
                <NumInput
                  className="input !h-10 text-right"
                  value={l.qty}
                  onChange={(n) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: n } : x)))}
                  ariaLabel="Qty"
                />
                <span className="text-xs font-bold text-brand-muted">{l.kind === 'ingredient' && comp && 'buy_unit' in comp ? smallUnitOf(comp) : ''}</span>
              </div>
              <span className="text-right text-xs font-bold tabular-nums">{line ? fmtRp(line.cost) : '—'}</span>
              <button type="button" className="icon-btn-danger" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Hapus baris">
                🗑
              </button>
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex gap-2">
        <button type="button" className="btn-ghost !min-h-0 !py-1.5 text-xs" onClick={() => addLine('ingredient')}>
          + Bahan
        </button>
        <button type="button" className="btn-ghost !min-h-0 !py-1.5 text-xs" onClick={() => addLine('product')}>
          + Produk lain (setengah jadi)
        </button>
      </div>
      <div className="card strip mt-4 p-3">
        <p className="text-sm font-bold">HPP per {product.unit}: {fmtRp(total)}</p>
        <p className="text-sm font-bold">
          Harga jual {fmtRp(product.price)} → margin {mg.toFixed(1)}% ({fmtRp(product.price - total)})
        </p>
        <ul className="mt-2 text-xs text-brand-muted">
          {linesHpp.slice(0, 6).map((h) => (
            <li key={h.ingredientId}>
              {h.name}: {fmtHppQty(h)} = {fmtRp(h.cost)}
            </li>
          ))}
          {linesHpp.length > 6 && <li>+ {linesHpp.length - 6} bahan lainnya</li>}
        </ul>
      </div>
      <button
        type="button"
        className="btn-primary mt-3 w-full"
        onClick={async () => {
          try {
            const { saveRecipe } = await import('../lib/db')
            await saveRecipe(product.id, lines.filter((l) => l.qty > 0))
            onDone()
            toast('Resep tersimpan — HPP & margin ter-update.')
          } catch (ex) {
            setErr((ex as Error).message)
          }
        }}
      >
        Simpan Resep
      </button>
    </div>
  )
}

// ================= Insight belanja (dipindah utuh dari halaman lama) =================

function BuyInsight({ catalog, setErr }: { catalog: Catalog; setErr: (s: string) => void }): ReactElement {
  const [plan, setPlan] = useState<BuyPlan | null>(null)
  const [days, setDays] = useState(7)
  const [historyDays, setHistoryDays] = useState(14)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const compute = useCallback(
    async (d: number, hist: number) => {
      setLoading(true)
      try {
        const to = new Date()
        const from = new Date(Date.now() - hist * 86400000)
        const txs = await loadTransactions(from.toISOString(), to.toISOString())
        const names = new Map(catalog.products.map((p) => [p.id, p.name]))
        const daily = dailySalesOf(txs, catalog.products.map((p) => p.id), names)
        setPlan(buyPlanFromSales(daily, d, hist, catalog.ingredients, catalog.recipeByProduct, catalog.ingRecipes))
      } catch (ex) {
        setErr((ex as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [catalog, setErr]
  )

  useEffect(() => {
    void compute(days, historyDays)
  }, [compute, days, historyDays])

  const share = async (): Promise<void> => {
    if (!plan) return
    const text = buyPlanToText(plan)
    try {
      if (navigator.share) await navigator.share({ title: 'Rencana Belanja Bahan', text })
      else {
        await navigator.clipboard.writeText(text)
        window.alert('Daftar belanja disalin ke clipboard.')
      }
    } catch {
      // user membatalkan share
    }
  }

  const lowSoon = plan?.items.filter((i) => i.daysLeft < 2) ?? []

  return (
    <div className="card strip mt-3 max-w-3xl p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-extrabold">Insight Belanja Bahan Baku</h2>
        <label className="flex items-center gap-1 text-xs font-bold text-brand-muted">
          Horizon
          <select className="input !h-8 !w-24 text-sm" value={days} onChange={(e) => setDays(parseInt(e.target.value, 10))} aria-label="Horizon hari ke depan">
            {[3, 7, 14].map((d) => (
              <option key={d} value={d}>
                {d} hari
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs font-bold text-brand-muted">
          Data historis
          <select className="input !h-8 !w-24 text-sm" value={historyDays} onChange={(e) => setHistoryDays(parseInt(e.target.value, 10))} aria-label="Panjang data historis">
            {[7, 14, 30].map((d) => (
              <option key={d} value={d}>
                {d} hari
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-1 text-sm text-brand-muted">
        Rata-rata penjualan {historyDays} hari terakhir → kebutuhan {days} hari ke depan dikurangi stok sekarang.
        {plan && plan.weekendRatio !== 1 && (
          <span className="font-bold text-brand-btn"> Weekend-aware: Sabtu/Minggu dihitung ×{plan.weekendRatio.toFixed(1)} dari hari kerja.</span>
        )}
      </p>

      {loading && <p className="mt-2 text-sm text-brand-muted">Menghitung...</p>}

      {plan && !loading && (
        <>
          {plan.items.length === 0 ? (
            <p className="mt-2 text-sm font-bold text-brand-muted">Semua stok masih cukup untuk {days} hari ke depan 🎉</p>
          ) : (
            <>
              <div className="mt-2 flex flex-wrap items-baseline gap-2">
                <p className="text-2xl font-extrabold">{fmtRp(plan.totalCost)}</p>
                <p className="text-sm font-bold text-brand-muted">
                  estimasi belanja {plan.items.length} bahan untuk {days} hari
                </p>
              </div>
              {lowSoon.length > 0 && (
                <p className="mt-1 text-xs font-bold text-brand-redtext">
                  ⚠ Segera habis (&lt;2 hari): {lowSoon.map((i) => i.name).join(', ')}
                </p>
              )}
              <button type="button" className="btn-ghost !min-h-0 mt-2 !py-1.5 text-xs" onClick={() => setOpen(!open)}>
                {open ? 'Sembunyikan rincian' : `Lihat rincian (${plan.items.length} bahan)`}
              </button>
              {open && (
                <div className="mt-2 overflow-x-auto">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Bahan</th>
                        <th className="text-right">Pakai/hari</th>
                        <th className="text-right">Stok</th>
                        <th className="text-right">Cukup untuk</th>
                        <th className="text-right">Butuh {days} hari</th>
                        <th className="text-right">Belanja</th>
                        <th className="text-right">Estimasi biaya</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.items.map((i) => (
                        <tr key={i.ingredientId}>
                          <td className="font-bold">{i.name}</td>
                          <td className="text-right tabular-nums">{fmtQty(Math.round(i.dailyUse * 1000) / 1000)}</td>
                          <td className="text-right tabular-nums">{fmtQty(Math.round(i.stock * 1000) / 1000)}</td>
                          <td className={`text-right tabular-nums ${i.daysLeft < 2 ? 'font-bold text-brand-redtext' : ''}`}>{i.daysLeft < 1 ? 'habis hari ini' : `${fmtQty(Math.round(i.daysLeft * 10) / 10)} hari`}</td>
                          <td className="text-right tabular-nums">{fmtQty(Math.round(i.need * 1000) / 1000)}</td>
                          <td className="text-right font-extrabold tabular-nums">
                            {fmtQty(i.buyQty)} {i.buyUnit}
                          </td>
                          <td className="text-right tabular-nums">{fmtRp(i.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <button type="button" className="btn-primary mt-3" onClick={() => void share()}>
                Bagikan Daftar Belanja
              </button>
            </>
          )}
        </>
      )}
    </div>
  )
}

// Editor resep produksi bahan prepared (dipindah utuh)
function IngRecipeEditor({
  catalog,
  ingredient,
  onDone,
  setErr
}: {
  catalog: Catalog
  ingredient: Ingredient
  onDone: () => void
  setErr: (s: string) => void
}): ReactElement {
  const existing = catalog.ingRecipes.get(ingredient.id) ?? []
  const [lines, setLines] = useState<IngredientRecipe[]>(existing.map((r) => ({ ...r })))
  const ingById = useMemo(() => ingIndex(catalog.ingredients), [catalog])

  const rawTotal = useMemo(() => {
    let total = 0
    for (const l of lines) {
      const ing = ingById.get(l.component_id)
      if (ing) total += l.qty * ing.price
    }
    return total
  }, [lines, ingById])

  const raws = catalog.ingredients.filter((i) => i.kind === 'raw')

  return (
    <div>
      <p className="mb-3 text-sm text-brand-muted">
        Bahan mentah yang terpakai untuk menghasilkan 1 {ingredient.buy_unit} {ingredient.name}. Dipakai saat batch produksi. Qty memakai satuan kecil bahan.
      </p>
      {lines.map((l, i) => {
        const comp = ingById.get(l.component_id)
        return (
          <div key={i} className="mb-2 grid grid-cols-[1fr_84px_32px] items-center gap-2">
            <select className="input !h-10" value={l.component_id} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, component_id: parseInt(e.target.value, 10) } : x)))} aria-label="Bahan mentah">
              {raws.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({fmtRp(o.price)}/{smallUnitOf(o)})
                </option>
              ))}
            </select>
            <div className="flex items-center gap-1">
              <NumInput
                className="input !h-10 text-right"
                value={l.qty}
                onChange={(n) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: n } : x)))}
                ariaLabel="Qty per unit"
              />
              <span className="text-xs font-bold text-brand-muted">{comp ? smallUnitOf(comp) : ''}</span>
            </div>
            <button type="button" className="icon-btn-danger" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Hapus">
              🗑
            </button>
          </div>
        )
      })}
      <button type="button" className="btn-ghost !min-h-0 !py-1.5 text-xs" onClick={() => setLines((ls) => [...ls, { ingredient_id: ingredient.id, component_id: raws[0]?.id ?? 0, qty: 1 }])}>
        + Bahan Mentah
      </button>
      <div className="card strip mt-3 p-3 text-sm font-bold">
        Biaya bahan per 1 {ingredient.buy_unit}: {fmtRp(rawTotal)}
      </div>
      <button
        type="button"
        className="btn-primary mt-3 w-full"
        onClick={async () => {
          try {
            await saveIngredientRecipe(ingredient.id, lines.filter((l) => l.qty > 0).map((l) => ({ component_id: l.component_id, qty: l.qty })))
            onDone()
          } catch (ex) {
            setErr((ex as Error).message)
          }
        }}
      >
        Simpan Resep Produksi
      </button>
    </div>
  )
}
