import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteOrder } from '../server/tools/pricing.js';
import { emptyCaptured, recordOrderInterest } from '../server/tools/capture.js';
import { runTool } from '../server/tools/index.js';

// A date inside every scheme's window except the expired BrightWash festive offer.
const TODAY = '2026-11-15';

function ordersOf(...lines) {
  const captured = emptyCaptured();
  for (const [sku, quantity, unit = 'cases'] of lines) recordOrderInterest(captured, { sku, quantity, unit });
  return captured.orders;
}

test('an empty order quotes zero and says so', () => {
  const quote = quoteOrder([], TODAY);
  assert.equal(quote.net_value, 0);
  assert.deepEqual([quote.discounts, quote.free_goods, quote.nudges], [[], [], []]);
  assert.match(quote.message, /No order/);
});

test('buy-x-get-y gives free cases per full block and nudges when close', () => {
  const quote = quoteOrder(ordersOf(['NDL-MAS-70', 21]), TODAY);
  assert.equal(quote.gross_value, 21 * 96 * 12.75);
  assert.equal(quote.free_goods[0].cases, 2);
  assert.equal(quote.free_goods[0].value, 2 * 96 * 12.75);
  assert.equal(quote.net_value, quote.gross_value, 'free goods do not reduce the bill');
  assert.equal(quote.total_savings, quote.free_goods[0].value);

  const close = quoteOrder(ordersOf(['NDL-MAS-70', 8]), TODAY);
  assert.equal(close.free_goods.length, 0);
  assert.match(close.nudges[0].message, /Add 2 cases/);
  assert.equal(quoteOrder(ordersOf(['NDL-MAS-70', 2]), TODAY).nudges.length, 0, 'too far away to nudge');
});

test('buy-x-get-y pools cases across the scheme SKUs', () => {
  const quote = quoteOrder(ordersOf(['BIS-GLU-100', 6], ['BIS-BOU-150', 6]), TODAY);
  assert.equal(quote.free_goods[0].sku, 'BIS-GLU-100');
  assert.equal(quote.free_goods[0].cases, 1);
});

test('percent-off applies above the threshold and nudges just below it', () => {
  const above = quoteOrder(ordersOf(['TEA-PRM-250', 2]), TODAY); // 80 x 121 = 9,680
  assert.equal(above.discounts[0].scheme_id, 'SCH-CHAI-5PCT');
  assert.equal(above.discounts[0].amount, 484);
  assert.equal(above.net_value, 9680 - 484);

  const below = quoteOrder(ordersOf(['TEA-PRM-250', 1]), TODAY); // 4,840
  assert.equal(below.discounts.length, 0);
  assert.match(below.nudges[0].message, /Add ₹160 more/);
});

test('combo discounts once all parts are ordered, else says what is missing', () => {
  const full = quoteOrder(ordersOf(['SOP-SAN-100', 2], ['SOP-NEM-4X100', 1]), TODAY);
  assert.equal(full.total_discount, 300);

  const partial = quoteOrder(ordersOf(['SOP-SAN-100', 2]), TODAY);
  assert.match(partial.nudges[0].message, /Add 1 case of Neela Neem Soap/);
});

test('expired schemes are never applied, and units count as whole cases', () => {
  const expired = quoteOrder(ordersOf(['DET-PWD-1KG', 5]), TODAY); // ₹11,280, festive offer ended
  assert.equal(expired.discounts.length, 0);
  assert.equal(expired.net_value, 11280);

  const units = quoteOrder(ordersOf(['NDL-MAS-70', 959, 'units']), TODAY); // just under 10 cases
  assert.equal(units.free_goods.length, 0);
});

test('quote_order tool prices the captured order', () => {
  const captured = emptyCaptured();
  recordOrderInterest(captured, { sku: 'NDL-MAS-70', quantity: 10, unit: 'cases' });
  const result = runTool('quote_order', {}, { captured, today: TODAY });
  assert.equal(result.free_goods[0].scheme_id, 'SCH-ZIP-10P1');
  assert.equal(result.net_value, 12240);
});
