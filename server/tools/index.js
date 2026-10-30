// Tool registry: the declarations the LLM sees and the dispatcher the agent
// loop calls. Declarations use plain JSON Schema so any provider can use them.
import { searchProducts, getPriceAndSchemes, checkAvailability } from './catalog.js';
import { recordOrderInterest, recordFollowup, ORDER_UNITS, FOLLOWUP_TYPES } from './capture.js';
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
      'Record an order enquiry. Only call after the retailer has confirmed the product, quantity and unit. Calling again for the same SKU replaces the quantity.',
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
];

const handlers = {
  search_products: (args) => searchProducts(args),
  get_price_and_schemes: (args, ctx) => getPriceAndSchemes(args, ctx.today),
  check_availability: (args) => checkAvailability(args),
  record_order_interest: (args, ctx) => recordOrderInterest(ctx.captured, args),
  record_followup: (args, ctx) => recordFollowup(ctx.captured, args),
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
