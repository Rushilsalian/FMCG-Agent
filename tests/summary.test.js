import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateSummary } from '../server/services/summarySchema.js';
import { summarize } from '../server/services/summarizer.js';
import { createInteractionRepo } from '../server/store/interactionRepo.js';
import { emptyCaptured, recordOrderInterest, recordFollowup } from '../server/tools/capture.js';
import { createMockLLM } from '../server/llm/mock.js';

const retailer = { id: 'R001', store_name: 'Sharma General Store', owner: 'Ramesh Sharma', area: 'Andheri East, Mumbai' };
const transcript = [
  { role: 'agent', text: 'Namaste Ramesh ji.' },
  { role: 'retailer', text: 'Send 10 cases of Zippy masala.' },
];

const validSummary = () => ({
  overview: 'Retailer asked for Zippy noodles.',
  outcome: 'order_enquiry',
  products: [{ sku: 'NDL-MAS-70', name: 'Zippy Masala Noodles 70 g', quantity: 10, unit: 'cases' }],
  schemes_discussed: [{ id: 'SCH-ZIP-10P1', name: 'Zippy 10 plus 1', status: 'active' }],
  followups: [{ type: 'callback', details: 'Call about stock', when: 'Friday' }],
  sentiment: 'positive',
  next_action: 'Confirm dispatch.',
});

function capturedWithOrder() {
  const captured = emptyCaptured();
  recordOrderInterest(captured, { sku: 'NDL-MAS-70', quantity: 10, unit: 'cases' });
  return captured;
}

// A stand-in LLM whose summary output we control.
const llmReturning = (narrative) => ({ name: 'stub', model: 'stub', generateJSON: async () => narrative });

test('validateSummary accepts a well-formed summary', () => {
  assert.deepEqual(validateSummary(validSummary()), []);
});

test('validateSummary reports each broken field', () => {
  const bad = { ...validSummary(), outcome: 'maybe', sentiment: 'happy', overview: '' };
  bad.products = [{ sku: 'X', name: 'Y', quantity: 0, unit: 'litres' }];
  bad.followups = [{ type: 'callback', details: 'x' }];
  const errors = validateSummary(bad);
  for (const field of ['outcome', 'sentiment', 'overview', 'products[0].quantity', 'products[0].unit', 'followups[0]']) {
    assert.ok(errors.some((e) => e.includes(field)), `expected an error about ${field}: ${errors}`);
  }
  assert.deepEqual(validateSummary(null), ['summary must be an object']);
});

test('summarize merges LLM narrative with captured facts', async () => {
  const captured = capturedWithOrder();
  const summary = await summarize({
    llm: llmReturning({ overview: 'Good call.', outcome: 'info_only', sentiment: 'positive', next_action: 'Confirm order.' }),
    retailer,
    transcript,
    captured,
  });
  assert.deepEqual(validateSummary(summary), []);
  assert.equal(summary.generated_by, 'llm');
  assert.equal(summary.overview, 'Good call.');
  // Captured facts win over the model's outcome guess.
  assert.equal(summary.outcome, 'order_enquiry');
  assert.deepEqual(summary.products, [{ sku: 'NDL-MAS-70', name: 'Zippy Masala Noodles 70 g', quantity: 10, unit: 'cases' }]);
});

test('summarize falls back to rules when the LLM output is invalid', async () => {
  const captured = emptyCaptured();
  recordFollowup(captured, { type: 'callback', details: 'Share price list', when: 'Monday' });
  const summary = await summarize({
    llm: llmReturning({ overview: '', outcome: 'whatever', sentiment: 'meh', next_action: '' }),
    retailer,
    transcript,
    captured,
  });
  assert.equal(summary.generated_by, 'rules');
  assert.equal(summary.outcome, 'follow_up_required');
  assert.match(summary.next_action, /Share price list \(Monday\)/);
  assert.deepEqual(validateSummary(summary), []);
});

test('summarize falls back to rules when the LLM throws (MockLLM)', async () => {
  const summary = await summarize({ llm: createMockLLM(), retailer, transcript, captured: emptyCaptured() });
  assert.equal(summary.generated_by, 'rules');
  assert.equal(summary.outcome, 'info_only');
  assert.deepEqual(validateSummary(summary), []);
});

test('interaction repository saves, lists newest first and gets by id', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fmcg-repo-'));
  try {
    const repo = createInteractionRepo(path.join(dir, 'interactions.json'));
    assert.deepEqual(await repo.list(), []);
    await Promise.all([
      repo.save({ id: 'a', startedAt: '2026-10-01T10:00:00Z' }),
      repo.save({ id: 'b', startedAt: '2026-10-02T10:00:00Z' }),
    ]);
    assert.deepEqual((await repo.list()).map((i) => i.id), ['b', 'a']);
    assert.equal((await repo.get('a')).id, 'a');
    assert.equal(await repo.get('missing'), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
