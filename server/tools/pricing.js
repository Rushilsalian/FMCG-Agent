// Prices an order enquiry with the trade schemes running today: gross value,
// money off, free goods, net value and "nudges" (how close the retailer is to
// the next offer). Pure function over captured orders, so every rupee the agent
// quotes is computed by code, never by the model doing arithmetic.
import { findProduct, productLabel, schemes, isSchemeActive } from './catalog.js';
import { todayISO } from '../config.js';

// Only suggest topping up when the retailer is this close to an offer.
const NUDGE_MAX_CASES = 3;
const NUDGE_MAX_SHARE = 0.4; // of a value threshold

const round2 = (n) => Math.round(n * 100) / 100;
const rupees = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const cases = (n) => `${n} case${n === 1 ? '' : 's'}`;

function toLine(order) {
  const p = findProduct(order.sku);
  return {
    sku: p.sku,
    name: productLabel(p),
    quantity: order.quantity,
    unit: order.unit,
    total_units: order.total_units,
    cases: Math.floor(order.total_units / p.case_size), // whole cases count towards case-based schemes
    value: round2(order.total_units * p.retailer_price),
  };
}

// Each rule returns any of { discount, free_goods, nudge } for one scheme.
const rules = {
  buy_x_get_y(scheme, lines) {
    const { buy_cases, free_cases, free_sku } = scheme.terms;
    const ordered = lines.reduce((sum, l) => sum + l.cases, 0);
    if (!ordered) return {};
    const free = findProduct(free_sku);
    const times = Math.floor(ordered / buy_cases);
    const result = {};
    if (times > 0) {
      const units = times * free_cases * free.case_size;
      result.free_goods = {
        sku: free.sku,
        name: productLabel(free),
        cases: times * free_cases,
        units,
        value: round2(units * free.retailer_price),
      };
    }
    const gap = buy_cases - (ordered % buy_cases);
    if (gap <= NUDGE_MAX_CASES) {
      result.nudge = `Add ${cases(gap)} to get ${times ? 'another' : ''} ${cases(free_cases)} of ${productLabel(free)} free with ${scheme.name}.`
        .replace(/\s+/g, ' ');
    }
    return result;
  },

  percent_off_above_value(scheme, lines) {
    const { percent, min_order_value } = scheme.terms;
    const value = lines.reduce((sum, l) => sum + l.value, 0);
    if (value >= min_order_value) {
      return { discount: { amount: round2((value * percent) / 100), detail: `${percent}% off ${rupees(round2(value))}` } };
    }
    const gap = round2(min_order_value - value);
    return gap <= min_order_value * NUDGE_MAX_SHARE
      ? { nudge: `Add ${rupees(gap)} more of ${lines.map((l) => l.name).join(' or ')} to get ${percent}% off with ${scheme.name}.` }
      : {};
  },

  combo(scheme, lines) {
    const { requires, amount_off } = scheme.terms;
    const missing = requires
      .map((r) => ({ ...r, have: lines.find((l) => l.sku === r.sku)?.cases || 0 }))
      .filter((r) => r.have < r.cases);
    if (!missing.length) return { discount: { amount: amount_off, detail: `${rupees(amount_off)} off the bill` } };
    const short = missing.map((r) => `${cases(r.cases - r.have)} of ${productLabel(findProduct(r.sku))}`).join(' and ');
    return { nudge: `Add ${short} to get ${rupees(amount_off)} off with ${scheme.name}.` };
  },
};

/**
 * @param {Array<{ sku, quantity, unit, total_units }>} orders captured order lines
 * @param {string} today ISO date; only schemes valid today apply
 */
export function quoteOrder(orders, today = todayISO()) {
  const lines = orders.map(toLine);
  const discounts = [];
  const freeGoods = [];
  const nudges = [];

  for (const scheme of schemes) {
    if (!isSchemeActive(scheme, today) || !rules[scheme.type]) continue;
    const applicable = lines.filter((l) => scheme.applicable_skus.includes(l.sku));
    if (!applicable.length) continue;
    const tag = { scheme_id: scheme.id, scheme: scheme.name, skus: applicable.map((l) => l.sku) };
    const { discount, free_goods, nudge } = rules[scheme.type](scheme, applicable);
    if (discount) discounts.push({ ...tag, ...discount });
    if (free_goods) freeGoods.push({ ...tag, ...free_goods });
    if (nudge) nudges.push({ ...tag, message: nudge });
  }

  const gross = round2(lines.reduce((sum, l) => sum + l.value, 0));
  const totalDiscount = round2(discounts.reduce((sum, d) => sum + d.amount, 0));
  const freeValue = round2(freeGoods.reduce((sum, f) => sum + f.value, 0));
  const quote = {
    lines,
    gross_value: gross,
    discounts,
    free_goods: freeGoods,
    total_discount: totalDiscount,
    net_value: round2(gross - totalDiscount),
    total_savings: round2(totalDiscount + freeValue),
    nudges,
  };
  if (!lines.length) quote.message = 'No order has been captured yet.';
  return quote;
}
