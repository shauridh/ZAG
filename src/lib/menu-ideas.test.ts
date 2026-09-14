import { describe, expect, it } from 'vitest'
import { auditRecipeHealth, bundleIdeas, bundleRecipeLines } from './menu-ideas'
import { recipeIndexBy, ingRecipeIndexBy } from './hpp'
import type { Catalog } from './db'
import type { Ingredient, IngredientRecipe, Product, RecipeItem } from './types'

/**
 * Audit kesehatan resep + ide menu PAKET (kombinasi menu existing).
 */

const ing = (id: number, over: Partial<Ingredient> = {}): Ingredient => ({
  id,
  name: `Bahan${id}`,
  code: null,
  kind: 'raw',
  buy_unit: 'pack',
  small_unit: 'potong',
  pack_content: 1,
  price: 2000,
  stock: 0,
  min_stock: 1,
  active: true,
  ...over
})

const prod = (id: number, name: string, over: Partial<Product> = {}): Product => ({
  id,
  name,
  photo: null,
  category_id: null,
  price: 20000,
  unit: 'porsi',
  is_active: true,
  sort: id,
  ...over
})

const baseCatalog = (over: Partial<Catalog>): Catalog => ({
  ingredients: [],
  products: [],
  categories: [],
  recipeByProduct: new Map(),
  ingRecipes: new Map(),
  bundles: [],
  targets: new Map(),
  ...over
})

describe('auditRecipeHealth', () => {
  it('bahan nonaktif di resep produk terdeteksi + menu yang memakainya tercantum', () => {
    const ings = [ing(10, { name: 'Ayam' }), ing(11, { name: 'Saus Rahasia', active: false })]
    const prods = [prod(1, 'Ayam Goreng'), prod(2, 'Mie Ayam')]
    const recipe: RecipeItem[] = [
      { product_id: 1, kind: 'ingredient', component_id: 11, qty: 0.05 },
      { product_id: 2, kind: 'ingredient', component_id: 11, qty: 0.02 },
      { product_id: 1, kind: 'ingredient', component_id: 10, qty: 0.2 }
    ]
    const cat = baseCatalog({
      ingredients: ings,
      products: prods,
      recipeByProduct: recipeIndexBy(recipe)
    })
    const issues = auditRecipeHealth(cat)
    expect(issues).toHaveLength(1)
    expect(issues[0].ingredientId).toBe(11)
    expect(issues[0].name).toBe('Saus Rahasia')
    expect(issues[0].products.map((p) => p.name).sort()).toEqual(['Ayam Goreng', 'Mie Ayam'])
    expect(issues[0].preparedUsedBy).toHaveLength(0)
  })

  it('bahan nonaktif di resep produksi (prepared) ikut terdeteksi', () => {
    const ings = [ing(20, { name: 'Cabai', active: false }), ing(21, { name: 'Sambal', kind: 'prepared' })]
    const recipe: IngredientRecipe[] = [{ id: 1, ingredient_id: 21, component_id: 20, qty: 0.5 }]
    const cat = baseCatalog({ ingredients: ings, products: [], ingRecipes: ingRecipeIndexBy(recipe) })
    const issues = auditRecipeHealth(cat)
    expect(issues).toHaveLength(1)
    expect(issues[0].preparedUsedBy.map((p) => p.name)).toEqual(['Sambal'])
  })

  it('resep sehat → tanpa temuan', () => {
    const ings = [ing(10), ing(11)]
    const recipe: RecipeItem[] = [{ product_id: 1, kind: 'ingredient', component_id: 10, qty: 0.2 }]
    const cat = baseCatalog({ ingredients: ings, products: [prod(1, 'X')], recipeByProduct: recipeIndexBy(recipe) })
    expect(auditRecipeHealth(cat)).toHaveLength(0)
  })
})

