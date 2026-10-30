// Tool registry: the declarations the LLM sees and the dispatcher the agent
// loop calls. Declarations use plain JSON Schema so any provider can use them.
import { searchProducts, getPriceAndSchemes, checkAvailability } from './catalog.js';
import { recordOrderInterest, recordFollowup, ORDER_UNITS, FOLLOWUP_TYPES } from './capture.js';
import { quoteOrder } from './pricing.js';
import { todayISO } from '../config.js';

export const toolDeclarations = [
  {
    name: 'search_products',
    description:
      'Search the product catalogue by name, brand or category. Use this first to find the SKU for anything the retailer mentions.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words the retailer used, e.g. "masala noodles" or "chai raja 1kg".' },
        category: {
          type: 'string',
          description: 'Optional category filter: biscuits, noodles, tea, coffee, soap, shampoo, detergent, toothpaste.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_price_and_schemes',
    description:
      'Get MRP, retailer price, margin, case price and the active and expired trade schemes for a SKU. Omit sku to list every scheme running today.',
    parameters: {
      type: 'object',
      properties: { sku: { type: 'string', description: 'Product SKU from search_products.' } },
    },
  },
  {
    name: 'check_availability',
    description:
      'Check stock for a SKU. Returns status (in_stock, low_stock, out_of_stock), cases available and alternatives when stock is short.',
    parameters: {
      type: 'object',
      properties: { sku: { type: 'string' } },
      required: ['sku'],
    },
  },
  {
    name: 'record_order_interest',
    description:
      'Record an order enquiry. Only call after the retailer has confirmed the product, quantity and unit. Calling again for the same SKU replaces the quantity. The result includes the updated quote (net value, savings, nudges), so there is no need to call quote_order afterwards.',
    parameters: {
      type: 'object',
      properties: {
        sku: { type: 'string' },
        quantity: { type: 'integer', description: 'Whole number, at least 1.' },
        unit: { type: 'string', enum: ORDER_UNITS },
      },
      required: ['sku', 'quantity', 'unit'],
    },
  },
  {
    name: 'record_followup',
    description: 'Record a follow-up the sales team must do, such as a callback, a sales visit or sending details.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: FOLLOWUP_TYPES },
        details: { type: 'string', description: 'What needs to be done, in one sentence.' },
        when: { type: 'string', description: 'When, in the retailer\'s words, e.g. "Friday after 4 pm".' },
      },
      required: ['type', 'details', 'when'],
    },
  },
  {
    name: 'quote_order',
    description:
      "Price the order enquiry recorded so far with today's schemes applied: gross value, discounts, free cases, net value, total savings, and nudges saying how close the retailer is to the next offer. Use it when the retailer asks for the total or the bill.",
    parameters: { type: 'object', properties: {} },
  },
];

const withQuote = (result, ctx) => (result.ok ? { ...result, quote: quoteOrder(ctx.captured.orders, ctx.today) } : result);

const handlers = {
  search_products: (args) => searchProducts(args),
  get_price_and_schemes: (args, ctx) => getPriceAndSchemes(args, ctx.today),
  check_availability: (args) => checkAvailability(args),
  // Returning the quote with the recording saves the model a quote_order round trip (one LLM request) per order.
  record_order_interest: (args, ctx) => withQuote(recordOrderInterest(ctx.captured, args), ctx),
  record_followup: (args, ctx) => recordFollowup(ctx.captured, args),
  quote_order: (args, ctx) => quoteOrder(ctx.captured.orders, ctx.today),
};

// Remember which schemes the agent was told about, for the summary.
function trackSchemes(captured, result) {
  const seen = [
    ...(result.active_schemes || []).map((s) => ({ id: s.id, name: s.name, status: 'active' })),
    ...(result.expired_schemes || []).map((s) => ({ id: s.id, name: s.name, status: 'expired' })),
  ];
  for (const s of seen) {
    if (!captured.schemes_discussed.some((d) => d.id === s.id)) captured.schemes_discussed.push(s);
  }
}

/**
 * Run one tool call. Never throws: errors go back to the model as data so it
 * can recover (e.g. search again) instead of failing the whole turn.
 * @param {string} name
 * @param {object} args
 * @param {{ captured: object, today?: string }} ctx
 */
export function runTool(name, args, ctx) {
  const handler = handlers[name];
  if (!handler) return { ok: false, error: `Unknown tool "${name}".` };
  try {
    const result = handler(args || {}, { today: todayISO(), ...ctx });
    if (name === 'get_price_and_schemes') trackSchemes(ctx.captured, result);
    return result;
  } catch (err) {
    return { ok: false, error: `Tool failed: ${err.message}` };
  }
}

const rupees = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
const results = {
  search_products: (r) => `${r.results.length} match${r.results.length === 1 ? '' : 'es'}${r.results[0] ? `, top: ${r.results[0].name}` : ''}`,
  get_price_and_schemes: (r) =>
    r.sku
      ? `${rupees(r.retailer_price)} (MRP ${rupees(r.mrp)}, ${r.margin_percent}% margin), ${r.active_schemes.length} active / ${r.expired_schemes.length} expired schemes`
      : `${r.active_schemes.length} active schemes`,
  check_availability: (r) => `${r.status.replace(/_/g, ' ')}, ${r.cases_available} cases${r.alternatives?.length ? `, ${r.alternatives.length} alternatives` : ''}`,
  record_order_interest: (r) => `recorded ${r.readback}, order now ${rupees(r.quote.net_value)}`,
  record_followup: (r) => `${r.recorded.type.replace(/_/g, ' ')}, ${r.recorded.when}`,
  quote_order: (r) => `net ${rupees(r.net_value)}, saves ${rupees(r.total_savings)}, ${r.nudges.length} nudges`,
};

/** One line describing a tool result, for the UI's agent trace. */
export function describeToolResult(name, result) {
  if (result?.error) return `error: ${result.error}`;
  try {
    return results[name]?.(result) ?? 'done';
  } catch {
    return 'done';
  }
}
