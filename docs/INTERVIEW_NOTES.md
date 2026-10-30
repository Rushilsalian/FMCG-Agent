# Interview notes

## 1. Approach

I built it in six milestones, each committed and tested before the next:

1. **Data + tools + tests**: product, scheme and retailer JSON, plus pure functions for search, price/schemes, availability and capture. Everything the agent says is grounded here, so it came first and is unit-tested.
2. **Agent + API**: a provider-neutral LLM interface (Gemini + MockLLM), the server-side tool-call loop and session API.
3. **Text UI**: the full conversation works without voice. Voice is a layer on top, not a dependency.
4. **Voice**: Web Speech recognition and synthesis in one module that absorbs browser quirks.
5. **Summary + history**: structured summary, validation, fallback, JSON repository, history screens.
6. **Docs**.

The guiding principle: **the LLM handles language; code handles facts.**

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

## 3. Trade-offs I made on purpose

- **Browser Web Speech vs. a streaming STT/TTS service**: zero cost, zero keys, works on localhost. But it's Chrome/Edge-centric, Chrome sends audio to Google, there's no true barge-in (I pause the mic while the agent speaks to avoid echo), and voice quality varies by OS. In production I'd use streaming STT/TTS over WebRTC or telephony.
- **Request/response, not streaming**: simpler to build and explain. The cost is latency: a turn with two tool steps takes about 3–8 s on the free tier. Streaming the final text into TTS would make it feel faster.
- **In-memory sessions**: simple, but lost on restart and single-instance only. Redis would fix both.
- **Keyword MockLLM**: deterministic and good for tests, but it isn't a language model. It only understands the phrasings in the demo and tests.
- **"Schemes discussed" = schemes returned by `get_price_and_schemes`**: a cheap, deterministic proxy. It may include a scheme the model fetched but didn't mention.
- **Order *enquiry*, not order**: no pricing engine applies schemes to the total, and nothing reaches an ERP. The agent says the sales team will confirm.

## 4. Likely questions and answers

**How do you stop the model from hallucinating prices or stock?**
Three layers. (1) The system prompt forbids stating any price, stock or scheme that didn't come from a tool in this conversation. (2) The prompt holds no prices or stock, so there's nothing to misremember. (3) Tools return explicit errors for unknown SKUs, and the summary takes facts from captured data, not model text. What's left is the model paraphrasing a tool result wrongly. You'd catch that with evals that compare numbers in replies against tool outputs.

**Walk me through one turn.**
Browser → `POST /api/sessions/:id/messages {text}` → agent appends the user message → `llm.generate(system, history, tools)` → if it returns tool calls, run each with `runTool`, append the results, and call the model again (at most 5 rounds) → final text → strip markdown/emojis → update the transcript → respond `{reply, captured, toolsUsed}` → browser shows the reply, speaks it, and updates the panel.

**What if Gemini is down or rate-limited?**
One quick retry on 5xx, a 15 s timeout, no retry on 429 (a per-minute quota won't clear in a second). The route returns `503 {retryable: true}` with a friendly message, the turn is rolled back, and the UI shows **Retry**. The summary falls back to rules.

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

**What would you do next?**
Streaming replies, real barge-in, schemes applied to an order total, a CRM/ERP push of order enquiries, an analytics dashboard (conversion by scheme), an eval suite, Redis sessions, and auth.

**What did you learn building it?**
Model availability changes quickly. The first default model I picked (`gemini-2.5-flash`) is no longer available to new keys. The free tier limited this key to 5 requests/minute and 20/day, and live testing hit both limits. In those runs the rollback and Retry path and the rule-based summary fallback both worked as designed. That's why the model name is an env var, the mock provider exists, failures degrade gracefully, and I cut one tool round trip per turn.
