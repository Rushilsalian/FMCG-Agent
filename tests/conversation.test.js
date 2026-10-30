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
import { describeRateLimit } from '../server/llm/gemini.js';

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
  assert.match(recorded.reply, /Zippy 10 plus 1 you get 1 case/, 'the agent mentions the scheme from the quote');
  assert.deepEqual(recorded.toolsUsed.map((t) => t.name), ['record_order_interest'], 'the quote comes back with the recording, no extra round trip');
  assert.ok(recorded.toolsUsed.every((t) => typeof t.result === 'string'), 'each tool call carries a trace line');
  assert.deepEqual(recorded.captured.orders.map((o) => [o.sku, o.quantity, o.unit]), [['NDL-MAS-70', 10, 'cases']]);
  assert.equal(recorded.quote.net_value, 12240);
  assert.equal(recorded.quote.free_goods[0].cases, 1);

  const total = await say("What's my total?");
  assert.match(total.reply, /comes to ₹12,240/);

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
  assert.equal(interaction.transcript.length, 1 + 2 * 8); // greeting + 8 exchanges
  assert.equal(interaction.quote.net_value, 12240);
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

test('rate limits: a daily quota says so without Retry, a per-minute one offers Retry', async () => {
  // The error Gemini returns when the free daily quota is used up (trimmed).
  const daily = Object.assign(new Error(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', details: [
    { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
    { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '11779s' },
  ] } })), { status: 429 });
  assert.deepEqual(describeRateLimit(daily), { scope: 'day', retryAfterSeconds: 11779 });
  const perMinute = Object.assign(new Error('{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier","retryDelay":"42.5s"}'), { status: 429 });
  assert.deepEqual(describeRateLimit(perMinute), { scope: 'minute', retryAfterSeconds: 43 });

  let failWith = daily;
  const limited = { ...createMockLLM(), async generate() { failWith.rateLimit = describeRateLimit(failWith); throw failWith; } };
  const limitedServer = createApp({ llm: limited, repo }).listen(0);
  await new Promise((resolve) => limitedServer.once('listening', resolve));
  const url = `http://localhost:${limitedServer.address().port}/api`;
  const send = async (path, body) => {
    const res = await fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  try {
    const { body: { sessionId } } = await send('/sessions', { retailerId: 'R002' });
    const day = await send(`/sessions/${sessionId}/messages`, { text: 'Price of Brewly coffee?' });
    assert.equal(day.status, 503);
    assert.equal(day.body.retryable, false);
    assert.match(day.body.error, /free daily quota \(it resets in about 3 h 16 min\)/);

    failWith = perMinute;
    const minute = await send(`/sessions/${sessionId}/messages`, { text: 'Price of Brewly coffee?' });
    assert.equal(minute.body.retryable, true);
    assert.match(minute.body.error, /per-minute limit\). Please wait 43 s/);
  } finally {
    limitedServer.close();
  }
});

test('the next call to the same retailer remembers the last one', async () => {
  const retailers = await get('/retailers');
  const sharma = retailers.body.find((r) => r.id === 'R001');
  assert.equal(sharma.calls, 1);
  assert.equal(sharma.last_call.outcome, 'order_enquiry');

  const again = await post('/sessions', { retailerId: 'R001' });
  assert.match(again.body.reply, /calling back as you asked/, 'the callback promised last time is acknowledged');
  assert.equal(again.body.previousCall.products[0].sku, 'NDL-MAS-70');

  const fresh = await post('/sessions', { retailerId: 'R004' });
  assert.equal(fresh.body.previousCall, null);
  assert.doesNotMatch(fresh.body.reply, /last time/i);
});

test('dashboard stats, CSV export and catalogue', async () => {
  const stats = await get('/interactions/stats');
  assert.equal(stats.status, 200);
  assert.equal(stats.body.total_calls, 1);
  assert.equal(stats.body.pipeline_value, 12240);
  assert.equal(stats.body.top_products[0].sku, 'NDL-MAS-70');

  const csv = await fetch(`${base}/interactions/export.csv`);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  const lines = (await csv.text()).trim().split('\r\n');
  assert.equal(lines.length, 2);
  assert.match(lines[1], /Sharma General Store/);

  const catalog = await get('/catalog');
  assert.equal(catalog.body.length, 15);
  const atta = catalog.body.find((p) => p.sku === 'NDL-ATT-280');
  assert.equal(atta.stock_status, 'out_of_stock');
  assert.ok(catalog.body.find((p) => p.sku === 'NDL-MAS-70').active_schemes.some((s) => s.id === 'SCH-ZIP-10P1'));
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
