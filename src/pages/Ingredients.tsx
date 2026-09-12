import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadCatalog, loadTransactions, upsertIngredient, saveIngredientRecipe, type Catalog } from '../lib/db'
import { ingIndex, preparedCost } from '../lib/hpp'
import { buyPlanFromSales, buyPlanToText, dailySalesOf, type BuyPlan } from '../lib/forecast'
import { fmtRp, fmtRpPlain, fmtQty, parseNum } from '../lib/money'
import type { Ingredient, IngredientRecipe } from '../lib/types'
import { Modal } from '../components/Modal'
import { useToast } from '../components/Toast'

export default function Ingredients(): ReactElement {
  const { toast } = useToast()
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState<Partial<Ingredient> | null>(null)
  const [recipeFor, setRecipeFor] = useState<Ingredient | null>(null)
  const [q, setQ] = useState('')
  const [dirty, setDirty] = useState<Record<number, number>>({})

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

  const list = catalog.ingredients.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()))
  const dirtyCount = Object.keys(dirty).length
  // ringkasan atas: nilai stok (stok × harga beli) & jumlah bahan di bawah minimum
  const stockValue = catalog.ingredients.filter((i) => i.kind === 'raw').reduce((s, i) => s + i.stock * i.price, 0)
  const lowCount = catalog.ingredients.filter((i) => i.active && i.stock <= i.min_stock).length

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

  return (
    <div className="p-3 lg:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-extrabold">Bahan & HPP</h1>
        <input className="input max-w-52" placeholder="Cari bahan..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari bahan" />
        <button type="button" className="btn-primary" onClick={() => setEditing({ kind: 'raw', buy_unit: 'pack', pack_content: 1, price: 0, min_stock: 0, active: true })}>
          + Bahan Baru
        </button>
      </div>
      {err && (
        <p className="mb-2 rounded-lg bg-brand-redtext/10 px-3 py-2 text-sm font-bold text-brand-redtext" role="alert">
          {err}
        </p>
      )}

      {/* Bar ringkasan: keputusan belanja dibaca dari sini, bukan dari tiap baris */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="chip h-9 border-[1.5px] border-brand-line bg-brand-card px-3">Nilai stok {fmtRp(stockValue)}</span>
        {lowCount > 0 && (
          <span className="chip h-9 bg-brand-gold px-3">{lowCount} bahan di bawah minimum</span>
        )}
      </div>

      <BuyInsight catalog={catalog} setErr={setErr} />

      <div className="card overflow-x-auto">
        <table className="tbl min-w-[640px]">
          <thead>
            <tr>
              <th>Bahan</th>
              <th>Jenis</th>
              <th className="whitespace-nowrap text-right">Stok</th>
              <th className="text-right">Min</th>
              <th className="whitespace-nowrap">Satuan beli</th>
              <th className="whitespace-nowrap text-right">Harga beli</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((i) => {
              const low = i.stock <= i.min_stock
              const kritis = i.stock <= 0
              return (
                <tr key={i.id}>
                  <td className="font-bold">
                    {i.name}
                    {i.kind === 'prepared' && <span className="chip ml-1 border-[1.5px] border-brand-line bg-brand-paper">prepared</span>}
                  </td>
                  <td>{i.kind === 'prepared' ? 'Setengah jadi' : 'Mentah'}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">
                    {fmtQty(i.stock)} {i.kind === 'prepared' ? i.buy_unit : ''}
                  </td>
                  <td className="text-right tabular-nums">{fmtQty(i.min_stock)}</td>
                  <td className="whitespace-nowrap text-xs">
                    {i.buy_unit}
                    {i.pack_content !== 1 ? ` (isi ${fmtQty(i.pack_content)})` : ''}
                  </td>
                  <td className="text-right">
                    {i.kind === 'prepared' ? (
                      <span className="text-xs text-brand-muted">{fmtRp(preparedCost(i.id, catalog.ingRecipes, ingById))}/unit</span>
                    ) : (
                      <input
                        className="input !h-9 !w-28 text-right"
                        inputMode="numeric"
                        value={dirty[i.id] !== undefined ? fmtRpPlain(dirty[i.id]) : i.price ? fmtRpPlain(i.price) : ''}
                        onChange={(e) => setDirty({ ...dirty, [i.id]: parseInt(e.target.value.replace(/\D/g, ''), 10) || 0 })}
                        aria-label={`Harga ${i.name}`}
                      />
                    )}
                  </td>
                  <td>
                    <span className={`chip ${kritis ? 'bg-brand-redtext text-white' : low ? 'bg-brand-gold' : 'bg-brand-gold/30'}`}>
                      {kritis ? 'kritis' : low ? 'menipis' : 'aman'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap">
                    {i.kind === 'prepared' && (
                      <button type="button" className="btn-ghost !min-h-0 !px-2 !py-1 text-xs" onClick={() => setRecipeFor(i)}>
                        Resep
                      </button>
                    )}{' '}
                    <button type="button" className="btn-ghost !min-h-0 !px-2 !py-1 text-xs" onClick={() => setEditing(i)}>
                      Edit
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
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

      {/* Modal bahan */}
      <Modal open={editing !== null} title={editing?.id ? 'Edit Bahan' : 'Bahan Baru'} onClose={() => setEditing(null)}>
        {editing && (
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault()
              try {
                await upsertIngredient({
                  id: editing.id,
                  name: editing.name ?? '',
                  code: editing.code ?? '',
                  kind: editing.kind ?? 'raw',
                  buy_unit: editing.buy_unit ?? 'pack',
                  pack_content: editing.pack_content ?? 1,
                  price: editing.price ?? 0,
                  min_stock: editing.min_stock ?? 0,
                  active: editing.active ?? true
                })
                setEditing(null)
                await reload()
                toast('Bahan tersimpan.')
              } catch (ex) {
                setErr((ex as Error).message)
              }
            }}
          >
            <div>
              <label className="lbl" htmlFor="iname">
                Nama bahan
              </label>
              <input id="iname" className="input" value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required />
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
                <label className="lbl" htmlFor="iunit">
                  Satuan beli
                </label>
                <input id="iunit" className="input" value={editing.buy_unit ?? ''} onChange={(e) => setEditing({ ...editing, buy_unit: e.target.value })} placeholder="pack / kg / ekor" required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="lbl" htmlFor="icontent">
                  Isi kemasan
                </label>
                <input
                  id="icontent"
                  className="input text-right"
                  inputMode="decimal"
                  value={String(editing.pack_content ?? 1)}
                  onChange={(e) => setEditing({ ...editing, pack_content: parseNum(e.target.value) || 1 })}
                />
              </div>
              <div>
                <label className="lbl" htmlFor="iprice">
                  Harga beli per {editing.buy_unit || 'satuan'} (Rp)
                </label>
                <input
                  id="iprice"
                  className="input text-right"
                  inputMode="numeric"
                  value={editing.price ? fmtRpPlain(editing.price) : ''}
                  onChange={(e) => setEditing({ ...editing, price: parseInt(e.target.value.replace(/\D/g, ''), 10) || 0 })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="lbl" htmlFor="imin">
                  Stok minimum
                </label>
                <input
                  id="imin"
                  className="input text-right"
                  inputMode="decimal"
                  value={String(editing.min_stock ?? 0)}
                  onChange={(e) => setEditing({ ...editing, min_stock: parseNum(e.target.value) })}
                />
              </div>
              <div>
                <label className="lbl" htmlFor="icode">
                  Kode supplier
                </label>
                <input id="icode" className="input" value={editing.code ?? ''} onChange={(e) => setEditing({ ...editing, code: e.target.value })} />
              </div>
            </div>
            <button type="submit" className="btn-primary">
              Simpan Bahan
            </button>
          </form>
        )}
      </Modal>

      {/* Modal resep produksi */}
      <Modal open={recipeFor !== null} title={`Resep Produksi: ${recipeFor?.name ?? ''}`} onClose={() => setRecipeFor(null)} wide>
        {recipeFor && <IngRecipeEditor catalog={catalog} ingredient={recipeFor} onDone={() => { setRecipeFor(null); void reload() }} setErr={setErr} />}
      </Modal>
    </div>
  )
}

/**
 * Insight belanja bahan baku: dari rata-rata penjualan harian (N hari terakhir)
 * diproyeksikan kebutuhan X hari ke depan, dikurangi stok sekarang → belanja berapa.
 */
function BuyInsight({ catalog, setErr }: { catalog: Catalog; setErr: (s: string) => void }): ReactElement {
  const [plan, setPlan] = useState<BuyPlan | null>(null)
  const [days, setDays] = useState(7)
  const [historyDays, setHistoryDays] = useState(14)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

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

  // hitung otomatis saat halaman dibuka & saat parameter berubah
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

  const draftPurchase = (): void => {
    if (!plan || plan.items.length === 0) return
    const draft = plan.items.map((i) => ({ ingredient_id: i.ingredientId, packs: i.buyQty }))
    sessionStorage.setItem('sabana-purchase-draft', JSON.stringify(draft))
    navigate('/stok?tab=pembelian')
  }

  return (
    <div className="card strip mb-3 max-w-3xl p-4">
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
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="btn-primary" onClick={draftPurchase} disabled={plan.items.length === 0}>
                  Isi Form Pembelian
                </button>
                <button type="button" className="btn-ghost" onClick={() => void share()}>
                  Bagikan Daftar Belanja
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

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
        Bahan mentah yang terpakai untuk menghasilkan 1 {ingredient.buy_unit} {ingredient.name}. Dipakai saat batch produksi.
      </p>
      {lines.map((l, i) => (
        <div key={i} className="mb-2 grid grid-cols-[1fr_84px_32px] items-center gap-2">
          <select className="input !h-10" value={l.component_id} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, component_id: parseInt(e.target.value, 10) } : x)))} aria-label="Bahan mentah">
            {raws.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({fmtRp(o.price)}/{o.buy_unit})
              </option>
            ))}
          </select>
          <input
            className="input !h-10 text-right"
            value={String(l.qty)}
            inputMode="decimal"
            onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: parseNum(e.target.value) } : x)))}
            aria-label="Qty per unit"
          />
          <button type="button" className="text-lg font-extrabold text-brand-redtext" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Hapus">
            ✕
          </button>
        </div>
      ))}
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
