import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { loadCatalog, loadSettings, upsertProduct, upsertCategory, saveRecipe, saveTargets, saveBundle, saveBundleItems, deleteBundle, deleteProduct, uploadProductPhoto, removeProductPhoto, type Catalog } from '../lib/db'
import { fmtHppQty, hppLines, hppTotal, ingIndex, marginPct, maxAvailableQty } from '../lib/hpp'
import { fmtRp, fmtRpPlain, parseNum } from '../lib/money'
import type { Product } from '../lib/types'
import { Modal } from '../components/Modal'
import { fileToPreviewBlob, type PreviewBlob } from '../lib/image'
import { useToast } from '../components/Toast'

type Tab = 'produk' | 'paket' | 'target'

export default function Products(): ReactElement {
  const { toast } = useToast()
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [tab, setTab] = useState<Tab>('produk')
  const [err, setErr] = useState('')
  // ambang margin tipis dari settings (bukan angka patokan hardcoded)
  const [warnPct, setWarnPct] = useState(15)

  const reload = useCallback(async () => {
    try {
      setCatalog(await loadCatalog())
    } catch (ex) {
      setErr((ex as Error).message)
    }
  }, [])

  useEffect(() => {
    void reload()
    void loadSettings()
      .then((s) => setWarnPct(s.margin.warn_pct))
      .catch(() => {})
  }, [reload])

  const ingById = useMemo(() => ingIndex(catalog?.ingredients ?? []), [catalog])

  if (!catalog) return <div className="p-6 text-sm font-bold text-brand-muted">Memuat...</div>

  return (
    <div className="p-3 lg:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-extrabold">Menu & Paket</h1>
        <div className="flex gap-1" role="tablist" aria-label="Bagian">
          {(
            [
              ['produk', 'Produk'],
              ['paket', 'Paket Hemat'],
              ['target', 'Target Harian']
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

      {tab === 'produk' && <ProductsTab catalog={catalog} ingById={ingById} warnPct={warnPct} reload={reload} toast={toast} setErr={setErr} />}
      {tab === 'paket' && <BundlesTab catalog={catalog} reload={reload} toast={toast} setErr={setErr} />}
      {tab === 'target' && <TargetsTab catalog={catalog} reload={reload} toast={toast} setErr={setErr} />}
    </div>
  )
}

function ProductsTab({
  catalog,
  ingById,
  warnPct,
  reload,
  toast,
  setErr
}: {
  catalog: Catalog
  ingById: Map<number, import('../lib/types').Ingredient>
  warnPct: number
  reload: () => Promise<void>
  toast: (s: string) => void
  setErr: (s: string) => void
}): ReactElement {
  const [editProd, setEditProd] = useState<Partial<Product> | null>(null)
  const [editCat, setEditCat] = useState<{ id?: number; name: string; sort: number } | null>(null)
  const [recipeFor, setRecipeFor] = useState<Product | null>(null)
  const [deleting, setDeleting] = useState<Product | null>(null)
  const [q, setQ] = useState('')
  // filter status menu: semua / aktif / nonaktif
  const [activeFilter, setActiveFilter] = useState<'all' | 'on' | 'off'>('all')
  // menu yang sedang di-toggle (mencegah dobel-klik saat RPC jalan)
  const [toggling, setToggling] = useState<number | null>(null)

  const prods = catalog.products.filter(
    (p) => p.name.toLowerCase().includes(q.toLowerCase()) && (activeFilter === 'all' || (activeFilter === 'on' ? p.is_active : !p.is_active))
  )

  /** Nonaktifkan/aktifkan menu tanpa buka form Edit — menu nonaktif hilang dari kasir & portal customer. */
  const toggleActive = async (p: Product): Promise<void> => {
    setToggling(p.id)
    setErr('')
    try {
      await upsertProduct({
        id: p.id,
        name: p.name,
        category_id: p.category_id,
        price: p.price,
        unit: p.unit,
        is_active: !p.is_active,
        sort: p.sort,
        photo: p.photo
      })
      await reload()
    } catch (ex) {
      setErr((ex as Error).message)
    } finally {
      setToggling(null)
    }
  }
  const catName = (id: number | null): string => catalog.categories.find((c) => c.id === id)?.name ?? 'Tanpa kategori'

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input className="input max-w-56" placeholder="Cari produk..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari produk" />
        {/* filter status menu: menu nonaktif disembunyikan dari kasir & portal */}
        <div className="flex gap-1" role="radiogroup" aria-label="Filter status menu">
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
        <button type="button" className="btn-primary" onClick={() => setEditProd({ unit: 'porsi', is_active: true, sort: 99 })}>
          + Produk Baru
        </button>
        <button type="button" className="btn-ghost" onClick={() => setEditCat({ name: '', sort: 99 })}>
          + Kategori
        </button>
      </div>
      <div className="grid grid-cols-2 content-start gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {prods.map((p) => {
          const lines = hppLines(p.id, catalog.recipeByProduct, catalog.ingRecipes, ingById)
          const hpp = hppTotal(lines)
          const mg = marginPct(p.price, hpp)
          // chip stok di pojok foto: pengelola langsung lihat sisa porsi tanpa buka detail
          const avail = maxAvailableQty(p.id, catalog.recipeByProduct, ingById)
          return (
            <article key={p.id} className={`card flex flex-col overflow-hidden ${p.is_active ? '' : 'opacity-70'}`}>
              <button
                type="button"
                className="relative block border-b-[1.5px] border-brand-line text-left"
                title="Ganti foto menu"
                onClick={() => setEditProd(p)}
              >
                {p.photo ? (
                  <img
                    src={p.photo}
                    alt={p.name}
                    className="h-36 w-full object-contain"
                    style={{ background: 'linear-gradient(135deg,#F6E7D8,#EFD9C4)' }}
                    loading="lazy"
                  />
                ) : (
                  <div className="h-36 w-full bg-brand-paper" aria-hidden />
                )}
                {avail <= 0 ? (
                  <span className="chip absolute right-1.5 top-1.5 bg-brand-redtext text-white">Habis</span>
                ) : avail <= 10 && p.is_active ? (
                  <span className="chip absolute right-1.5 top-1.5 bg-brand-gold">sisa {avail}</span>
                ) : null}
              </button>
              <div className="flex min-h-0 flex-1 flex-col gap-0.5 p-2.5">
                <span className="line-clamp-2 text-sm font-bold leading-snug">{p.name}</span>
                <span className="text-xs font-semibold text-brand-muted">{catName(p.category_id)}</span>
                {/* harga menempel di bawah kategori, bukan di dasar kartu, supaya tidak ada celah kosong */}
                <span className="flex flex-wrap items-center justify-between gap-1 pt-1">
                  <span className="text-base font-extrabold tabular-nums">{fmtRp(p.price)}</span>
                  {hpp > 0 ? (
                    <span className={`chip ${mg < warnPct ? 'bg-brand-redtext text-white' : 'bg-brand-gold/30'}`}>margin {mg.toFixed(0)}%</span>
                  ) : (
                    <span className="chip bg-brand-redtext text-white">HPP belum diatur</span>
                  )}
                </span>
                {!p.is_active && <span className="chip w-fit bg-brand-line">Nonaktif</span>}
                <span className="mt-auto flex gap-1.5 pt-1.5">
                  <button
                    type="button"
                    className={`btn-ghost flex-1 !min-h-0 !py-1.5 text-xs ${hpp <= 0 ? '!border-brand-redtext !text-brand-redtext' : ''}`}
                    onClick={() => setRecipeFor(p)}
                  >
                    {hpp > 0 ? 'Resep' : 'Atur resep'}
                  </button>
                  <button type="button" className="btn-ghost flex-1 !min-h-0 !py-1.5 text-xs" onClick={() => setEditProd(p)}>
                    Edit
                  </button>
                  {/* toggle aktif langsung di kartu: menu kosong/habis musiman cukup dimatikan */}
                  <button
                    type="button"
                    className={`btn-ghost flex-1 !min-h-0 !py-1.5 text-xs ${p.is_active ? '' : '!border-brand-gold !text-brand-btn'}`}
                    disabled={toggling === p.id}
                    title={p.is_active ? 'Matikan: hilang dari kasir & portal customer' : 'Nyalakan lagi: menu kembali tampil di kasir & portal'}
                    onClick={() => void toggleActive(p)}
                  >
                    {toggling === p.id ? '…' : p.is_active ? 'Matikan' : 'Nyalakan'}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost flex-1 !min-h-0 !py-1.5 text-xs font-bold text-brand-redtext"
                    onClick={() => setDeleting(p)}
                  >
                    Hapus
                  </button>
                </span>
              </div>
            </article>
          )
        })}
        {prods.length === 0 && <p className="col-span-full py-8 text-center text-sm text-brand-muted">Tidak ada produk yang cocok.</p>}
      </div>

      {/* Modal produk */}
      <Modal open={editProd !== null} title={editProd?.id ? 'Edit Produk' : 'Produk Baru'} onClose={() => setEditProd(null)}>
        {editProd && (
          <ProductForm
            editProd={editProd}
            setEditProd={setEditProd}
            onSaved={async () => {
              setEditProd(null)
              await reload()
              toast('Produk tersimpan.')
            }}
            setErr={setErr}
            catalog={catalog}
          />
        )}
      </Modal>

      {/* Modal konfirmasi hapus menu */}
      <Modal open={deleting !== null} title="Hapus Menu" onClose={() => setDeleting(null)}>
        {deleting && (
          <div>
            <p className="mb-2 text-sm">
              Hapus menu <b>{deleting.name}</b>?
            </p>
            <p className="mb-3 text-xs font-bold text-brand-muted">
              Menu yang sudah pernah terjual / dipakai di resep atau paket tidak bisa dihapus — cukup matikan lewat Edit (Nonaktif) supaya laporan tetap akurat.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary flex-1"
                onClick={async () => {
                  try {
                    await deleteProduct(deleting.id)
                    setDeleting(null)
                    await reload()
                    toast('Menu dihapus.')
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

      {/* Modal kategori */}
      <Modal open={editCat !== null} title="Kategori" onClose={() => setEditCat(null)}>
        {editCat && (
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault()
              try {
                await upsertCategory(editCat)
                setEditCat(null)
                await reload()
                toast('Kategori tersimpan.')
              } catch (ex) {
                setErr((ex as Error).message)
              }
            }}
          >
            <div className="grid grid-cols-2 gap-2">
              {catalog.categories.map((c) => (
                <button key={c.id} type="button" className="btn-ghost !min-h-0 justify-start !py-2 text-xs" onClick={() => setEditCat({ id: c.id, name: c.name, sort: c.sort })}>
                  {c.name}
                </button>
              ))}
            </div>
            <div>
              <label className="lbl" htmlFor="cname">
                Nama kategori (baru / pilih di atas untuk ubah)
              </label>
              <input id="cname" className="input" value={editCat.name} onChange={(e) => setEditCat({ ...editCat, name: e.target.value })} required />
            </div>
            <div>
              <label className="lbl" htmlFor="csort">
                Urutan tampil
              </label>
              <input id="csort" className="input" inputMode="numeric" value={String(editCat.sort)} onChange={(e) => setEditCat({ ...editCat, sort: parseInt(e.target.value.replace(/\D/g, ''), 10) || 0 })} />
            </div>
            <button type="submit" className="btn-primary">
              Simpan Kategori
            </button>
          </form>
        )}
      </Modal>

      {/* Modal resep */}
      <Modal open={recipeFor !== null} title={`Resep & HPP: ${recipeFor?.name ?? ''}`} onClose={() => setRecipeFor(null)} wide>
        {recipeFor && <RecipeEditor catalog={catalog} product={recipeFor} ingById={ingById} onDone={() => { setRecipeFor(null); void reload() }} setErr={setErr} />}
      </Modal>
    </div>
  )
}

function RecipeEditor({
  catalog,
  product,
  ingById,
  onDone,
  setErr
}: {
  catalog: Catalog
  product: Product
  ingById: Map<number, import('../lib/types').Ingredient>
  onDone: () => void
  setErr: (s: string) => void
}): ReactElement {
  const existing = catalog.recipeByProduct.get(product.id) ?? []
  const [lines, setLines] = useState(existing.map((r) => ({ kind: r.kind, component_id: r.component_id, qty: r.qty })))

  const linesHpp = useMemo(() => {
    // hitung HPP sementara dari baris saat ini
    const m: import('../lib/types').RecipeItem[] = lines.map((l) => ({ product_id: product.id, kind: l.kind, component_id: l.component_id, qty: l.qty }))
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
        Komponen per 1 {product.unit} jual. Qty boleh pecahan (0.111 = 1/9 ekor ayam). HPP dihitung otomatis dari harga bahan sekarang.
      </p>
      <div className="flex flex-col gap-2">
        {lines.map((l, i) => {
          const pool = l.kind === 'ingredient' ? catalog.ingredients.filter((x) => x.kind === 'raw') : catalog.products.filter((x) => x.id !== product.id)
          const line = linesHpp.find((h) => h.ingredientId === l.component_id)
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
                    {o.name}
                  </option>
                ))}
              </select>
              <input
                className="input !h-10 text-right"
                value={String(l.qty)}
                inputMode="decimal"
                onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: parseNum(e.target.value) } : x)))}
                aria-label="Qty"
              />
              <span className="text-right text-xs font-bold tabular-nums">{line ? fmtRp(line.cost) : '—'}</span>
              <button type="button" className="text-lg font-extrabold text-brand-redtext" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Hapus baris">
                ✕
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
            await saveRecipe(product.id, lines.filter((l) => l.qty > 0))
            onDone()
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

