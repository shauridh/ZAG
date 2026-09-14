import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { loadCatalog, loadFryers, createBatch, fillFryer, endOilCycle, saveFryer, type Catalog } from '../lib/db'
import { ingIndex, ingredientNeeds } from '../lib/hpp'
import { fmtRp, fmtQty, parseNum } from '../lib/money'
import type { Fryer, Ingredient, OilCycle, Settings } from '../lib/types'
import { loadSettings } from '../lib/db'
import { Modal } from '../components/Modal'
import { ErrorSummary } from '../components/ErrorSummary'
import { useToast } from '../components/Toast'
import { fmtDateTime } from '../lib/dates'

export default function Production(): ReactElement {
  const { toast } = useToast()
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [fryers, setFryers] = useState<Fryer[]>([])
  const [cycles, setCycles] = useState<OilCycle[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [err, setErr] = useState('')

  const reload = useCallback(async () => {
    try {
      const [c, f, s] = await Promise.all([loadCatalog(), loadFryers(), loadSettings()])
      setCatalog(c)
      setFryers(f.fryers)
      setCycles(f.cycles)
      setSettings(s)
    } catch (ex) {
      setErr((ex as Error).message)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  if (!catalog || !settings) return <div className="p-6 text-sm font-bold text-brand-muted">Memuat...</div>

  const ingById = ingIndex(catalog.ingredients)
  const prepared = catalog.ingredients.filter((i) => i.kind === 'prepared' && i.active)
  // Output produksi fleksibel: bahan SETENGAH JADI maupun MENTAH yang aktif —
  // mis. pisah/ayam dipotong jadi "potongan siap goreng" (mentah, tanpa resep → stok langsung +).
  const outPool = catalog.ingredients.filter((i) => i.active)
  // Banner siklus minyak: keputusan rasa & biaya, jadi tampil di atas — bukan catatan sekunder
  const bannerCycle = cycles.find((c) => c.status === 'aktif')
  const bannerDays = bannerCycle ? Math.floor((Date.now() - new Date(bannerCycle.started_at).getTime()) / 86400000) : 0
  const bannerWarn = bannerCycle ? (bannerDays >= settings.oil.max_days || bannerCycle.fry_count >= settings.oil.max_fry_count) : false
  const bannerPct = bannerCycle ? Math.min(100, Math.round((bannerCycle.fry_count / Math.max(1, settings.oil.max_fry_count)) * 100)) : 0

  return (
    <div className="p-3 lg:p-4">
      <h1 className="mb-3 text-xl font-extrabold">Produksi & Fryer</h1>
      {err && <ErrorSummary err={err} label="Batch produksi gagal" />}
      {bannerCycle && (
        <div className={`card strip mb-3 flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center ${bannerWarn ? 'bg-brand-gold/15' : ''}`}>
          <div className="text-2xl">🍟</div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-extrabold">
              {fryers.find((f) => f.id === bannerCycle.fryer_id)?.name ?? 'Fryer'} — minyak hari ke-{bannerDays} dari {settings.oil.max_days}
            </p>
            <p className="text-xs text-brand-muted">
              {bannerCycle.fry_count}/{settings.oil.max_fry_count} gorengan · {fmtQty(bannerCycle.oil_liters)} L minyak terpakai
            </p>
            <div className="mt-1.5 h-2 overflow-hidden rounded border border-brand-line bg-brand-paper">
              <div className={`h-full ${bannerWarn ? 'bg-brand-redtext' : 'bg-brand-gold'}`} style={{ width: `${Math.max(bannerPct, 2)}%` }} />
            </div>
          </div>
          {bannerWarn && <span className="chip bg-brand-gold">Ambang terlampaui — segera ganti</span>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <BatchForm catalog={catalog} outPool={outPool} fryers={fryers} onDone={reload} setErr={setErr} toast={toast} />
        <FryerPanel
          fryers={fryers}
          cycles={cycles}
          oils={catalog.ingredients.filter((i) => i.name.toLowerCase().includes('minyak') && i.kind === 'raw')}
          settings={settings}
          ingById={ingById}
          onDone={reload}
          setErr={setErr}
          toast={toast}
        />
      </div>

      {/* Stok siap jual ringkas */}
      <div className="card mt-4 p-3">
        <h2 className="mb-2 font-extrabold">Stok Siap Jual (setengah jadi)</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {prepared.map((p) => (
            <div key={p.id} className="rounded-lg border border-brand-line p-2">
              <p className="text-xs font-bold text-brand-muted">{p.name}</p>
              <p className="text-lg font-extrabold tabular-nums">
                {fmtQty(p.stock)} <span className="text-xs font-bold text-brand-muted">{p.buy_unit}</span>
              </p>
              {p.stock <= p.min_stock && <span className="chip bg-brand-gold text-[10px]">segera produksi</span>}
            </div>
          ))}
          {prepared.length === 0 && <p className="col-span-full text-sm text-brand-muted">Belum ada bahan setengah jadi. Buat di halaman Bahan & HPP.</p>}
        </div>
      </div>
    </div>
  )
}

function BatchForm({
  catalog,
  outPool,
  fryers,
  onDone,
  setErr,
  toast
}: {
  catalog: Catalog
  outPool: Ingredient[]
  fryers: Fryer[]
  onDone: () => Promise<void>
  setErr: (s: string) => void
  toast: (s: string) => void
}): ReactElement {
  const [outputs, setOutputs] = useState<{ ingredient_id: number; qty: number }[]>(outPool.length ? [{ ingredient_id: outPool[0].id, qty: 9 }] : [])
  const [fryerId, setFryerId] = useState<number | ''>('')
  const [grams, setGrams] = useState('')
  const ingById = useMemo(() => ingIndex(catalog.ingredients), [catalog])

  const needs = useMemo(() => {
    const total = new Map<number, number>()
    for (const o of outputs)
      for (const [iid, need] of ingredientNeeds(o.ingredient_id, o.qty, catalog.ingRecipes)) total.set(iid, (total.get(iid) ?? 0) + need)
    return total
  }, [outputs, catalog.ingRecipes])

  // Batas aman output dari STOK BAHAN MENTAH (resep bahan, bukan resep produk):
  // output tanpa resep = langsung (tanpa konsumsi) → 999 (tidak dibatasi).
  const maxOut = (id: number): number => {
    const needs = ingredientNeeds(id, 1, catalog.ingRecipes)
    let max = Infinity
    for (const [iid, q] of needs) {
      const ing = ingById.get(iid)
      if (!ing) continue
      max = Math.min(max, Math.floor((ing.stock / q) * 1000) / 1000)
    }
    return max === Infinity ? 999 : Math.max(0, Math.floor(max))
  }

  return (
    <div className="card strip p-4">
      <h2 className="mb-1 font-extrabold">Batch Produksi Baru</h2>
      <p className="mb-3 text-xs text-brand-muted">Bahan mentah berkurang otomatis sesuai resep produksi, stok siap jual bertambah.</p>
      {outputs.map((o, i) => {
        const prep = outPool.find((p) => p.id === o.ingredient_id)
        return (
          <div key={i} className="mb-2 grid grid-cols-[1fr_88px_28px] gap-2">
            <select
              className="input !h-10"
              value={o.ingredient_id}
              onChange={(e) => setOutputs((os) => os.map((x, j) => (j === i ? { ...x, ingredient_id: parseInt(e.target.value, 10) } : x)))}
              aria-label="Output produksi"
            >
              {outPool.length === 0 && <option value={o.ingredient_id}>— tidak ada bahan aktif —</option>}
              {outPool.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.kind === 'raw' ? ' (mentah)' : ''}
                </option>
              ))}
            </select>
            <input
              className="input !h-10 text-right"
              inputMode="decimal"
              value={String(o.qty)}
              onChange={(e) => setOutputs((os) => os.map((x, j) => (j === i ? { ...x, qty: parseNum(e.target.value) } : x)))}
              aria-label="Jumlah output"
            />
            <button type="button" className="font-extrabold text-brand-redtext" onClick={() => setOutputs((os) => os.filter((_, j) => j !== i))} aria-label="Hapus">
              ✕
            </button>
            {prep && o.qty > maxOut(prep.id) && (
              <p className="col-span-3 text-xs font-bold text-brand-redtext">
                Bahan mentah kemungkinan kurang untuk {fmtQty(o.qty)} {prep.buy_unit} (batas aman ±{fmtQty(maxOut(prep.id))}).
              </p>
            )}
          </div>
        )
      })}
      <button type="button" className="btn-ghost !min-h-0 !py-1.5 text-xs" onClick={() => outPool.length && setOutputs((os) => [...os, { ingredient_id: outPool[0].id, qty: 1 }])}>
        + Output
      </button>
      <p className="mt-1 text-xs text-brand-muted">
        Dropdown memuat semua bahan aktif. <b>(mentah)</b> = bahan beli langsung jadi output (pemotongan/persiapan) — stoknya bertambah tanpa resep.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <label className="lbl" htmlFor="fry">
            Digoreng di fryer (opsional)
          </label>
          <select id="fry" className="input" value={fryerId} onChange={(e) => setFryerId(e.target.value ? parseInt(e.target.value, 10) : '')}>
            <option value="">Tanpa fryer</option>
            {fryers.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="lbl" htmlFor="gr">
            Berat digoreng (gram)
          </label>
          <input id="gr" className="input" inputMode="numeric" value={grams} onChange={(e) => setGrams(e.target.value.replace(/\D/g, ''))} placeholder="0" />
        </div>
      </div>

      <div className="mt-3 rounded-lg bg-brand-paper p-3">
        <p className="text-xs font-bold text-brand-muted">Bahan mentah terpakai:</p>
        <ul className="text-sm font-bold">
          {[...needs.entries()].map(([iid, need]) => {
            const ing = ingById.get(iid)
            if (!ing) return null
            const short = ing.stock < need
            return (
              <li key={iid} className={short ? 'text-brand-redtext' : ''}>
                {ing.name}: {fmtQty(need)} {short ? `(stok ${fmtQty(ing.stock)}!)` : ''}
              </li>
            )
          })}
          {needs.size === 0 && (
            <li className="font-normal text-brand-muted">
              {outputs.length ? 'output langsung — tidak ada bahan mentah terpotong' : 'pilih output dulu'}
            </li>
          )}
        </ul>
      </div>

      <button
        type="button"
        className="btn-primary mt-3 w-full"
        disabled={outputs.filter((o) => o.qty > 0 && outPool.some((p) => p.id === o.ingredient_id)).length === 0}
        onClick={async () => {
          try {
            await createBatch({
              outputs: outputs.filter((o) => o.qty > 0 && outPool.some((p) => p.id === o.ingredient_id)),
              fryer_id: fryerId === '' ? null : fryerId,
              fried_grams: parseInt(grams, 10) || 0,
              note: ''
            })
            toast('Batch produksi tersimpan, stok diperbarui.')
            await onDone()
          } catch (ex) {
            setErr((ex as Error).message)
          }
        }}
      >
        Simpan Batch
      </button>
    </div>
  )
}

function FryerPanel({
  fryers,
  cycles,
  oils,
  settings,
  ingById,
  onDone,
  setErr,
  toast
}: {
  fryers: Fryer[]
  cycles: OilCycle[]
  oils: Ingredient[]
  settings: Settings
  ingById: Map<number, Ingredient>
  onDone: () => Promise<void>
  setErr: (s: string) => void
  toast: (s: string) => void
}): ReactElement {
  const [fillOpen, setFillOpen] = useState<Fryer | null>(null)
  const [endOpen, setEndOpen] = useState<OilCycle | null>(null)
  const [newFryer, setNewFryer] = useState('')

  const activeCycle = (fryerId: number): OilCycle | undefined => cycles.find((c) => c.fryer_id === fryerId && c.status === 'aktif')
  const daysOf = (c: OilCycle): number => Math.floor((Date.now() - new Date(c.started_at).getTime()) / 86400000)
  const oilExceeded = (c: OilCycle): boolean =>
    daysOf(c) >= settings.oil.max_days || c.fry_count >= settings.oil.max_fry_count

  return (
    <div className="card strip p-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="mr-auto font-extrabold">Siklus Minyak Fryer</h2>
        <input className="input !h-9 !w-36 text-sm" placeholder="Fryer baru..." value={newFryer} onChange={(e) => setNewFryer(e.target.value)} aria-label="Nama fryer baru" />
        <button
          type="button"
          className="btn-ghost !min-h-0 !py-1.5 text-xs"
          onClick={async () => {
            if (!newFryer.trim()) return
            try {
              await saveFryer({ name: newFryer.trim(), capacity_l: null })
              setNewFryer('')
              await onDone()
            } catch (ex) {
              setErr((ex as Error).message)
            }
          }}
        >
          Tambah
        </button>
      </div>
      {fryers.length === 0 && <p className="text-sm text-brand-muted">Belum ada fryer. Tambahkan dulu.</p>}
      <div className="flex flex-col gap-3">
        {fryers.map((f) => {
          const c = activeCycle(f.id)
          const oil = c?.oil_ingredient_id ? ingById.get(c.oil_ingredient_id) : undefined
          const warn = c ? oilExceeded(c) : false
          return (
            <div key={f.id} className={`rounded-lg border-[1.5px] p-3 ${warn ? 'border-brand-gold bg-brand-gold/10' : 'border-brand-line'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <p className="mr-auto font-extrabold">{f.name}</p>
                {c ? (
                  <>
                    <span className={`chip ${warn ? 'bg-brand-gold' : 'bg-brand-gold/30'}`}>
                      Minyak hari ke-{daysOf(c)} · {c.fry_count}x goreng
                    </span>
                    <button type="button" className="btn-gold !min-h-0 !py-1.5 text-xs" onClick={() => setEndOpen(c)}>
                      Ganti / Tutup Minyak
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn-primary !min-h-0 !py-1.5 text-xs" onClick={() => setFillOpen(f)}>
                    Isi Minyak Baru
                  </button>
                )}
              </div>
              {c && (
                <p className="mt-1 text-xs text-brand-muted">
                  Diisi {fmtQty(c.oil_liters)} L {oil ? oil.name : ''} ({fmtRp(c.oil_cost)}) · {fmtQty(c.fried_grams)} gr digoreng
                  {warn && ' · AMBANG TERLAMPAUI, segera ganti minyak'}
                </p>
              )}
            </div>
          )
        })}
      </div>

      <h3 className="mt-4 mb-1 text-sm font-extrabold">Riwayat siklus terakhir</h3>
      <ul className="text-xs text-brand-muted">
        {cycles
          .filter((c) => c.status === 'selesai')
          .slice(0, 6)
          .map((c) => (
            <li key={c.id}>
              Siklus #{c.id} · fryer {fryers.find((f) => f.id === c.fryer_id)?.name ?? c.fryer_id} · {fmtDateTime(c.started_at)} s.d. {fmtDateTime(c.ended_at ?? '')} · {c.fry_count}x goreng · buang {fmtQty(c.disposed_liters ?? 0)} L · jelantah {fmtRp(c.jelantah_income)}
            </li>
          ))}
        {cycles.filter((c) => c.status === 'selesai').length === 0 && <li>belum ada</li>}
      </ul>

      {/* Modal isi minyak */}
      <Modal open={fillOpen !== null} title={`Isi Minyak: ${fillOpen?.name ?? ''}`} onClose={() => setFillOpen(null)}>
        {fillOpen && (
          <FillForm
            oils={oils}
            onSubmit={async (oilId, liters) => {
              try {
                await fillFryer(fillOpen.id, oilId, liters)
                setFillOpen(null)
                toast('Siklus minyak dimulai.')
                await onDone()
              } catch (ex) {
                setErr((ex as Error).message)
              }
            }}
          />
        )}
      </Modal>

      {/* Modal tutup siklus */}
      <Modal open={endOpen !== null} title="Ganti / Tutup Minyak" onClose={() => setEndOpen(null)}>
        {endOpen && (
          <EndForm
            onSubmit={async (liters, income) => {
              try {
                await endOilCycle(endOpen.id, liters, income)
                setEndOpen(null)
                toast('Siklus minyak ditutup. Pemasukan jelantah tercatat di Keuangan.')
                await onDone()
              } catch (ex) {
                setErr((ex as Error).message)
              }
            }}
          />
        )}
      </Modal>
    </div>
  )
}

function FillForm({ oils, onSubmit }: { oils: Ingredient[]; onSubmit: (oilId: number, liters: number) => Promise<void> }): ReactElement {
  const [oilId, setOilId] = useState(oils[0]?.id ?? 0)
  const [liters, setLiters] = useState('8')
  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="lbl" htmlFor="ooil">
          Jenis minyak
        </label>
        <select id="ooil" className="input" value={oilId} onChange={(e) => setOilId(parseInt(e.target.value, 10))}>
          {oils.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} (stok {fmtQty(o.stock)} {o.buy_unit})
            </option>
          ))}
        </select>
        {oils.length === 0 && <p className="mt-1 text-xs font-bold text-brand-redtext">Belum ada bahan minyak. Tambahkan di Bahan & HPP.</p>}
      </div>
      <div>
        <label className="lbl" htmlFor="oliters">
          Liter diisi
        </label>
        <input id="oliters" className="input" inputMode="decimal" value={liters} onChange={(e) => setLiters(e.target.value.replace(/[^\d.,]/g, ''))} />
      </div>
      <button type="button" className="btn-primary" disabled={oils.length === 0} onClick={() => void onSubmit(oilId, parseNum(liters))}>
        Mulai Siklus
      </button>
    </div>
  )
}

function EndForm({ onSubmit }: { onSubmit: (liters: number, income: number) => Promise<void> }): ReactElement {
  const [liters, setLiters] = useState('')
  const [income, setIncome] = useState('')
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-brand-muted">Catat pembuangan minyak bekas dan pemasukan penjualan jelantah (jika dijual).</p>
      <div>
        <label className="lbl" htmlFor="dl">
          Liter dibuang
        </label>
        <input id="dl" className="input" inputMode="decimal" value={liters} onChange={(e) => setLiters(e.target.value.replace(/[^\d.,]/g, ''))} />
      </div>
      <div>
        <label className="lbl" htmlFor="ji">
          Pemasukan jelantah (Rp)
        </label>
        <input id="ji" className="input text-right" inputMode="numeric" value={income} onChange={(e) => setIncome(e.target.value.replace(/\D/g, ''))} placeholder="0" />
      </div>
      <button type="button" className="btn-primary" onClick={() => void onSubmit(parseNum(liters), parseInt(income, 10) || 0)}>
        Tutup Siklus
      </button>
    </div>
  )
}
