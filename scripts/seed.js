// Fills the history with a week of demo calls so the dashboard has something
// to show. Each call runs through the real agent loop, tools, pricing and
// summariser with the MockLLM; only the timestamps are moved back in time.
//   npm run seed            add the demo calls
//   npm run seed -- --reset clear saved interactions first
import { rm } from 'node:fs/promises';
import { config } from '../server/config.js';
import { createAgent } from '../server/services/agent.js';
import { createSessionStore } from '../server/services/sessionStore.js';
import { createInteractionRepo } from '../server/store/interactionRepo.js';
import { createMockLLM } from '../server/llm/mock.js';
import { findRetailer } from '../server/tools/catalog.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const CALLS = [
  { retailer: 'R001', daysAgo: 6, lines: ["What's the rate of Chai Raja tea 250 gram?", 'Send 2 cases of Chai Raja 250 gram', 'Yes', "That's all, thanks"] },
  { retailer: 'R002', daysAgo: 5, lines: ['Price of Brewly instant coffee?', 'Send 3 cases of Brewly coffee', 'Yes', 'Send me the price list tomorrow morning', 'Bye'] },
  { retailer: 'R003', daysAgo: 5, lines: ['Do you have SilkLeaf shampoo 340 ml?', 'OK, 1 case of SilkLeaf shampoo 180 ml', 'Yes', 'Call me back on Saturday morning', "That's all"] },
  { retailer: 'R004', daysAgo: 3, lines: ['Any offers this week?', 'Send 2 cases of Neela sandal soap', 'Yes', 'Add 1 case of Neela neem soap', 'Yes', "What's my total?", 'Bye'] },
  { retailer: 'R001', daysAgo: 2, lines: ['Send 12 cases of Crunchies glucose biscuits', 'Yes', 'Also 10 cases of Zippy masala noodles', 'Yes', 'Bye'] },
  { retailer: 'R002', daysAgo: 2, lines: ['Any offer on BrightWash detergent powder?', 'Please visit my shop next week', 'Bye'] },
  { retailer: 'R003', daysAgo: 0, lines: ['Who will win the cricket match?', 'No thanks, bye'] },
];

const shift = (iso, ms) => new Date(new Date(iso).getTime() - ms).toISOString();

async function main() {
  if (process.argv.includes('--reset')) await rm(config.interactionsFile, { force: true });
  const repo = createInteractionRepo(config.interactionsFile);

  for (const { retailer: id, daysAgo, lines } of CALLS) {
    const offset = daysAgo * DAY_MS + 2 * 60 * 60 * 1000; // a couple of hours before now, N days back
    const backdated = {
      list: repo.list,
      get: repo.get,
      save: (i) =>
        repo.save({
          ...i,
          startedAt: shift(i.startedAt, offset),
          endedAt: shift(i.endedAt, offset),
          durationSeconds: 45 + lines.length * 20, // a realistic talk time instead of milliseconds
          transcript: i.transcript.map((t) => ({ ...t, at: shift(t.at, offset) })),
        }),
    };
    const agent = createAgent({ llm: createMockLLM(), sessions: createSessionStore({ ttlMs: 60_000 }), repo: backdated });
    const session = await agent.startConversation(findRetailer(id));
    for (const line of lines) await agent.reply(session, line);
    const saved = await agent.endConversation(session);
    console.log(`${saved.retailer.store_name.padEnd(26)} ${saved.summary.outcome.padEnd(20)} net ₹${saved.quote.net_value.toLocaleString('en-IN')}`);
  }
  console.log(`\nSaved ${CALLS.length} demo calls to ${config.interactionsFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
