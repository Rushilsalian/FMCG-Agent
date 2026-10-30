// Tools that write to the conversation's "captured" state (order interest,
// follow-ups). Pure functions over a captured object so they are easy to test.
import { findProduct, productLabel, alternativesFor } from './catalog.js';

export const ORDER_UNITS = ['cases', 'units'];
export const FOLLOWUP_TYPES = ['callback', 'sales_visit', 'send_details', 'stock_update', 'other'];

export const emptyCaptured = () => ({ orders: [], followups: [], schemes_discussed: [] });

// Accept the ways people (and models) naturally say units.
function normalizeUnit(unit) {
  const u = String(unit || '').toLowerCase().trim();
  if (['case', 'cases', 'carton', 'cartons', 'box', 'boxes'].includes(u)) return 'cases';
  if (['unit', 'units', 'piece', 'pieces', 'pcs', 'pack', 'packs', 'packet', 'packets'].includes(u)) return 'units';
  return null;
}

export const orderReadback = (o) =>
  `${o.quantity} ${o.quantity === 1 ? o.unit.replace(/s$/, '') : o.unit} of ${o.name}`;

export function recordOrderInterest(captured, { sku, quantity, unit } = {}) {
  const p = findProduct(sku);
  if (!p) return { ok: false, error: `Unknown SKU "${sku}". Use search_products to find the right SKU.` };

  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1 || qty > 1000) {
    return { ok: false, error: 'Quantity must be a whole number between 1 and 1000.' };
  }
  const normUnit = normalizeUnit(unit);
  if (!normUnit) return { ok: false, error: `Unit must be one of: ${ORDER_UNITS.join(', ')}.` };

  if (p.stock_units === 0) {
    return {
      ok: false,
      error: `${productLabel(p)} is out of stock, so it was not recorded.`,
      alternatives: alternativesFor(p),
    };
  }

  const totalUnits = normUnit === 'cases' ? qty * p.case_size : qty;
  const item = {
    sku: p.sku,
    name: productLabel(p),
    quantity: qty,
    unit: normUnit,
    total_units: totalUnits,
    estimated_value: Number((totalUnits * p.retailer_price).toFixed(2)),
  };

  // One line per SKU: a repeat call means the retailer changed the quantity.
  const existing = captured.orders.findIndex((o) => o.sku === p.sku);
  if (existing >= 0) captured.orders[existing] = item;
  else captured.orders.push(item);

  const result = { ok: true, recorded: item, readback: orderReadback(item), order_so_far: captured.orders.map(orderReadback) };
  if (totalUnits > p.stock_units) {
    result.note = `Only ${p.stock_units} units are in stock now; the rest would follow in the next dispatch.`;
  }
  return result;
}

export function recordFollowup(captured, { type, details, when } = {}) {
  const cleanDetails = String(details || '').trim().slice(0, 300);
  const cleanWhen = String(when || '').trim().slice(0, 80);
  if (!cleanDetails) return { ok: false, error: 'details is required.' };
  if (!cleanWhen) return { ok: false, error: 'when is required, for example "tomorrow 5 pm".' };

  const followup = {
    type: FOLLOWUP_TYPES.includes(type) ? type : 'other',
    details: cleanDetails,
    when: cleanWhen,
  };
  captured.followups.push(followup);
  return { ok: true, recorded: followup };
}
