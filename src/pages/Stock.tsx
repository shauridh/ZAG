import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ingIndex } from '../lib/hpp'
import { loadCatalog, createPurchase, opname, logWaste, type Catalog } from '../lib/db'
import { ErrorSummary } from '../components/ErrorSummary'
import { useToast } from '../components/Toast'
import { fmtQty, parseNum } from '../lib/money'

type Tab = 'pembelian' | 'opname' | 'waste'

export default function StockPage(): ReactElement {
  const { toast } = useToast()
  const [searchParams] = useSearchParams()
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [tab, setTab] = useState<Tab>(() => {
    const t = searchParams.get('tab')
    return t === 'opname' || t === 'waste' ? t : 'pembelian'
  })
  const [err, setErr] = useState('')

  const reload = useCallback(async () => {
    try {
      setCatalog(await loadCatalog())
    } catch (ex) {
      setErr((ex as Error).message)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  if (!catalog) return <div className="p-6 text-sm font-bold text-brand-muted">Memuat...</div>

  return (
    <div className="p-3 lg:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-extrabold">Stok & Pembelian</h1>
        <div className="flex gap-1" role="tablist" aria-label="Bagian stok">
          {(
            [
              ['pembelian', 'Catat Pembelian'],
              ['opname', 'Stok Opname'],
              ['waste', 'Waste / Hangus']
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
      {err && <ErrorSummary err={err} label="Pembelian/opname gagal" />}

      {tab === 'pembelian' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <PurchaseForm catalog={catalog} reload={reload} setErr={setErr} toast={toast} />
          <StockTable catalog={catalog} />
        </div>
      )}
      {tab === 'opname' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <OpnameForm catalog={catalog} reload={reload} setErr={setErr} toast={toast} />
          <StockTable catalog={catalog} />
        </div>
      )}
      {tab === 'waste' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <WasteForm catalog={catalog} reload={reload} setErr={setErr} toast={toast} />
          <StockTable catalog={catalog} />
        </div>
      )}
    </div>
  )
}

/**
 * Tabel stok dengan saran beli otomatis: kebutuhan = min×2 − stok (buffer satu
 * siklus belanja), tampil hanya bahan aktif. Saran = keputusan, bukan dekorasi.
 */
function StockTable({ catalog }: { catalog: Catalog }): ReactElement {
  const rows = catalog.ingredients
    .filter((i) => i.active)
    .sort((a, b) => {
      // paling kritis di atas: habis dulu, lalu yang paling dekat minimum
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
              const saran = low ? Math.max(Math.ceil(i.min_stock * 2 - i.stock), 1) : 0
              return (
                <tr key={i.id}>
                  <td className="font-bold">{i.name}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">
                    {fmtQty(i.stock)} {i.buy_unit}
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

function PurchaseForm({
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
  const raws = useMemo(() => catalog.ingredients.filter((i) => i.kind === 'raw' && i.active), [catalog])
  const [lines, setLines] = useState<{ ingredient_id: number; packs: string; unit_cost: string }[]>([{ ingredient_id: raws[0]?.id ?? 0, packs: '', unit_cost: '' }])
  const [note, setNote] = useState('')
  const ingById = useMemo(() => ingIndex(catalog.ingredients), [catalog])

  const total = lines.reduce((s, l) => s + parseNum(l.packs) * (parseInt(l.unit_cost, 10) || 0), 0)

  // draft dari Insight Belanja (halaman Bahan): isi baris bahan + qty + harga terakhir
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('sabana-purchase-draft')
      if (!raw) return
      const draft = JSON.parse(raw) as { ingredient_id: number; packs: number }[]
      if (Array.isArray(draft) && draft.length > 0) {
        setLines(
          draft.map((d) => {
            const ing = catalog.ingredients.find((i) => i.id === d.ingredient_id)
            return {
              ingredient_id: d.ingredient_id,
              packs: String(d.packs),
              unit_cost: ing ? String(Math.round(ing.price * (ing.pack_content || 1))) : ''
            }
          })
        )
      }
      sessionStorage.removeItem('sabana-purchase-draft')
    } catch {
      // draft rusak: abaikan
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="card strip h-fit p-4">
      <p className="mb-1 text-sm font-extrabold">Form pembelian</p>
      <p className="mb-3 text-sm text-brand-muted">
        Catat pembelian bahan dari supplier. Stok masuk otomatis, dan harga terakhir menjadi harga bahan baru (HPP ikut terhitung ulang).
      </p>
      {lines.map((l, i) => {
        const ing = ingById.get(l.ingredient_id)
        return (
          <div key={i} className="mb-2 grid grid-cols-[1fr_90px_110px_28px] gap-2">
            <select
              className="input !h-10"
              value={l.ingredient_id}
              onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, ingredient_id: parseInt(e.target.value, 10) } : x)))}
              aria-label="Bahan"
            >
              {raws.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <input
              className="input !h-10 text-right"
              placeholder={`${ing ? ing.buy_unit : ''}`}
              inputMode="decimal"
              value={l.packs}
              onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, packs: e.target.value } : x)))}
              aria-label="Jumlah kemasan"
            />
            <input
              className="input !h-10 text-right"
              placeholder="Harga/unit"
              inputMode="numeric"
              value={l.unit_cost}
              onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unit_cost: e.target.value.replace(/\D/g, '') } : x)))}
              aria-label="Harga per satuan beli"
            />
            <button type="button" className="font-extrabold text-brand-redtext" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Hapus baris">
              ✕
            </button>
          </div>
        )
      })}
      <button type="button" className="btn-ghost !min-h-0 !py-1.5 text-xs" onClick={() => setLines((ls) => [...ls, { ingredient_id: raws[0]?.id ?? 0, packs: '', unit_cost: '' }])}>
        + Baris
      </button>
      <div className="mt-3">
        <label className="lbl" htmlFor="pnote">
          Catatan (supplier, no. nota)
        </label>
        <input id="pnote" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <p className="mt-2 text-lg font-extrabold">Total belanja: Rp{total.toLocaleString('id-ID')}</p>
      <button
        type="button"
        className="btn-primary mt-2"
        disabled={total <= 0}
        onClick={async () => {
          try {
            await createPurchase(
              lines.filter((l) => parseNum(l.packs) > 0).map((l) => ({ ingredient_id: l.ingredient_id, packs: parseNum(l.packs), unit_cost: parseInt(l.unit_cost, 10) || 0 })),
              note
            )
            setLines([{ ingredient_id: raws[0]?.id ?? 0, packs: '', unit_cost: '' }])
            setNote('')
            await reload()
            toast('Pembelian tercatat, stok & harga bahan diperbarui.')
          } catch (ex) {
            setErr((ex as Error).message)
          }
        }}
      >
        Simpan Pembelian
      </button>
    </div>
  )
}

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
  const ing = catalog.ingredients.find((i) => i.id === ingId)
  return (
    <div className="card strip h-fit max-w-xl p-4">
      <p className="mb-1 text-sm font-extrabold">Stok opname</p>
      <p className="mb-3 text-sm text-brand-muted">Samakan stok sistem dengan hitungan fisik (stok opname).</p>
      <div className="mb-2">
        <label className="lbl" htmlFor="oing">
          Bahan
        </label>
        <select id="oing" className="input" value={ingId} onChange={(e) => setIngId(parseInt(e.target.value, 10))}>
          {catalog.ingredients.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} (sistem: {fmtQty(i.stock)} {i.buy_unit})
            </option>
          ))}
        </select>
      </div>
      <div className="mb-3">
        <label className="lbl" htmlFor="oqty">
          Hasil hitung fisik ({ing?.buy_unit ?? ''})
        </label>
        <input id="oqty" className="input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.,]/g, ''))} />
      </div>
      <button
        type="button"
        className="btn-primary"
        onClick={async () => {
          try {
            await opname(ingId, parseNum(qty))
            setQty('')
            await reload()
            toast('Stok disesuaikan.')
          } catch (ex) {
            setErr((ex as Error).message)
          }
        }}
      >
        Sesuaikan Stok
      </button>
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
    <div className="card strip h-fit max-w-xl p-4">
      <p className="mb-1 text-sm font-extrabold">Waste / hangus</p>
      <p className="mb-3 text-sm text-brand-muted">
        Bahan terbuang/hangus dikurangi dari stok, jadi margin riil di laporan tetap jujur.
      </p>
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
          Jumlah ({mode === 'bahan' ? catalog.ingredients.find((i) => i.id === ingId)?.buy_unit : 'porsi'})
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
            const q = parseNum(qty)
            if (q <= 0) return
            await logWaste(mode === 'bahan' ? [{ ingredient_id: ingId, qty: q }] : [{ product_id: prodId, qty: q }], note || 'waste')
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