describe('bundleIdeas (ide paket dari menu existing)', () => {
  // menu 1: nasi 5rb, resep 1 bahan stok 30 → tersedia 30
  // menu 2: ayam 11rb, resep 1 bahan stok 20 → tersedia 20
  // menu 3: teh 5rb, resep 1 bahan stok 10 → tersedia 10
  const ings = [ing(10, { stock: 30 }), ing(11, { stock: 20 }), ing(12, { stock: 10 })]
  const prods = [prod(1, 'Nasi Putih', { price: 5000, category_id: 2 }), prod(2, 'Ayam Goreng', { price: 11000, category_id: 1 }), prod(3, 'Teh Botol', { price: 5000, category_id: 7 })]
  const recipes = recipeIndexBy([
    { product_id: 1, kind: 'ingredient', component_id: 10, qty: 1 },
    { product_id: 2, kind: 'ingredient', component_id: 11, qty: 1 },
    { product_id: 3, kind: 'ingredient', component_id: 12, qty: 1 }
  ])

  it('mengusulkan paket 2–3 menu dengan harga diskon 10% & HPP gabungan', () => {
    const cat = baseCatalog({ ingredients: ings, products: prods, recipeByProduct: recipes })
    const ideas = bundleIdeas(cat, 10)
    expect(ideas.length).toBeGreaterThanOrEqual(1)
    const duo = ideas.find((i) => i.items.length === 2)!
    expect(duo.normalTotal).toBe(duo.items.reduce((s, x) => s + x.price, 0))
    // harga paket = total normal × 0,9 dibulatkan ke 500 terdekat
    expect(duo.suggestedPrice % 500).toBe(0)
    expect(duo.suggestedPrice).toBeLessThan(duo.normalTotal)
    expect(duo.marginPct).toBeGreaterThan(20)
    // HPP gabungan = jumlah HPP menu penyusun (masing-masing 1 bahan × 2000)
    expect(duo.hpp).toBe(duo.items.length * 2000)
  })

  it('paket lintas kategori dapat skor lebih tinggi; kombinasi yang sudah jadi paket dilewati', () => {
    const cat = baseCatalog({ ingredients: ings, products: prods, recipeByProduct: recipes })
    const ideas = bundleIdeas(cat, 20)
    const cross = ideas.find((i) => i.items.length === 2 && new Set([i.items[0].productId, i.items[1].productId]).size === 2)
    expect(cross).toBeTruthy()
    // kombinasi yang sudah ada sebagai paket aktif tidak diusulkan lagi
    const cat2 = baseCatalog({
      ingredients: ings,
      products: prods,
      recipeByProduct: recipes,
      bundles: [{ id: 1, name: 'Paket Hemat', price: 20000, is_active: true, items: [{ product_id: 1, qty: 1 }, { product_id: 2, qty: 1 }] }]
    })
    const ideas2 = bundleIdeas(cat2, 20)
    expect(ideas2.some((i) => i.items.length === 2 && i.items.some((x) => x.productId === 1) && i.items.some((x) => x.productId === 2))).toBe(false)
  })

  it('menu habis (stok 0) tidak masuk pool ide', () => {
    const ings2 = [ing(10, { stock: 30 }), ing(11, { stock: 20 }), ing(12, { stock: 0 })]
    const cat = baseCatalog({ ingredients: ings2, products: prods, recipeByProduct: recipes })
    const ideas = bundleIdeas(cat, 20)
    expect(ideas.some((i) => i.items.some((x) => x.productId === 3))).toBe(false)
  })

  it('menu nonaktif tidak masuk pool', () => {
    const prods2 = [...prods, prod(4, 'Menu Mati', { is_active: false })]
    const recipes2 = recipeIndexBy([
      ...recipes.get(1)!.map((r) => r),
      { product_id: 4, kind: 'ingredient', component_id: 10, qty: 1 }
    ])
    const cat = baseCatalog({ ingredients: ings, products: prods2, recipeByProduct: recipes2 })
    const ideas = bundleIdeas(cat, 20)
    expect(ideas.some((i) => i.items.some((x) => x.productId === 4))).toBe(false)
  })

  it('bundleRecipeLines: resep paket = semua komponen sbg produk, qty 1', () => {
    const lines = bundleRecipeLines(99, [{ productId: 1 }, { productId: 2 }])
    expect(lines).toEqual([
      { product_id: 99, kind: 'product', component_id: 1, qty: 1 },
      { product_id: 99, kind: 'product', component_id: 2, qty: 1 }
    ])
  })

  it('kombinasi yang sudah dibuat lewat "Jadikan Menu" (produk ber-resep produk) tidak diusulkan lagi', () => {
    // Paket Chicken Roll + Nasi Putih sudah ada sbg PRODUK id 9 dengan resep produk
    const recipesWithPaket = recipeIndexBy([
      { product_id: 1, kind: 'ingredient', component_id: 10, qty: 1 },
      { product_id: 2, kind: 'ingredient', component_id: 11, qty: 1 },
      { product_id: 3, kind: 'ingredient', component_id: 12, qty: 1 },
      { product_id: 9, kind: 'product', component_id: 1, qty: 1 },
      { product_id: 9, kind: 'product', component_id: 2, qty: 1 }
    ])
    const prodsWithPaket = [...prods, prod(9, 'Paket Ayam Goreng + Nasi Putih', { price: 14400, category_id: 1 })]
    const cat = baseCatalog({
      ingredients: ings,
      products: prodsWithPaket,
      recipeByProduct: recipesWithPaket
    })
    const ideas = bundleIdeas(cat, 20)
    // kombinasi {1, 2} harus tersembunyi — hanya boleh muncul sbg paket lain (mis. {1,3} / {2,3})
    const duplicateCombo = ideas.find(
      (i) =>
        i.items.length === 2 &&
        i.items.some((x) => x.productId === 1) &&
        i.items.some((x) => x.productId === 2)
    )
    expect(duplicateCombo).toBeUndefined()
  })
})
