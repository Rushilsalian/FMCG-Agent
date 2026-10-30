# 5-minute demo script

**Setup (before the interview)**
- `npm run seed -- --reset`: loads a week of demo calls so the dashboard isn't empty. Each one runs through the real agent loop, tools, pricing engine and summariser (MockLLM). Only the timestamps are back-dated. Skip it if you'd rather show an empty state first.
- `npm start`, open **http://localhost:3000** in Chrome and allow the microphone once.
- Check the status pill (bottom-left on desktop, top-right on mobile): green `Gemini · <model>` (live) or amber `Offline MockLLM`.
- Free-tier Gemini quotas are tiny: we saw **5 requests/minute and 20/day** on `gemini-3.5-flash`. This demo uses about 20–25 requests, so **don't rehearse on the same key and model on demo day**. Use a paid key, or a model whose daily quota is untouched. If you hit the limit, the app shows a **Retry** button. As a fallback, run `npm run start:mock`: every line below also works offline (each was verified against the MockLLM).
- Retailer to use: **Sharma General Store** (Ramesh Sharma: biscuits, noodles, tea). After seeding it has a previous order, so the memory feature shows.
- Optional: have Chrome DevTools open on the device toolbar (iPhone 14) in a second window, for the responsive part.

| Time | You do / say | What to point out |
|---|---|---|
| 0:00 | Open the **Dashboard**. "This is an AI sales rep that calls kirana stores for an FMCG brand. Everything here comes from saved calls." | Hero **order pipeline** (net of scheme discounts), conversion, follow-ups, calls per day, outcome mix. **How the agent works** counts the tool calls the LLM made, so its answers come from data. Hover a bar for a tooltip; **View data** opens the table behind each chart. |
| 0:25 | Click **Catalogue**. | The sample business data the tools read: price, MRP, margin, stock status (icon and label), live schemes. Filter by *Noodles*: Zippy Atta is **out of stock**. |
| 0:40 | **New call** → **Sharma General Store** (the card shows *Last call 2 days ago · Order enquiry*) → **Start conversation**. | **Memory across calls**: the greeting mentions what Ramesh ji enquired about last time, and the blue *Asha remembers* banner shows the previous outcome and next action. That context is also in the system prompt. |
| 1:00 | Tap the mic (or press **Space**): **"What's the rate of Chai Raja tea 250 gram?"** | Live interim transcript. The reply gives MRP ₹140, your price ₹121, margin and the 5% scheme. Click the **2 tool calls · 3 LLM steps** chip under the reply: the **agent trace** shows each tool, its exact arguments and what it returned. |
| 1:25 | **"Any offer on BrightWash detergent powder?"** | Expired scheme: the festive offer *ended 30 September*, and the agent doesn't pretend it's still running. |
| 1:40 | **"Do you have Zippy atta noodles?"** | Out of stock: the agent offers the in-stock alternative, Zippy Masala Noodles. |
| 1:55 | **"Send 8 cases of Zippy masala noodles"**, then **"Yes"**. | Read-back and confirmation before anything is recorded. Then **"Tip: add 2 cases to get 1 case free"**: the pricing engine found that the retailer is 2 cases short of *Zippy 10 plus 1*. The tip also shows as a nudge in the **Live order** panel. |
| 2:20 | **"Send 10 cases of Zippy masala noodles"**, then **"Yes"**. | One line per SKU: the quantity is **replaced**, not duplicated. The agent says *"you get 1 case free"*. The panel shows gross ₹12,240 and the free case (worth ₹1,224) under the scheme name. The panel flashes when it changes. |
| 2:45 | Tap the **"What's my total?"** chip. | **Suggestion chips** adapt to the call (a *Yes* chip appears while an order waits for confirmation). The agent quotes **₹12,240, offers save you ₹1,224**. The model never adds numbers up; `quote_order` does. |
| 3:00 | Tap the mic *while the agent is speaking* and say **"Call me back on Friday after 4 pm."** | Tapping (or **Esc**) interrupts speech. The follow-up is recorded with the retailer's own timing. |
| 3:15 | Optional: tick **Hands-free** and say **"Who will win the cricket match?"** | The mic reopens by itself after each reply, and the waveform shows listening and speaking. The agent steers back to business. |
| 3:30 | **"That's all, thanks."** → **End & summarize**. | Summary card: outcome, mood, overview, **next action**, the **priced order breakdown**, follow-ups, schemes. **Copy**, **JSON** and **Print** for the CRM. Expand **Summary JSON**. |
| 3:55 | **Dashboard** → **History**. | The pipeline and charts include the new call. In History: search ("Zippy"), filter by outcome, open a call to see the full transcript with tool chips and per-turn latency. Click **Export CSV**. |
| 4:20 | Toggle the **moon/sun** button; switch to the DevTools phone view. | Dark mode is its own palette, saved per browser. On a phone the sidebar becomes a bottom tab bar, history rows become cards, and in a call the **Order · ₹…** button opens the live order as a slide-over drawer. |

**If something goes wrong on stage**
- Mic blocked or not working: a yellow banner appears. Say "voice is optional, the text box and chips always work" and continue by typing or tapping chips.
- "Too many requests" error: wait about 10 seconds and press **Retry**. The turn was rolled back, so nothing is lost or duplicated.
- The agent asks a clarifying question (e.g. "1 kg powder or 1 litre liquid?"): that's intended behaviour. Answer it.
- Dashboard empty: run `npm run seed` and refresh, or say "let's make the first call" and come back to it at the end.
- Live Gemini phrases things differently from this script, or makes a different tool choice: that's expected. Open the trace chip to show *why* it answered as it did.
