import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, toCsv } from '../server/services/analytics.js';

const NOW = new Date('2026-10-30T10:00:00+05:30');

function interaction(id, startedAt, outcome, { lines = [], net = 0, savings = 0, followups = [], tools = [] } = {}) {
  return {
    id,
    startedAt,
    durationSeconds: 60,
    retailer: { id: 'R001', store_name: 'Sharma General Store', owner: 'Ramesh "RS" Sharma', area: 'Andheri' },
    summary: {
      outcome,
      sentiment: 'positive',
      overview: 'x',
      next_action: 'Confirm, then dispatch',
      products: lines.map((l) => ({ sku: l.sku, name: l.name, quantity: 1, unit: 'cases' })),
      followups,
      schemes_discussed: [],
      generated_by: 'rules',
    },
    quote: { lines, net_value: net, total_savings: savings },
    transcript: [{ role: 'agent', text: 'hi', tools }],
  };
}

const noodles = { sku: 'NDL-MAS-70', name: 'Zippy Masala Noodles 70 g', total_units: 96, value: 1224 };
const sample = [
  interaction('c', '2026-10-30T09:00:00+05:30', 'order_enquiry', { lines: [noodles], net: 1224, savings: 100, tools: ['quote_order'] }),
  interaction('b', '2026-10-29T09:00:00+05:30', 'follow_up_required', {
    followups: [{ type: 'callback', details: 'Call back', when: 'Friday' }],
    tools: ['search_products', 'quote_order'],
  }),
  interaction('a', '2026-10-01T09:00:00+05:30', 'order_enquiry', { lines: [noodles], net: 1224 }),
];

test('computeStats aggregates outcomes, value, products and tools', () => {
  const s = computeStats(sample, NOW);
  assert.equal(s.total_calls, 3);
  assert.equal(s.conversion_rate, 0.67);
  assert.equal(s.pipeline_value, 2448);
  assert.equal(s.savings_offered, 100);
  assert.deepEqual(s.outcomes, { order_enquiry: 2, follow_up_required: 1, info_only: 0, not_interested: 0 });
  assert.deepEqual(s.top_products, [{ sku: 'NDL-MAS-70', name: 'Zippy Masala Noodles 70 g', units: 192, value: 2448, enquiries: 2 }]);
  assert.deepEqual(s.tool_usage, [{ name: 'quote_order', count: 2 }, { name: 'search_products', count: 1 }]);
  assert.equal(s.recent_followups[0].retailer, 'Sharma General Store');

  // Seven IST days ending today; the 1 October call is outside the window.
  assert.equal(s.calls_by_day.length, 7);
  assert.deepEqual(s.calls_by_day.slice(-2).map((d) => [d.date, d.calls]), [['2026-10-29', 1], ['2026-10-30', 1]]);
});

test('computeStats handles no interactions', () => {
  const s = computeStats([], NOW);
  assert.equal(s.total_calls, 0);
  assert.equal(s.conversion_rate, 0);
  assert.deepEqual(s.top_products, []);
});

test('toCsv quotes fields and escapes embedded quotes', () => {
  const [header, first] = toCsv(sample).split('\r\n');
  assert.match(header, /^"id","started_at","retailer"/);
  assert.match(first, /"Ramesh ""RS"" Sharma"/);
  assert.match(first, /"Confirm, then dispatch"/);
  assert.match(first, /"1224"/);
});
