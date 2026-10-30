// Read-only product, scheme and retailer data plus the pure lookup logic
// behind search_products, get_price_and_schemes and check_availability.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { config, todayISO } from '../config.js';

const load = (file) => JSON.parse(readFileSync(path.join(config.dataDir, file), 'utf8'));

export const products = load('products.json');
export const schemes = load('schemes.json');
export const retailers = load('retailers.json');

// Fewer than this many cases left counts as "low stock".
export const LOW_STOCK_CASES = 3;

export const findProduct = (sku) => products.find((p) => p.sku === String(sku || '').toUpperCase());
export const findRetailer = (id) => retailers.find((r) => r.id === id);
export const productLabel = (p) => `${p.name} ${p.pack_size}`;

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'for', 'and', 'any', 'what', 'is', 'price', 'rate', 'pack', 'packet']);

// Words of 3+ letters, or anything with a digit ("1kg", "250").
function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => (t.length >= 3 || /\d/.test(t)) && !STOPWORDS.has(t))
    .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t)); // crude singular
}

export function stockStatus(p) {
  if (p.stock_units === 0) return 'out_of_stock';
  if (p.stock_units < LOW_STOCK_CASES * p.case_size) return 'low_stock';
  return 'in_stock';
}

export function searchProducts({ query, category } = {}) {
  const tokens = tokenize(query);
  const cat = String(category || '').toLowerCase().trim().replace(/s$/, '');
  const scored = products
    .filter((p) => !cat || p.category.replace(/s$/, '') === cat)
    .map((p) => {
      const words = [p.name, p.brand, p.category, p.sku, p.pack_size, p.pack_size.replace(/\s/g, '')]
        .join(' ')
        .toLowerCase()
        .split(/[^a-z0-9]+/);
      // A token matches when some catalogue word starts with it ("noodle" -> "noodles").
      return { p, score: tokens.filter((t) => words.some((w) => w.startsWith(t))).length };
    })
    .filter(({ score }) => score > 0 || (cat && tokens.length === 0))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  if (scored.length === 0) {
    return { results: [], message: 'No matching products in our catalogue.' };
  }
  return {
    results: scored.map(({ p }) => ({
      sku: p.sku,
      name: productLabel(p),
      category: p.category,
      mrp: p.mrp,
      retailer_price: p.retailer_price,
      stock_status: stockStatus(p),
    })),
  };
}

const isActive = (s, today) => s.valid_from <= today && today <= s.valid_to;
const describeScheme = (s) => ({ id: s.id, name: s.name, description: s.description, valid_to: s.valid_to });

export function getPriceAndSchemes({ sku } = {}, today = todayISO()) {
  // Without a SKU, list every scheme running today.
  if (!sku) {
    return { active_schemes: schemes.filter((s) => isActive(s, today)).map(describeScheme) };
  }
  const p = findProduct(sku);
  if (!p) return { error: `Unknown SKU "${sku}". Use search_products to find the right SKU.` };

  const forSku = schemes.filter((s) => s.applicable_skus.includes(p.sku));
  return {
    sku: p.sku,
    name: productLabel(p),
    mrp: p.mrp,
    retailer_price: p.retailer_price,
    margin_percent: Number((((p.mrp - p.retailer_price) / p.mrp) * 100).toFixed(1)),
    case_size: p.case_size,
    case_price: Number((p.retailer_price * p.case_size).toFixed(2)),
    active_schemes: forSku.filter((s) => isActive(s, today)).map(describeScheme),
    expired_schemes: forSku
      .filter((s) => s.valid_to < today)
      .map((s) => ({ id: s.id, name: s.name, ended_on: s.valid_to })),
  };
}

// In-stock products from the same category, best stocked first.
export function alternativesFor(p) {
  return products
    .filter((o) => o.sku !== p.sku && o.category === p.category && o.stock_units > 0)
    .sort((a, b) => b.stock_units - a.stock_units)
    .slice(0, 2)
    .map((o) => ({ sku: o.sku, name: productLabel(o), retailer_price: o.retailer_price, stock_status: stockStatus(o) }));
}

export function checkAvailability({ sku } = {}) {
  const p = findProduct(sku);
  if (!p) return { error: `Unknown SKU "${sku}". Use search_products to find the right SKU.` };

  const status = stockStatus(p);
  const result = {
    sku: p.sku,
    name: productLabel(p),
    status,
    units_available: p.stock_units,
    cases_available: Math.floor(p.stock_units / p.case_size),
    case_size: p.case_size,
  };
  if (status !== 'in_stock') result.alternatives = alternativesFor(p);
  return result;
}
