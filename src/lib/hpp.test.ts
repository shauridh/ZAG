import { describe, expect, it } from 'vitest'
import type { Ingredient, IngredientRecipe, RecipeItem } from './types'
import {
  hppLines,
  hppTotal,
  ingredientNeeds,
  ingIndex,
  ingRecipeIndexBy,
  marginPct,
  maxAvailableQty,
  preparedCost,
  productNeeds,
  rawNeedsCost,
  rawProductNeeds,
  recipeIndexBy
} from './hpp'

const ing = (id: number, name: string, price: number, stock: number): Ingredient => ({
  id,
  name,
  code: null,
  kind: 'raw',
  buy_unit: 'kg',
  pack_content: 1,
  price,
  stock,
  min_stock: 0,
  active: true
})

const ings = new Map<number, Ingredient>([
  [10, ing(10, 'Ayam', 25000, 9)],
  [11, ing(11, 'Tepung', 12000, 5)],
  [12, ing(12, 'Minyak', 21700, 2)]
])

// Produk 1 butuh 0.2 kg ayam + 0.05 kg tepung per porsi.
// Produk 2 (nested) pakai 1x produk 1 + 0.1 kg minyak.
const recipeByProduct = new Map<number, RecipeItem[]>([
  [1, [
    { product_id: 1, kind: 'ingredient', component_id: 10, qty: 0.2 },
    { product_id: 1, kind: 'ingredient', component_id: 11, qty: 0.05 }
  ]],
  [2, [
    { product_id: 2, kind: 'product', component_id: 1, qty: 1 },
    { product_id: 2, kind: 'ingredient', component_id: 12, qty: 0.1 }
  ]]
])

const noIngRecipes = new Map<number, IngredientRecipe[]>()

describe('productNeeds', () => {
  it('expands a flat recipe into raw ingredients', () => {
    const needs = productNeeds(1, 2, recipeByProduct, ings)
    expect(needs.get(10)).toBeCloseTo(0.4)
    expect(needs.get(11)).toBeCloseTo(0.1)
  })

  it('expands nested product recipes recursively', () => {
    const needs = productNeeds(2, 1, recipeByProduct, ings)
    expect(needs.get(10)).toBeCloseTo(0.2)
    expect(needs.get(11)).toBeCloseTo(0.05)
    expect(needs.get(12)).toBeCloseTo(0.1)
  })
})

describe('hppLines / hppTotal', () => {
  it('costs each raw ingredient at pack price × qty', () => {
    const lines = hppLines(1, recipeByProduct, noIngRecipes, ings)
    expect(hppTotal(lines)).toBeCloseTo(0.2 * 25000 + 0.05 * 12000)
  })
})

describe('ingredientNeeds / preparedCost', () => {
  it('falls back to the ingredient itself when it has no production recipe', () => {
    const needs = ingredientNeeds(11, 2, noIngRecipes)
    expect(needs.get(11)).toBe(2)
  })

  it('expands production recipes of prepared ingredients', () => {
    const sambal = new Map<number, IngredientRecipe[]>([
      [30, [{ id: 1, ingredient_id: 30, component_id: 12, qty: 0.5 }]]
    ])
    const needs = ingredientNeeds(30, 3, sambal)
    expect(needs.get(12)).toBeCloseTo(1.5)
    expect(preparedCost(30, sambal, ings)).toBeCloseTo(0.5 * 21700)
  })
})

describe('maxAvailableQty', () => {
  it('is bounded by the scarcest ingredient', () => {
    // Ayam: 9 kg / 0.2 = 45 porsi; Tepung: 5 / 0.05 = 100 porsi
    expect(maxAvailableQty(1, recipeByProduct, ings)).toBe(45)
  })

  it('returns 999 for products without a recipe', () => {
    expect(maxAvailableQty(99, recipeByProduct, ings)).toBe(999)
  })
})

describe('rawProductNeeds / rawNeedsCost', () => {
  // Sambal (30) diproduksi dari minyak (12) — prepared diekspansi ke mentah.
  const sambal = new Map<number, IngredientRecipe[]>([
    [30, [{ id: 1, ingredient_id: 30, component_id: 12, qty: 0.5 }]]
  ])
  const ingsSambal = new Map<number, Ingredient>([
    ...ings,
    [30, { ...ing(30, 'Sambal Geprek', 15000, 0), kind: 'prepared' as const }]
  ])
  // Produk 3: 1x produk 1 (nested) + 0.2 cup sambal (prepared).
  const withPrepared = new Map<number, RecipeItem[]>([
    ...recipeByProduct,
    [3, [
      { product_id: 3, kind: 'product', component_id: 1, qty: 1 },
      { product_id: 3, kind: 'ingredient', component_id: 30, qty: 0.2 }
    ]]
  ])

  it('expands prepared components into raw ingredients', () => {
    const needs = rawProductNeeds(3, 2, withPrepared, sambal, ingsSambal)
    // 2 porsi = 2x produk 1 (0.4 ayam + 0.1 tepung) + 0.4 cup sambal → 0.2 minyak
    expect(needs.get(10)).toBeCloseTo(0.4)
    expect(needs.get(11)).toBeCloseTo(0.1)
    expect(needs.get(12)).toBeCloseTo(0.2)
    expect(needs.has(30)).toBe(false) // prepared tidak pernah jadi daun
  })

  it('costs raw needs at per-unit price with per-line rounding', () => {
    // produk 1, 2 porsi: 0.4 ayam (25000) + 0.1 tepung (12000)
    expect(rawNeedsCost(1, 2, recipeByProduct, noIngRecipes, ings)).toBe(0.4 * 25000 + 0.1 * 12000)
  })

  it('ignores unknown ingredients instead of crashing', () => {
    expect(rawNeedsCost(99, 5, recipeByProduct, noIngRecipes, ings)).toBe(0)
  })
})

describe('indeks katalog (ingIndex / recipeIndexBy / ingRecipeIndexBy)', () => {
  it('ingIndex maps ingredients by id', () => {
    expect(ingIndex([...ings.values()]).get(10)?.name).toBe('Ayam')
  })

  it('recipeIndexBy groups recipe rows per product', () => {
    const rows = [...recipeByProduct.get(1)!, ...recipeByProduct.get(2)!]
    const idx = recipeIndexBy(rows)
    expect(idx.get(1)).toHaveLength(2)
    expect(idx.get(2)).toHaveLength(2)
  })

  it('ingRecipeIndexBy groups production recipes per ingredient', () => {
    const idx = ingRecipeIndexBy([{ id: 1, ingredient_id: 30, component_id: 12, qty: 0.5 }])
    expect(idx.get(30)).toHaveLength(1)
  })
})

describe('marginPct', () => {
  it('computes margin percentage', () => {
    expect(marginPct(89000, 63710)).toBeCloseTo(28.42, 1)
  })

  it('is 0 for zero price', () => {
    expect(marginPct(0, 5000)).toBe(0)
  })

  it('is negative when selling below cost', () => {
    expect(marginPct(5000, 8000)).toBeLessThan(0)
  })
})