function BundlesTab({
  catalog,
  reload,
  toast,
  setErr
}: {
  catalog: Catalog
  reload: () => Promise<void>
  toast: (s: string) => void
  setErr: (s: string) => void
}): ReactElement {
  const [editing, setEditing] = useState<{ id?: number; name: string; price: number; items: { product_id: number; qty: number }[] } | null>(null)
  const componentPrice = (items: { product_id: number; qty: number }[]): number =>
    items.reduce((s, i) => s + (catalog.products.find((p) => p.id === i.product_id)?.price ?? 0) * i.qty, 0)

  return (
    <div>
      <button
        type="button"
        className="btn-primary mb-2"
        onClick={() => setEditing({ name: '', price: 0, items: [] })}
      >
        + Paket Baru
      </button>
      {catalog.bundles.length === 0 && <p className="py-6 text-center text-sm text-brand-muted">Belum ada paket hemat.</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {catalog.bundles.map((b) => {
          const comp = componentPrice(b.items ?? [])
          return (
            <div key={b.id} className="card strip p-3">
              <div className="flex items-start justify-between">
                <p className="font-extrabold">{b.name}</p>
                <span className={`chip ${b.is_active ? 'bg-brand-gold/30' : 'bg-brand-line'}`}>{b.is_active ? 'Aktif' : 'Nonaktif'}</span>
              </div>
              <p className="mt-1 text-sm">
                {(b.items ?? []).map((i) => `${i.qty}x ${catalog.products.find((p) => p.id === i.product_id)?.name ?? '?'}`).join(' + ')}
              </p>
              <p className="mt-1 text-sm font-bold">
                {fmtRp(b.price)} <span className="font-normal text-brand-muted">(normal {fmtRp(comp)})</span>
              </p>
              <div className="mt-2 flex gap-2">
                <button type="button" className="btn-ghost !min-h-0 !py-1 text-xs" onClick={() => setEditing({ id: b.id, name: b.name, price: b.price, items: [...(b.items ?? [])] })}>
                  Edit
                </button>
                <button
                  type="button"
                  className="btn-danger !min-h-0 !py-1 text-xs"
                  onClick={async () => {
                    try {
                      await deleteBundle(b.id)
                      await reload()
                    } catch (ex) {
                      setErr((ex as Error).message)
                    }
                  }}
                >
                  Hapus
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <Modal open={editing !== null} title="Paket Hemat" onClose={() => setEditing(null)}>
        {editing && (
          <div className="flex flex-col gap-3">
            <div>
              <label className="lbl" htmlFor="bname">
                Nama paket
              </label>
              <input id="bname" className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div>
              <label className="lbl" htmlFor="bprice">
                Harga paket (Rp)
              </label>
              <input
                id="bprice"
                className="input text-right"
                inputMode="numeric"
                value={editing.price ? fmtRpPlain(editing.price) : ''}
                onChange={(e) => setEditing({ ...editing, price: parseInt(e.target.value.replace(/\D/g, ''), 10) || 0 })}
              />
              <p className="mt-1 text-xs text-brand-muted">
                Total normal komponen: {fmtRp(componentPrice(editing.items))}
              </p>
            </div>
            <div>
              <p className="lbl">Komponen paket</p>
              {editing.items.map((it, i) => (
                <div key={i} className="mb-1.5 grid grid-cols-[1fr_64px_28px] gap-2">
                  <select
                    className="input !h-10"
                    value={it.product_id}
                    onChange={(e) => setEditing({ ...editing, items: editing.items.map((x, j) => (j === i ? { ...x, product_id: parseInt(e.target.value, 10) } : x)) })}
                    aria-label="Produk komponen"
                  >
                    {catalog.products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input !h-10 text-center"
                    value={String(it.qty)}
                    inputMode="numeric"
                    onChange={(e) => setEditing({ ...editing, items: editing.items.map((x, j) => (j === i ? { ...x, qty: parseInt(e.target.value.replace(/\D/g, ''), 10) || 1 } : x)) })}
                    aria-label="Qty"
                  />
                  <button type="button" className="font-extrabold text-brand-redtext" onClick={() => setEditing({ ...editing, items: editing.items.filter((_, j) => j !== i) })} aria-label="Hapus">
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn-ghost !min-h-0 !py-1.5 text-xs"
                onClick={() => setEditing({ ...editing, items: [...editing.items, { product_id: catalog.products[0]?.id ?? 0, qty: 1 }] })}
              >
                + Komponen
              </button>
            </div>
            <button
              type="button"
              className="btn-primary"
              onClick={async () => {
                try {
                  await saveBundle({ id: editing.id, name: editing.name, price: editing.price, is_active: true })
                  if (!editing.id) {
                    // bundle baru: cari id terakhir lalu simpan item
                    const fresh = await loadCatalog()
                    const nb = fresh.bundles[fresh.bundles.length - 1]
                    if (nb) await saveBundleItems(nb.id, editing.items)
                  } else {
                    await saveBundleItems(editing.id, editing.items)
                  }
                  setEditing(null)
                  await reload()
                  toast('Paket tersimpan.')
                } catch (ex) {
                  setErr((ex as Error).message)
                }
              }}
            >
              Simpan Paket
            </button>
          </div>
        )}
      </Modal>
    </div>
  )
}

function TargetsTab({
  catalog,
  reload,
  toast,
  setErr
}: {
  catalog: Catalog
  reload: () => Promise<void>
  toast: (s: string) => void
  setErr: (s: string) => void
}): ReactElement {
  const [vals, setVals] = useState<Record<number, string>>(() => {
    const m: Record<number, string> = {}
    for (const p of catalog.products) m[p.id] = String(catalog.targets.get(p.id) ?? 0)
    return m
  })
  return (
    <div className="max-w-2xl">
      <p className="mb-2 text-sm text-brand-muted">
        Target penjualan harian per menu (dipakai di dashboard: aktual vs target).
      </p>
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>Menu</th>
              <th className="w-28 text-right">Target/ hari</th>
            </tr>
          </thead>
          <tbody>
            {catalog.products.map((p) => (
              <tr key={p.id}>
                <td className="font-bold">{p.name}</td>
                <td>
                  <input
                    className="input !h-9 text-right"
                    inputMode="numeric"
                    value={vals[p.id] ?? '0'}
                    onChange={(e) => setVals({ ...vals, [p.id]: e.target.value.replace(/\D/g, '') })}
                    aria-label={`Target ${p.name}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className="btn-primary mt-3"
        onClick={async () => {
          try {
            await saveTargets(Object.entries(vals).map(([id, v]) => ({ product_id: parseInt(id, 10), qty: parseInt(v, 10) || 0 })).filter((t) => t.qty > 0))
            await reload()
            toast('Target harian tersimpan.')
          } catch (ex) {
            setErr((ex as Error).message)
          }
        }}
      >
        Simpan Target
      </button>
    </div>
  )
}

/**
 * Form produk: field sama seperti sebelumnya, foto kini diupload ke Storage
 * saat simpan (bukan disimpan sebagai data URL di baris produk). Foto lama
 * dihapus dari bucket begitu diganti/dilepas supaya bucket tidak menumpuk.
 */
function ProductForm({
  editProd,
  setEditProd,
  onSaved,
  setErr,
  catalog
}: {
  editProd: Partial<Product>
  setEditProd: (p: Partial<Product> | null) => void
  onSaved: () => Promise<void>
  setErr: (s: string) => void
  catalog: Catalog
}): ReactElement {
  // preview foto baru (data URL kecil); null = tidak mengganti foto
  const [newPhoto, setNewPhoto] = useState<PreviewBlob | null>(null)
  // foto lama yang akan dilepas saat simpan (dari Hapus Foto / ganti foto)
  const [releaseOld, setReleaseOld] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const shownPhoto = newPhoto ? newPhoto.preview : (releaseOld ? null : editProd.photo)

  const pick = async (f: File | undefined, ev: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    if (!f) return
    try {
      const pb = await fileToPreviewBlob(f)
      // foto lama akan diganti: tandai utk dihapus dari bucket
      if (editProd.photo && editProd.photo !== releaseOld) setReleaseOld(editProd.photo)
      setNewPhoto(pb)
      ev.target.value = ''
    } catch {
      setErr('Foto gagal diproses')
    }
  }

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      let photo = editProd.photo ?? null
      if (newPhoto) {
        const up = await uploadProductPhoto(newPhoto.blob, newPhoto.ext)
        photo = up.url
        // simpan dulu baru hapus yang lama supaya gagal-hapus tidak merusak data
        const old = releaseOld
        if (old) await removeProductPhoto(old).catch(() => undefined)
      } else if (releaseOld) {
        photo = null
        await removeProductPhoto(releaseOld).catch(() => undefined)
      }
      await upsertProduct({
        id: editProd.id,
        name: editProd.name ?? '',
        category_id: editProd.category_id ?? null,
        price: editProd.price ?? 0,
        unit: editProd.unit ?? 'porsi',
        is_active: editProd.is_active ?? true,
        sort: editProd.sort ?? 99,
        photo
      })
      setNewPhoto(null)
      setReleaseOld(null)
      await onSaved()
    } catch (ex) {
      setErr((ex as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      <div>
        <label className="lbl" htmlFor="pname">
          Nama menu
        </label>
        <input id="pname" className="input" value={editProd.name ?? ''} onChange={(e) => setEditProd({ ...editProd, name: e.target.value })} required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="lbl" htmlFor="pcat">
            Kategori
          </label>
          <select id="pcat" className="input" value={editProd.category_id ?? ''} onChange={(e) => setEditProd({ ...editProd, category_id: e.target.value ? parseInt(e.target.value, 10) : null })}>
            <option value="">Tanpa kategori</option>
            {catalog.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="lbl" htmlFor="punit">
            Satuan jual
          </label>
          <select id="punit" className="input" value={editProd.unit} onChange={(e) => setEditProd({ ...editProd, unit: e.target.value as Product['unit'] })}>
            {(['porsi', 'potong', 'ekor', 'cup', 'paket'] as const).map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="lbl" htmlFor="pprice">
          Harga jual (Rp)
        </label>
        <input
          id="pprice"
          className="input text-right"
          inputMode="numeric"
          value={editProd.price ? fmtRpPlain(editProd.price) : ''}
          onChange={(e) => setEditProd({ ...editProd, price: parseInt(e.target.value.replace(/\D/g, ''), 10) || 0 })}
          required
        />
      </div>
      <div>
        <label className="lbl" htmlFor="pphoto">
          Foto menu
        </label>
        <div className="flex flex-wrap items-center gap-3">
          {shownPhoto && (
            <>
              <img src={shownPhoto} alt="" className="h-16 w-16 rounded-lg border-[1.5px] border-brand-line object-cover" />
              <button
                type="button"
                className="btn-ghost !min-h-0 !py-1.5 text-xs"
                onClick={() => {
                  if (newPhoto) {
                    // batal ganti: kembali ke foto lama apa adanya
                    setNewPhoto(null)
                    setReleaseOld(null)
                  } else if (editProd.photo) {
                    setReleaseOld(editProd.photo)
                  }
                }}
              >
                {newPhoto ? 'Batal Ganti' : 'Hapus Foto'}
              </button>
            </>
          )}
          <input id="pphoto" type="file" accept="image/*" className="text-sm" onChange={(e) => void pick(e.target.files?.[0], e)} />
        </div>
        <p className="mt-1 text-xs text-brand-muted">Tersimpan di Storage Supabase (maks sisi 640px). Tampil di kasir &amp; portal customer.</p>
      </div>
      <label className="flex items-center gap-2 text-sm font-bold">
        <input type="checkbox" checked={editProd.is_active ?? true} onChange={(e) => setEditProd({ ...editProd, is_active: e.target.checked })} />
        Tampilkan di kasir & portal
      </label>
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? 'Menyimpan...' : 'Simpan Produk'}
      </button>
    </form>
  )
}
