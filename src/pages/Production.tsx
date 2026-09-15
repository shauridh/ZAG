import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { loadCatalog, loadFryers, loadBatches, createBatch, fillFryer, endOilCycle, saveFryer, saveSetting, createStockAdjustment, type Catalog } from '../lib/db'
import type { BatchHistoryItem } from '../lib/types'
import { ingIndex, ingredientNeeds, smallUnitOf } from '../lib/hpp'
import { fmtRp, fmtQty, parseNum } from '../lib/money'
import type { Fryer, Ingredient, OilCycle, Settings } from '../lib/types'
import { loadSettings } from '../lib/db'
import { Modal } from '../components/Modal'
import { ErrorSummary } from '../components/ErrorSummary'
import { useToast } from '../components/Toast'
import { fmtDateTime } from '../lib/dates'
import { breakdownMismatch, fromSmallQty, originQtyLabel, toSmallQty, type UnitMode } from '../lib/units'

export default function Production(): ReactElement {
  const { toast } = useToast()
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [fryers, setFryers] = useState<Fryer[]>([])
  const [cycles, setCycles] = useState<OilCycle[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [batches, setBatches] = useState<BatchHistoryItem[]>([])
  const [adjust, setAdjust] = useState<{ ing: Ingredient; qty: string; note?: string } | null>(null)
  const [err, setErr] = useState('')

  const reload = useCallback(async () => {
    try {
      const [c, f, s, b] = await Promise.all([loadCatalog(), loadFryers(), loadSettings(), loadBatches(10)])
      setCatalog(c)
      setFryers(f.fryers)
      setCycles(f.cycles)
      setSettings(s)
      setBatches(b)
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

      <QuickProduce templates={settings.batch_templates ?? []} catalog={catalog} outPool={outPool} fryers={fryers} settings={settings} onDone={reload} setErr={setErr} setSettings={setSettings} toast={toast} />


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

      {/* Riwayat batch: audit dapur — apa yang diproduksi & satuan asal inputnya */}
      <BatchHistory batches={batches} catalog={catalog} />

      {/* Stok siap jual ringkas + penyesuaian manual (opname) */}
      <div className="card mt-4 p-3">
        <h2 className="mb-2 font-extrabold">Stok Siap Jual (setengah jadi)</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {prepared.map((p) => (
            <div key={p.id} className="rounded-lg border border-brand-line p-2">
              <div className="flex items-start justify-between gap-1">
                <p className="min-w-0 text-xs font-bold text-brand-muted">{p.name}</p>
                <button
                  type="button"
                  className="icon-btn !h-7 !w-7 shrink-0 text-xs"
                  title="Sesuaikan stok (opname)"
                  aria-label={`Sesuaikan stok ${p.name}`}
                  onClick={() => { setAdjust({ ing: p, qty: String(p.stock) }) }}
                >
                  ✏️
                </button>
              </div>
              <p className="text-lg font-extrabold tabular-nums">
                {fmtQty(p.stock)} <span className="text-xs font-bold text-brand-muted">{p.buy_unit}</span>
              </p>
              {p.stock <= 0 ? (
                <span className="chip bg-brand-redtext text-[10px] text-white">habis</span>
              ) : p.stock <= p.min_stock ? (
                <span className="chip bg-brand-gold text-[10px]">menipis — segera produksi</span>
              ) : (
                <span className="chip bg-[#22aa55] text-[10px] text-white">aman</span>
              )}
            </div>
          ))}
          {prepared.length === 0 && <p className="col-span-full text-sm text-brand-muted">Belum ada bahan setengah jadi. Buat di halaman Bahan & HPP.</p>}
        </div>
      </div>

      {/* Modal penyesuaian stok siap jual — tercatat sebagai penyesuaian CRUD (bisa edit/hapus di Bahan) */}
      <Modal open={adjust !== null} title="Sesuaikan Stok Siap Jual" onClose={() => setAdjust(null)}>
        {adjust && (
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault()
              try {
                await createStockAdjustment(adjust.ing.id, parseNum(adjust.qty), adjust.note ?? '')
                setAdjust(null)
                toast(`Stok ${adjust.ing.name} disesuaikan — tercatat di riwayat penyesuaian.`)
                await reload()
              } catch (ex) {
                setErr((ex as Error).message)
              }
            }}
          >
            <p className="text-sm text-brand-muted">
              Stok fisik <b>{adjust.ing.name}</b> berbeda dengan catatan? Masukkan jumlah yang benar —
              tercatat sebagai penyesuaian yang bisa diedit/dihapus di halaman Bahan & HPP.
            </p>
            <div>
              <label className="lbl" htmlFor="adjqty">Stok sekarang ({adjust.ing.buy_unit})</label>
              <input
                id="adjqty"
                className="input text-right"
                inputMode="decimal"
                value={adjust.qty}
                onChange={(e) => setAdjust({ ...adjust, qty: e.target.value })}
                aria-label="Stok sekarang"
              />
              <p className="mt-1 text-xs text-brand-muted">Catatan sistem: {fmtQty(adjust.ing.stock)} {adjust.ing.buy_unit}</p>
            </div>
            <div>
              <label className="lbl" htmlFor="adjnote">Catatan (opsional)</label>
              <input
                id="adjnote"
                className="input"
                value={adjust.note ?? ''}
                onChange={(e) => setAdjust({ ...adjust, note: e.target.value })}
                placeholder="cth: 2 pack pecah di rak"
                aria-label="Catatan penyesuaian"
              />
            </div>
            <button type="submit" className="btn-primary">Simpan Penyesuaian</button>
          </form>
        )}
      </Modal>
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
  // qty disimpan dalang SATUAN KECIL (satuan jual/resep) — RPC & stok memakai satuan ini.
  // Mode satuan per baris (kecil/beli) hanya cara INPUT: pilih "pack" → angka dikali isi kemasan.
  const [outputs, setOutputs] = useState<{ ingredient_id: number; qty: number }[]>(outPool.length ? [{ ingredient_id: outPool[0].id, qty: 9 }] : [])
  // mode input per baris: 'small' (satuan jual) | 'buy' (satuan beli/pack)
  const [unitMode, setUnitMode] = useState<Record<number, 'small' | 'buy'>>({})
  // teks mentah ketikan per baris (semua mode): angka diketik "9," tidak boleh
  // dibulatkan/ditekan di tengah jalan — draft dikosongkan saat blur.
  const [buyDraft, setBuyDraft] = useState<Record<number, string>>({})
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
        const mode = unitMode[i] ?? 'small'
        const smallUnit = prep ? smallUnitOf(prep) : '?'
        const buyUnit = prep?.buy_unit ?? 'pack'
        const packContent = prep?.pack_content || 1
        // tampilan: teks mentah ketikan (semua mode) atau nilai tersimpan saat tidak mengetik
        const display = buyDraft[i] ?? (mode === 'small' ? String(o.qty) : String(fromSmallQty(o.qty, 'buy', packContent)))
        const setQtySmall = (v: number): void => setOutputs((os) => os.map((x, j) => (j === i ? { ...x, qty: v } : x)))
        return (
          <div key={i} className="mb-2">
            <div className="grid grid-cols-[1fr_96px_88px_36px] gap-2">
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
                value={display}
                onChange={(e) => {
                  // draft mentah dulu (koma tetap tampil), lalu commit angka ke state
                  setBuyDraft((d) => ({ ...d, [i]: e.target.value }))
                  if (mode === 'small') {
                    setQtySmall(parseNum(e.target.value))
                  } else {
                    // satuan beli → kecil: kalikan isi kemasan (helper teruji units.ts)
                    setQtySmall(toSmallQty(parseNum(e.target.value), 'buy', packContent))
                  }
                }}
                onBlur={() => setBuyDraft((d) => ({ ...d, [i]: '' }))}
                aria-label="Jumlah output"
              />
              {/* mode satuan: kecil (jual) atau beli (kemasan) */}
              <select
                className="input !h-10 !px-1 text-xs"
                value={mode}
                onChange={(e) => {
                  const m = e.target.value as 'small' | 'buy'
                  setUnitMode((u) => ({ ...u, [i]: m }))
                  setBuyDraft((d) => ({ ...d, [i]: '' }))
                }}
                aria-label="Satuan output"
                title={`Angka dalam ${mode === 'small' ? `satuan kecil (${smallUnit}) — dipakai kasir & resep` : `satuan beli (${buyUnit}) — dikali isi ${fmtQty(packContent)} otomatis`}`}
              >
                <option value="small">{smallUnit}</option>
                {packContent > 1 && <option value="buy">{buyUnit}</option>}
              </select>
              <button type="button" className="icon-btn-danger" onClick={() => setOutputs((os) => os.filter((_, j) => j !== i))} aria-label="Hapus">
                🗑
              </button>
            </div>
            {mode === 'buy' && (
              <p className="mt-0.5 text-[11px] font-bold text-brand-muted">
                = {fmtQty(o.qty)} {smallUnit} ({fmtQty(packContent)} {smallUnit}/{buyUnit})
                {prep?.pack_breakdown?.length ? ` — ${prep.pack_breakdown.map((b) => `${fmtQty(b.qty * (o.qty / packContent))} ${b.name}`).join(' + ')}` : ''}
              </p>
            )}
            {mode === 'buy' && breakdownMismatch(prep?.pack_breakdown, packContent) !== null && (
              <p className="mt-0.5 text-[11px] font-extrabold text-brand-redtext">
                ⚠ Komposisi {prep?.name} tidak cocok: total {fmtQty(breakdownMismatch(prep?.pack_breakdown, packContent) ?? 0)} ≠ isi kemasan {fmtQty(packContent)} — perbaiki di Bahan & HPP supaya rincian potongan akurat.
              </p>
            )}
            {prep && o.qty > maxOut(prep.id) && (
              <p className="text-xs font-bold text-brand-redtext">
                Bahan mentah kemungkinan kurang untuk {fmtQty(o.qty)} {smallUnit} (batas aman ±{fmtQty(maxOut(prep.id))}).
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
              outputs: outputs
                .map((o, i) => ({ ...o, mode: (unitMode[i] ?? 'small') as 'small' | 'buy' }))
                .filter((o) => o.qty > 0 && outPool.some((p) => p.id === o.ingredient_id))
                .map((o) => ({
                  ingredient_id: o.ingredient_id,
                  qty: o.qty,
                  ...(o.mode === 'buy' ? { origin_unit: 'buy' as const } : {})
                })),
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

/**
 * Riwayat batch produksi (audit dapur): 10 batch terakhir — waktu, catatan
 * (mis. "templat: Batch Ayam"), dan output dgn satuan asal. Input lewat
 * satuan beli tampil "1 pack (12 potong)"; input satuan kecil tampil biasa.
 */
function BatchHistory({ batches, catalog }: { batches: BatchHistoryItem[]; catalog: Catalog }): ReactElement {
  const ingById = useMemo(() => ingIndex(catalog.ingredients), [catalog])
  return (
    <div className="card mt-4 p-3">
      <h2 className="mb-2 font-extrabold">Riwayat Batch</h2>
      {batches.length === 0 ? (
        <p className="text-sm text-brand-muted">Belum ada batch. Setiap produksi (form manual atau templat) tercatat di sini.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {batches.map((b) => (
            <div key={b.id} className="rounded-lg border border-brand-line px-2.5 py-2">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-xs font-bold text-brand-muted tabular-nums">#{b.id}</span>
                <span className="text-xs font-bold text-brand-muted">{fmtDateTime(b.created_at)}</span>
                {b.note && <span className="chip bg-brand-paper text-[10px]">{b.note}</span>}
              </div>
              <p className="mt-0.5 text-sm font-bold">
                {b.items
                  .map((it) => {
                    const ing = it.ingredient_id != null ? ingById.get(it.ingredient_id) : undefined
                    const su = ing ? smallUnitOf(ing) : '?'
                    const bu = ing?.buy_unit ?? 'pack'
                    const pc = ing?.pack_content || 1
                    // unit(kode asal) → 'buy' = dapur input dlm kemasan; tampil "1 pack (12 potong)"
                    return originQtyLabel(it.qty, it.origin_unit as UnitMode | undefined, pc, su, bu)
                  })
                  .join(' + ')}
              </p>
              {/* rincian potongan hasil batch (bila bahan punya komposisi per kemasan) */}
              {(() => {
                const detail = b.items
                  .filter((it) => it.origin_unit === 'buy')
                  .map((it) => {
                    const ing = it.ingredient_id != null ? ingById.get(it.ingredient_id) : undefined
                    const bd = ing?.pack_breakdown ?? []
                    if (!bd.length) return null
                    const packs = it.qty / (ing?.pack_content || 1)
                    return `${ing?.name}: ${bd.map((x) => `${fmtQty(x.qty * packs)} ${x.name}`).join(' + ')}`
                  })
                  .filter(Boolean)
                return detail.length ? <p className="mt-0.5 text-[11px] font-bold text-brand-muted">{detail.join(' · ')}</p> : null
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface BatchTemplate {
  id: number
  name: string
  /** qty selalu satuan kecil; origin_unit 'buy' = dapur menginput dalam satuan kemasan. */
  outputs: { ingredient_id: number; qty: number; origin_unit?: 'buy' }[]
  fryer_id: number | null
  fried_grams: number
}

/**
 * Produksi Cepat: templat batch 1 klik utk dapur.
 * Satu templat = resep batch (x ayam potong + x tepung = x potongan siap goreng).
 * Tombol Produksi menjalankan createBatch yang sama dgn form manual — stok gudang
 * berkurang, stok siap jual bertambah, kasir langsung melihat sisa porsi baru.
 * Templat tersimpan di settings.batch_templates (shared demo/live via saveSetting).
 */
function QuickProduce({
  templates,
  catalog,
  outPool,
  fryers,
  settings,
  onDone,
  setErr,
  setSettings,
  toast
}: {
  templates: BatchTemplate[]
  catalog: Catalog
  outPool: Ingredient[]
  fryers: Fryer[]
  settings: Settings
  onDone: () => Promise<void>
  setErr: (s: string) => void
  setSettings: (s: Settings) => void
  toast: (s: string) => void
}): ReactElement {
  const ingById = useMemo(() => ingIndex(catalog.ingredients), [catalog])
  const [editing, setEditing] = useState<BatchTemplate | null>(null)
  // mode satuan input per baris di modal templat ('small' | 'buy') + teks mentah mode beli —
  // pola sama dengan BatchForm: angka disimpan satuan kecil, mode hanya cara input.
  const [tUnitMode, setTUnitMode] = useState<Record<number, 'small' | 'buy'>>({})
  const [buyDraft, setBuyDraft] = useState<Record<number, string>>({})
  const [busyId, setBusyId] = useState<number | null>(null)

  const run = async (t: BatchTemplate): Promise<void> => {
    setBusyId(t.id)
    setErr('')
    try {
      await createBatch({
        outputs: t.outputs.map((o) => ({ ingredient_id: o.ingredient_id, qty: o.qty, ...(o.origin_unit === 'buy' ? { origin_unit: 'buy' as const } : {}) })),
        fryer_id: t.fryer_id,
        fried_grams: t.fried_grams || 0,
        note: `templat: ${t.name}`
      })
      toast(`Produksi "${t.name}" selesai — stok siap jual bertambah.`)
      await onDone()
    } catch (ex) {
      setErr((ex as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const saveTemplate = async (t: BatchTemplate): Promise<void> => {
    try {
      const next = [...(templates ?? [])]
      const idx = next.findIndex((x) => x.id === t.id)
      if (idx >= 0) next[idx] = t
      else next.push({ ...t, id: Math.max(0, ...next.map((x) => x.id)) + 1 })
      await saveSetting('batch_templates', next)
      setSettings({ ...settings, batch_templates: next })
      toast('Templat produksi tersimpan.')
      setEditing(null)
      await onDone()
    } catch (ex) {
      setErr((ex as Error).message)
    }
  }

  const deleteTemplate = async (id: number): Promise<void> => {
    try {
      const next = (templates ?? []).filter((t) => t.id !== id)
      await saveSetting('batch_templates', next)
      setSettings({ ...settings, batch_templates: next })
      await onDone()
    } catch (ex) {
      setErr((ex as Error).message)
    }
  }

  return (
    <div className="card strip mb-4 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="font-extrabold">Produksi Cepat — satu klik dari templat</h2>
        <button type="button" className="btn-ghost ml-auto !min-h-0 !py-1.5 text-xs" onClick={() => { setTUnitMode({}); setBuyDraft({}); setEditing({ id: 0, name: '', outputs: outPool.length ? [{ ingredient_id: outPool[0].id, qty: 1 }] : [], fryer_id: null, fried_grams: 0 }) }}>
          + Templat Baru
        </button>
      </div>
      <p className="mb-3 text-xs text-brand-muted">
        Templat = resep batch tetap (mis. 1 batch Ayam Goreng = 4 ayam potong + 500g tepung → 36 potongan siap goreng). Dapur cukup tekan tombol — stok gudang berkurang, etalase jual bertambah, kasir ikut tahu sisa porsinya.
      </p>
      {(templates ?? []).length === 0 ? (
        <p className="text-sm text-brand-muted">Belum ada templat. Buat dari tombol di kanan atas, atau isi form manual di bawah.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {(templates ?? []).map((t) => {
            const missing = t.outputs.filter((o) => !outPool.some((p) => p.id === o.ingredient_id))
            const needs = new Map<number, number>()
            for (const o of t.outputs)
              for (const [iid, need] of ingredientNeeds(o.ingredient_id, o.qty, catalog.ingRecipes)) needs.set(iid, (needs.get(iid) ?? 0) + need)
            const short = [...needs.entries()].filter(([iid, need]) => (ingById.get(iid)?.stock ?? 0) < need)
            const disabled = missing.length > 0 || busyId !== null
            return (
              <div key={t.id} className={`rounded-lg border-[1.5px] p-3 ${missing.length ? 'border-brand-line opacity-60' : short.length ? 'border-brand-gold' : 'border-brand-line'}`}>
                <div className="flex items-start justify-between gap-1">
                  <p className="min-w-0 font-extrabold">{t.name}</p>
                  <span className="flex shrink-0 gap-1">
                    <button type="button" className="icon-btn !h-7 !w-7 text-xs" title="Edit templat" aria-label={`Edit templat ${t.name}`} onClick={() => { setTUnitMode({}); setBuyDraft({}); setEditing({ ...t }) }}>
                      ✏️
                    </button>
                    <button type="button" className="icon-btn-danger !h-7 !w-7 text-xs" title="Hapus templat" aria-label={`Hapus templat ${t.name}`} onClick={() => void deleteTemplate(t.id)}>
                      🗑
                    </button>
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] font-bold text-brand-muted">
                  {t.outputs
                    .map((o) => {
                      const ing = ingById.get(o.ingredient_id)
                      const su = ing ? smallUnitOf(ing) : '?'
                      return `${fmtQty(o.qty)} ${su} ${ing?.name ?? `#${o.ingredient_id}`}`
                    })
                    .join(' + ')}
                </p>
                {short.length > 0 && (
                  <p className="mt-1 text-[11px] font-bold text-brand-redtext">
                    Stok kurang: {short.map(([iid, need]) => `${ingById.get(iid)?.name ?? `#${iid}`} (butuh ${fmtQty(need)})`).join(', ')}
                  </p>
                )}
                {missing.length > 0 && <p className="mt-1 text-[11px] font-bold text-brand-redtext">Bahan sudah dihapus/nonaktif — edit templat.</p>}
                {/* guard komposisi: pack_breakdown bahan output tidak cocok dgn isi kemasan */}
                {(() => {
                  const bad = t.outputs
                    .map((o) => ({ o, ing: ingById.get(o.ingredient_id) }))
                    .filter(({ o, ing }) => o.origin_unit === 'buy' && breakdownMismatch(ing?.pack_breakdown, ing?.pack_content || 1) !== null)
                  if (!bad.length) return null
                  return (
                    <p className="mt-1 text-[11px] font-extrabold text-brand-redtext">
                      ⚠ Komposisi {bad.map(({ ing }) => ing?.name).join(', ')} tidak cocok dgn isi kemasan — rincian potongan akan salah.
                    </p>
                  )
                })()}
                <button type="button" className="btn-primary mt-2 w-full !min-h-0 !py-2 text-sm" disabled={disabled} onClick={() => void run(t)}>
                  {busyId === t.id ? 'Memproses…' : '▶ Produksi Sekarang'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      <Modal open={editing !== null} title={editing?.id ? 'Edit Templat Produksi' : 'Templat Produksi Baru'} onClose={() => setEditing(null)}>
        {editing && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void saveTemplate(editing)
            }}
          >
            <div>
              <label className="lbl" htmlFor="tname">Nama templat</label>
              <input id="tname" className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="cth: Batch Ayam Goreng" required />
            </div>
            {editing.outputs.map((o, i) => {
              const prep = outPool.find((p) => p.id === o.ingredient_id)
              const smallUnit = prep ? smallUnitOf(prep) : '?'
              const buyUnit = prep?.buy_unit ?? 'pack'
              const packContent = prep?.pack_content || 1
              const mode = tUnitMode[i] ?? 'small'
              return (
                <div key={i}>
                  <div className="grid grid-cols-[1fr_96px_88px_36px] gap-2">
                    <select
                      className="input !h-10"
                      value={o.ingredient_id}
                      onChange={(e) => setEditing({ ...editing, outputs: editing.outputs.map((x, j) => (j === i ? { ...x, ingredient_id: parseInt(e.target.value, 10) } : x)) })}
                      aria-label="Output templat"
                    >
                      {outPool.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}{p.kind === 'raw' ? ' (mentah)' : ''}</option>
                      ))}
                    </select>
                    <input
                      className="input !h-10 text-right"
                      inputMode="decimal"
                      value={buyDraft[i] ?? (mode === 'small' ? String(o.qty) : String(fromSmallQty(o.qty, 'buy', packContent)))}
                      onChange={(e) => {
                        // draft mentah dulu (koma tetap tampil), lalu commit angka ke state
                        setBuyDraft((d) => ({ ...d, [i]: e.target.value }))
                        if (mode === 'small') {
                          setEditing({ ...editing, outputs: editing.outputs.map((x, j) => (j === i ? { ...x, qty: parseNum(e.target.value) } : x)) })
                        } else {
                          // satuan beli → kecil: kalikan isi kemasan (helper teruji units.ts)
                          setEditing({ ...editing, outputs: editing.outputs.map((x, j) => (j === i ? { ...x, qty: toSmallQty(parseNum(e.target.value), 'buy', packContent) } : x)) })
                        }
                      }}
                      onBlur={() => setBuyDraft((d) => ({ ...d, [i]: '' }))}
                      aria-label="Jumlah output"
                    />
                    {/* mode satuan per baris: kecil (jual) atau beli (kemasan) — sama seperti BatchForm */}
                    <select
                      className="input !h-10 !px-1 text-xs"
                      value={mode}
                      onChange={(e) => {
                        const m = e.target.value as 'small' | 'buy'
                        setTUnitMode((u) => ({ ...u, [i]: m }))
                        setBuyDraft((d) => ({ ...d, [i]: '' }))
                        // tandai asal input utk audit riwayat; mode kecil = tanpa penanda
                        setEditing({
                          ...editing,
                          outputs: editing.outputs.map((x, j) => {
                            if (j !== i) return x
                            const { origin_unit: _drop, ...rest } = x
                            return m === 'buy' ? { ...rest, origin_unit: 'buy' as const } : rest
                          })
                        })
                      }}
                      aria-label="Satuan output"
                      title={`Angka dalam ${mode === 'small' ? `satuan kecil (${smallUnit}) — dipakai kasir & resep` : `satuan beli (${buyUnit}) — dikali isi ${fmtQty(packContent)} otomatis`}. Tersimpan sebagai ${smallUnit} (satuan kecil).`}
                    >
                      <option value="small">{smallUnit}</option>
                      {packContent > 1 && <option value="buy">{buyUnit}</option>}
                    </select>
                    <button type="button" className="icon-btn-danger" onClick={() => setEditing({ ...editing, outputs: editing.outputs.filter((_, j) => j !== i) })} aria-label="Hapus baris">
                      🗑
                    </button>
                  </div>
                  <p className="mt-0.5 text-[11px] font-bold text-brand-muted">disimpan sebagai {fmtQty(o.qty)} {smallUnit}{packContent > 1 ? ` · 1 ${buyUnit} = ${fmtQty(packContent)} ${smallUnit}` : ''}</p>
                  {mode === 'buy' && breakdownMismatch(prep?.pack_breakdown, packContent) !== null && (
                    <p className="mt-0.5 text-[11px] font-extrabold text-brand-redtext">
                      ⚠ Komposisi {prep?.name} tidak cocok: total {fmtQty(breakdownMismatch(prep?.pack_breakdown, packContent) ?? 0)} ≠ isi kemasan {fmtQty(packContent)} — perbaiki di Bahan & HPP.
                    </p>
                  )}
                </div>
              )
            })}
            <button type="button" className="btn-ghost !min-h-0 !py-1.5 text-xs" onClick={() => outPool.length && setEditing({ ...editing, outputs: [...editing.outputs, { ingredient_id: outPool[0].id, qty: 1 }] })}>
              + Output
            </button>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="lbl" htmlFor="tfry">Fryer (opsional)</label>
                <select id="tfry" className="input" value={editing.fryer_id ?? ''} onChange={(e) => setEditing({ ...editing, fryer_id: e.target.value ? parseInt(e.target.value, 10) : null })}>
                  <option value="">Tanpa fryer</option>
                  {fryers.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="lbl" htmlFor="tgr">Berat goreng (gram)</label>
                <input id="tgr" className="input" inputMode="numeric" value={editing.fried_grams ? String(editing.fried_grams) : ''} onChange={(e) => setEditing({ ...editing, fried_grams: parseInt(e.target.value.replace(/\D/g, ''), 10) || 0 })} placeholder="0" />
              </div>
            </div>
            <button type="submit" className="btn-primary" disabled={!editing.name.trim() || editing.outputs.every((o) => o.qty <= 0)}>
              Simpan Templat
            </button>
          </form>
        )}
      </Modal>
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
