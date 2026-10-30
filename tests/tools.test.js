import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchProducts, getPriceAndSchemes, checkAvailability } from '../server/tools/catalog.js';
import { recordOrderInterest, recordFollowup, emptyCaptured } from '../server/tools/capture.js';
import { runTool } from '../server/tools/index.js';

const TODAY = '2026-10-30';

test('search_products finds by name, pack size and category', () => {
  assert.equal(searchProducts({ query: 'masala noodles' }).results[0].sku, 'NDL-MAS-70');
  assert.equal(searchProducts({ query: 'chai raja 1kg' }).results[0].sku, 'TEA-PRM-1KG');

  const soaps = searchProducts({ query: '', category: 'soaps' }).results;
  assert.ok(soaps.length >= 2 && soaps.every((p) => p.category === 'soap'));
});

test('search_products returns an empty result for unknown items', () => {
  const res = searchProducts({ query: 'cooking oil' });
  assert.deepEqual(res.results, []);
  assert.match(res.message, /No matching/);
});

test('get_price_and_schemes separates active and expired schemes', () => {
  const tea = getPriceAndSchemes({ sku: 'TEA-PRM-250' }, TODAY);
  assert.equal(tea.retailer_price, 121);
  assert.equal(tea.case_price, 4840);
  assert.deepEqual(tea.active_schemes.map((s) => s.id), ['SCH-CHAI-5PCT']);

  const detergent = getPriceAndSchemes({ sku: 'DET-PWD-1KG' }, TODAY);
  assert.equal(detergent.active_schemes.length, 0);
  assert.deepEqual(detergent.expired_schemes, [{ id: 'SCH-BW-FESTIVE', name: 'BrightWash festive 8 percent off', ended_on: '2026-09-30' }]);
});

test('get_price_and_schemes without a SKU lists only active schemes', () => {
  const ids = getPriceAndSchemes({}, TODAY).active_schemes.map((s) => s.id);
  assert.ok(ids.includes('SCH-ZIP-10P1'));
  assert.ok(!ids.includes('SCH-BW-FESTIVE'));
});

test('get_price_and_schemes rejects unknown SKUs instead of inventing data', () => {
  assert.match(getPriceAndSchemes({ sku: 'NOPE-1' }, TODAY).error, /Unknown SKU/);
});

test('check_availability reports in, low and out of stock with alternatives', () => {
  assert.equal(checkAvailability({ sku: 'NDL-MAS-70' }).status, 'in_stock');
  assert.equal(checkAvailability({ sku: 'NDL-MAS-70' }).alternatives, undefined);

  const low = checkAvailability({ sku: 'TEA-PRM-1KG' });
  assert.equal(low.status, 'low_stock');
  assert.equal(low.cases_available, 1);

  const out = checkAvailability({ sku: 'NDL-ATT-280' });
  assert.equal(out.status, 'out_of_stock');
  assert.deepEqual(out.alternatives.map((a) => a.sku), ['NDL-MAS-70']);
});

test('record_order_interest validates and normalises input', () => {
  const captured = emptyCaptured();
  assert.equal(recordOrderInterest(captured, { sku: 'NDL-MAS-70', quantity: 0, unit: 'cases' }).ok, false);
  assert.equal(recordOrderInterest(captured, { sku: 'NDL-MAS-70', quantity: 2.5, unit: 'cases' }).ok, false);
  assert.equal(recordOrderInterest(captured, { sku: 'NDL-MAS-70', quantity: 2, unit: 'litres' }).ok, false);
  assert.equal(recordOrderInterest(captured, { sku: 'XXX', quantity: 2, unit: 'cases' }).ok, false);

  const res = recordOrderInterest(captured, { sku: 'ndl-mas-70', quantity: 10, unit: 'case' });
  assert.equal(res.ok, true);
  assert.equal(res.readback, '10 cases of Zippy Masala Noodles 70 g');
  assert.equal(res.recorded.total_units, 960);
  assert.equal(res.recorded.estimated_value, 12240);
  assert.equal(captured.orders.length, 1);
});

test('record_order_interest replaces quantity for a repeated SKU', () => {
  const captured = emptyCaptured();
  recordOrderInterest(captured, { sku: 'NDL-MAS-70', quantity: 10, unit: 'cases' });
  recordOrderInterest(captured, { sku: 'NDL-MAS-70', quantity: 12, unit: 'cases' });
  assert.equal(captured.orders.length, 1);
  assert.equal(captured.orders[0].quantity, 12);
});

test('record_order_interest refuses out-of-stock items and flags short stock', () => {
  const captured = emptyCaptured();
  const out = recordOrderInterest(captured, { sku: 'NDL-ATT-280', quantity: 2, unit: 'cases' });
  assert.equal(out.ok, false);
  assert.ok(out.alternatives.length > 0);
  assert.equal(captured.orders.length, 0);

  const short = recordOrderInterest(captured, { sku: 'TEA-PRM-1KG', quantity: 3, unit: 'cases' });
  assert.equal(short.ok, true);
  assert.match(short.note, /Only 20 units/);
});

test('record_followup requires details and timing', () => {
  const captured = emptyCaptured();
  assert.equal(recordFollowup(captured, { type: 'callback', details: 'Call back', when: '' }).ok, false);
  const res = recordFollowup(captured, { type: 'weird', details: 'Share new price list', when: 'Monday morning' });
  assert.equal(res.ok, true);
  assert.equal(res.recorded.type, 'other');
  assert.equal(captured.followups.length, 1);
});

test('runTool dispatches, tracks schemes and never throws', () => {
  const captured = emptyCaptured();
  runTool('get_price_and_schemes', { sku: 'DET-LIQ-1L' }, { captured, today: TODAY });
  assert.deepEqual(captured.schemes_discussed, [{ id: 'SCH-BW-FESTIVE', name: 'BrightWash festive 8 percent off', status: 'expired' }]);
  assert.match(runTool('delete_everything', {}, { captured }).error, /Unknown tool/);
});
