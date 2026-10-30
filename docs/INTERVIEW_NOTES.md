# Interview notes

## 1. Approach

I built it in six milestones, each committed and tested before the next:

1. **Data + tools + tests**: product, scheme and retailer JSON, plus pure functions for search, price/schemes, availability and capture. Everything the agent says is grounded here, so it came first and is unit-tested.
2. **Agent + API**: a provider-neutral LLM interface (Gemini + MockLLM), the server-side tool-call loop and session API.
3. **Text UI**: the full conversation works without voice. Voice is a layer on top, not a dependency.
4. **Voice**: Web Speech recognition and synthesis in one module that absorbs browser quirks.
5. **Summary + history**: structured summary, validation, fallback, JSON repository, history screens.
6. **Docs**.
7. **Business depth + product polish**:
   - a scheme **pricing engine** and `quote_order` tool, so totals, discounts, free cases and "you're 2 cases short" nudges are computed in code;
   - **memory across calls** (the agent knows the retailer's last outcome, order and promised follow-ups);
   - an **analytics dashboard** and CSV export;
   - a **product catalogue** view;
   - an **agent trace** per reply (tool, arguments, result, latency);
   - context-aware **suggestion chips**;
   - a responsive redesign with **dark mode**;
   - a seed script that drives the real agent.

The guiding principle: **the LLM handles language; code handles facts.** Milestone 7 extends it from prices and stock to *money*: the model never adds up a bill.

## 2. Key design decisions

| Decision | Why |
|---|---|
| **Server runs the tool loop**, browser only sends text | The API key stays server-side, tools can't be tampered with from the client, and the browser stays a thin I/O layer. |
| **All facts via tools; tools return data or explicit errors** | The model can't invent a price if it never had to remember one. Unknown SKUs return `{error}` so the model asks or searches instead of guessing. |
| **Tools never throw** (`runTool` catches) | A tool bug becomes a message the model can recover from, not a 500. |
| **Order confirmation in the prompt and data checks in code** | The prompt makes the agent read the order back and wait for "yes". Code enforces what code can: integer quantity of at least 1, unit normalisation, known SKU, out-of-stock refusal, one line per SKU. |
| **Summary = LLM narrative + captured facts** | The LLM writes overview, sentiment and next action. Products, follow-ups and schemes are copied from captured tool data, so the CRM never gets a hallucinated quantity. The outcome is reconciled: if an order was captured, it's `order_enquiry`, whatever the model said. |
| **Rule-based summary fallback** | If the LLM fails or returns something invalid, a deterministic summary is saved instead. A call is never lost. |
| **Provider-neutral message history** (`user` / `assistant` / `tool`) | Gemini and MockLLM share one interface, so switching providers means writing one adapter. The Gemini adapter replays the model's original `content` so thought signatures survive multi-step tool calls. |
| **MockLLM drives the real tools** | The end-to-end test exercises the real agent loop, tools, API and storage with no network, and the app can be demoed with no key. |
| **Turn rollback on failure** | History and captured state are snapshotted before each turn and restored if the LLM call fails, so **Retry** never duplicates an order. |
| **Product names/SKUs in the system prompt** | Saves the `search_products` round trip on most turns: lower latency, and fewer requests against the free-tier rate limit. Prices and stock are deliberately left out so they can't go stale in the prompt. |
| **Repository module over a JSON file** | `list / get / save` is the whole contract, with serialised writes and atomic rename. Swapping in SQLite or Postgres touches one file. |
| **Express app factory (`createApp({ llm, repo })`)** | Dependency injection without a framework. Tests pass a mock LLM and a temp file. |
| **Scheme pricing engine in code (`tools/pricing.js`) behind a `quote_order` tool** | LLMs are bad at arithmetic, and a wrong total is the most damaging mistake a sales agent can make. Schemes now carry machine-readable `terms` (buy X get Y, % off above a value, combo ₹ off). A pure function prices the captured order: gross, discounts, free cases, net, savings. The agent quotes the result. |
| **Nudges, not just discounts** | The engine also reports how close the retailer is to the *next* offer (within 3 cases, or 40% of a value threshold): "Add 2 cases to get 1 case free". That's how a good rep upsells. Because code computes it, the agent never invents an offer. |
| **Free goods don't reduce the bill** | Net value = gross − money discounts. Free cases are reported as savings, separately. That matches how FMCG trade schemes are accounted for, and the pipeline value stays honest. |
| **Memory = a recap of the last saved interaction** | On start, the agent reads the retailer's latest interaction from the repository. It puts the outcome, products (with SKUs) and promised follow-ups in the system prompt, and a code-written greeting acknowledges them. There's no vector store: for "what happened last time" the structured summary is exact and cheap. |
| **Greeting written by code** | Instant, costs no LLM request, and is predictable. It can still reference memory ("calling back as you asked"). |
| **Agent trace returned with every reply** | `toolsUsed` includes each tool's arguments and a one-line result. With `llmCalls` and `latencyMs`, that makes the agent's reasoning auditable in the UI, which is the first thing you need when debugging an LLM in production. |
| **Analytics as pure functions over saved interactions** (`services/analytics.js`) | The same numbers feed the dashboard, the tests and the CSV export. No second source of truth. |
| **Seed data generated by the real agent** | `npm run seed` runs scripted retailer lines through the actual agent, tools, pricing and summariser (MockLLM). Only the timestamps are back-dated. So the demo dashboard exercises real code paths, not hand-written JSON. |
| **Vanilla JS front end, split into modules** | `app.js` (call flow and voice), `views.js` (dashboard, history, summary, catalogue), `charts.js` (dependency-free HTML charts), `ui.js` (DOM builder, formatters, icons, toasts). No build step, and `textContent` everywhere, so model text can't inject HTML. |
| **Charts built to a data-viz checklist** | One axis, thin bars with rounded data ends, a validated colour-blind-safe palette for light *and* dark mode, a legend with counts (identity never by colour alone), tooltips on hover and keyboard focus, and a **View data** table under every chart. |

## 3. Trade-offs I made on purpose

- **Browser Web Speech vs. a streaming STT/TTS service**: zero cost, zero keys, works on localhost. But it's Chrome/Edge-centric, Chrome sends audio to Google, there's no true barge-in (I pause the mic while the agent speaks to avoid echo), and voice quality varies by OS. In production I'd use streaming STT/TTS over WebRTC or telephony.
- **Request/response, not streaming**: simpler to build and explain. The cost is latency: a turn with two tool steps takes about 3–8 s on the free tier. Streaming the final text into TTS would make it feel faster.
- **In-memory sessions**: simple, but lost on restart and single-instance only. Redis would fix both.
- **Keyword MockLLM**: deterministic and good for tests, but it isn't a language model. It only understands the phrasings in the demo and tests.
- **"Schemes discussed" = schemes returned by `get_price_and_schemes`**: a cheap, deterministic proxy. It may include a scheme the model fetched but didn't mention.
- **Order *enquiry*, not order**: schemes are priced, but nothing reaches an ERP, and credit limits, taxes and delivery slots aren't modelled. The agent says the sales team will confirm.
- **Simple scheme rules**: three scheme types, each scheme applied independently, with no stacking rules or caps. Real trade promotions need a rules engine with priorities and exclusions. The `rules` map in `pricing.js` is where that would grow.
- **Memory is "last call only"**: enough for continuity ("calling back as promised"), cheap, and exact. A long-running relationship would need a retailer profile (purchase history, preferred SKUs, credit), not more transcript.
- **Dashboard reads the whole JSON file**: fine for hundreds of calls. With a database these become SQL aggregates, and `computeStats` is the spec for them.
- **Follow-ups aren't "closed"**: the dashboard shows *recent* follow-ups, not open ones, because there's no task status yet. That would be the next CRM feature.

## 4. Likely questions and answers

**How do you stop the model from hallucinating prices or stock?**
Three layers. (1) The system prompt forbids stating any price, stock or scheme that didn't come from a tool in this conversation. (2) The prompt holds no prices or stock, so there's nothing to misremember. (3) Tools return explicit errors for unknown SKUs, and the summary takes facts from captured data, not model text. What's left is the model paraphrasing a tool result wrongly. You'd catch that with evals that compare numbers in replies against tool outputs.

**Walk me through one turn.**
Browser → `POST /api/sessions/:id/messages {text}` → agent appends the user message → `llm.generate(system, history, tools)` → if it returns tool calls, run each with `runTool`, append the results, and call the model again (at most 5 rounds) → final text → strip markdown/emojis → update the transcript → respond `{reply, captured, quote, toolsUsed, llmCalls, latencyMs}` → browser shows the reply with its trace chip, speaks it, re-prices the **Live order** panel and refreshes the suggestion chips.

**How do you make sure the totals and discounts are right?**
The model never computes them. `quote_order` calls a pure function, `quoteOrder(orders, today)`, over the captured order lines and the schemes' structured `terms`. It returns gross, discounts, free cases, net, savings and nudges, and the prompt says "never add up prices yourself". `record_order_interest` also returns the updated quote, so confirming an order costs one LLM round trip less. The function is unit-tested per scheme type, including thresholds, pooling cases across SKUs, expired schemes and units versus whole cases. The same quote is saved with the interaction and summed into the dashboard pipeline. The prompt doesn't even contain prices, so there's nothing for the model to do arithmetic on.

**Why "nudges"? Isn't that just upselling?**
Yes. That's the business value of a sales rep. A retailer who orders 8 cases of Zippy doesn't know that 2 more gets a free case. Telling them is good for both sides. Because nudges come from code with tight limits (≤ 3 cases, or ≤ 40% of a threshold), the agent only suggests offers that exist and are within reach. It never pressures with made-up deals.

**How does the agent remember the last call?**
`startConversation` reads the retailer's latest saved interaction (`repo.list()` is newest first). It builds a recap from the *structured summary*: outcome, overview, products with SKUs, follow-ups and next action. That recap goes in the system prompt, and the code-written greeting references it. Because it's structured data, "repeat my last order" works with exact SKUs. At scale this would be a retailer profile table, not a scan.

**What does the dashboard tell a sales manager?**
Pipeline value (net of offers), conversion rate, calls per day, outcome mix, top products by enquiry value, recent follow-ups, and which tools the agent used. That last chart is a cheap health check: if `search_products` dominates, the prompt's product list isn't working. If `quote_order` never appears, the agent isn't quoting totals. All of it comes from one pure function, which is tested and also feeds the CSV export.

**What if Gemini is down or rate-limited?**
One quick retry on 5xx, a 15 s timeout, no retry on 429 (a quota won't clear in a second). The Gemini adapter reads the 429 body: `QuotaFailure.quotaId` says whether the per-minute or the per-day quota ran out, and `RetryInfo.retryDelay` says when it resets. Per-minute: `503 {retryable: true}`, "wait 43 s", and a **Retry** button. Per-day: `retryable: false`, "daily quota, resets in about 3 h 16 min", plus the ways out (another model, a paid key, the mock). Either way the turn is rolled back and the summary falls back to rules.

**Why confirm before recording?**
Speech recognition mishears numbers ("15" vs "50"). A read-back is what a human rep does, and it puts the retailer in control. Recording is also idempotent per SKU, so a correction replaces the quantity instead of adding a second line.

**How would you scale to 10,000 SKUs?**
Drop the product list from the prompt and rely on `search_products`, backed by a real search index (Postgres full-text, or embeddings for "the blue soap"). Return the top 5 with disambiguating attributes.

**How would this work over a real phone call?**
Replace the browser voice layer with telephony (Twilio, Exotel) plus streaming STT/TTS, or a realtime speech model. The agent, tools, summary and storage stay the same, because the agent only deals in text turns.

**How would you test the LLM's behaviour, not just the code?**
A scripted eval set: price, expired scheme, out of stock, ambiguous pack size, order with correction, off-topic, Hinglish. Run it against the real model. Assert on tool calls made (e.g. no `record_order_interest` before a "yes"), on numbers in replies matching tool results, and on reply length. Track pass rate per prompt or model version.

**Security?**
The key lives only in `.env` on the server. Input is length-limited and validated. Rendering uses `textContent`, so model or user text can't inject HTML. IDs are validated. Off-topic prompts are steered back. Missing for production: auth, rate limiting per user, PII handling for transcripts, and audit logs.

**Multilingual (Hindi, Hinglish)?**
Recognition and synthesis take a language code (`hi-IN`), and Gemini handles Hinglish well. I'd add a language switch per retailer and test the TTS voices. The tools are language-agnostic.

**How did you make the UI work on a phone?**
A field rep would use this on a phone, so the layout is mobile-first in its breakpoints:
- the sidebar becomes a bottom tab bar, and hides during a live call to give the transcript room;
- the live order panel becomes a slide-over drawer, opened by an **Order · ₹…** button;
- suggestion chips scroll horizontally;
- history rows turn into cards.

Touches that help both phone and desktop:
- `100dvh` heights so the composer stays above the mobile browser bar, and safe-area insets for notched phones;
- reduced-motion support;
- keyboard shortcuts on desktop (**Space** to talk, **Esc** to stop);
- a print stylesheet for the summary.

**What would you do next?**
- Streaming replies and real barge-in.
- A CRM/ERP push of order enquiries, plus follow-up tasks with status (open/done) and reminders.
- Scheme stacking rules, taxes and credit limits in the pricing engine.
- Conversion by scheme on the dashboard (which offers actually close orders).
- An LLM eval suite, Redis sessions and auth.

**What did you learn building it?**
Model availability changes quickly. The first default model I picked (`gemini-2.5-flash`) is no longer available to new keys. The free tier limited this key to 5 requests/minute and 20/day, and live testing hit both limits. In those runs the rollback and Retry path and the rule-based summary fallback both worked as designed. That's why the model name is an env var, the mock provider exists, failures degrade gracefully, and I cut one tool round trip per turn.
