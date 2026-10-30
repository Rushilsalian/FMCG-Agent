// End-to-end: real Express app + agent loop + tools, with MockLLM in place
// of Gemini. Exercises the HTTP API exactly as the browser does.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createMockLLM } from '../server/llm/mock.js';
import { createInteractionRepo } from '../server/store/interactionRepo.js';
import { validateSummary } from '../server/services/summarySchema.js';

let server;
let base;
let tmpDir;
let repo;

before(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), 'fmcg-e2e-'));
  repo = createInteractionRepo(path.join(tmpDir, 'interactions.json'));
  server = createApp({ llm: createMockLLM(), repo }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://localhost:${server.address().port}/api`;
});
after(async () => {
  server.close();
  await rm(tmpDir, { recursive: true, force: true });
});

const get = async (p) => {
  const res = await fetch(base + p);
  return { status: res.status, body: await res.json() };
};

async function post(path, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test('full conversation: price, scheme, out-of-stock, order, follow-up', async () => {
  const start = await post('/sessions', { retailerId: 'R001' });
  assert.equal(start.status, 201);
  assert.match(start.body.reply, /Ramesh ji/);
  const say = async (text) => {
    const res = await post(`/sessions/${start.body.sessionId}/messages`, { text });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body;
  };

  const price = await say('What is the price of Chai Raja 250g?');
  assert.match(price.reply, /₹121/);
  assert.deepEqual(price.toolsUsed.map((t) => t.name), ['search_products', 'get_price_and_schemes']);

  const expired = await say('Any offer on BrightWash detergent powder?');
  assert.match(expired.reply, /ended on 30 September/);

  const out = await say('Do you have Zippy atta noodles in stock?');
  assert.match(out.reply, /out of stock/);
  assert.match(out.reply, /Zippy Masala Noodles/);

  const confirm = await say('I want 10 cases of Zippy masala noodles');
  assert.match(confirm.reply, /Just to confirm, 10 cases/);
  assert.equal(confirm.captured.orders.length, 0, 'nothing is recorded before the retailer confirms');

  const recorded = await say('Yes');
  assert.match(recorded.reply, /noted 10 cases of Zippy Masala Noodles/);
  assert.deepEqual(recorded.captured.orders.map((o) => [o.sku, o.quantity, o.unit]), [['NDL-MAS-70', 10, 'cases']]);

  const followup = await say('Please call me back on Friday after 4 pm');
  assert.match(followup.reply, /Friday after 4 pm/);
  assert.equal(followup.captured.followups[0].type, 'callback');
  assert.deepEqual(followup.captured.schemes_discussed.map((s) => s.id).sort(), ['SCH-BW-FESTIVE', 'SCH-CHAI-5PCT']);

  const offTopic = await say('Who will win the cricket match?');
  assert.match(offTopic.reply, /only help with our products/);

  // End: summary is valid, built from captured facts, and saved with the transcript.
  const end = await post(`/sessions/${start.body.sessionId}/end`, {});
  assert.equal(end.status, 200);
  const { interaction } = end.body;
  assert.deepEqual(validateSummary(interaction.summary), []);
  assert.equal(interaction.summary.outcome, 'order_enquiry');
  assert.deepEqual(interaction.summary.products, [{ sku: 'NDL-MAS-70', name: 'Zippy Masala Noodles 70 g', quantity: 10, unit: 'cases' }]);
  assert.equal(interaction.summary.followups[0].when, 'Friday after 4 pm');
  assert.equal(interaction.transcript.length, 1 + 2 * 7); // greeting + 7 exchanges
  assert.equal(interaction.retailer.owner, 'Ramesh Sharma');
  assert.ok(interaction.durationSeconds >= 0 && interaction.endedAt >= interaction.startedAt);

  // The session is closed, and the call shows up in history.
  assert.equal((await post(`/sessions/${start.body.sessionId}/messages`, { text: 'hello?' })).status, 404);
  const history = await get('/interactions');
  assert.equal(history.body[0].id, interaction.id);
  assert.equal(history.body[0].outcome, 'order_enquiry');
  const detail = await get(`/interactions/${interaction.id}`);
  assert.equal(detail.body.transcript.length, interaction.transcript.length);
  assert.equal((await get('/interactions/does-not-exist')).status, 404);
  assert.equal((await get('/interactions/bad%20id!')).status, 400);
});

test('API validates input', async () => {
  assert.equal((await post('/sessions', { retailerId: 'NOPE' })).status, 400);
  assert.equal((await post('/sessions/unknown-id/messages', { text: 'hi' })).status, 404);

  const { body } = await post('/sessions', { retailerId: 'R002' });
  assert.equal((await post(`/sessions/${body.sessionId}/messages`, { text: '   ' })).status, 400);
  assert.equal((await post(`/sessions/${body.sessionId}/messages`, { text: 'x'.repeat(501) })).status, 400);
});

test('a failed LLM call returns a retryable error and leaves the session clean', async () => {
  const llm = createMockLLM();
  const flaky = { ...llm, fail: true, async generate(args) { if (this.fail) throw new Error('network down'); return llm.generate(args); } };
  const flakyServer = createApp({ llm: flaky, repo }).listen(0);
  await new Promise((resolve) => flakyServer.once('listening', resolve));
  const url = `http://localhost:${flakyServer.address().port}/api`;
  const send = (path, body) =>
    fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  try {
    const { sessionId } = await (await send('/sessions', { retailerId: 'R001' })).json();
    const failed = await send(`/sessions/${sessionId}/messages`, { text: 'Price of Chai Raja 250g?' });
    assert.equal(failed.status, 503);
    assert.equal((await failed.json()).retryable, true);

    flaky.fail = false;
    const retried = await (await send(`/sessions/${sessionId}/messages`, { text: 'Price of Chai Raja 250g?' })).json();
    assert.match(retried.reply, /₹121/);
  } finally {
    flakyServer.close();
  }
});
