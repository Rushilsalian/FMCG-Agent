# 3-minute demo script

**Setup (before the interview)**
- `npm start`, open **http://localhost:3000** in Chrome and allow the microphone once.
- Check the badge at top right: `Gemini · <model>` (live) or `Offline MockLLM`.
- Free-tier Gemini quotas are tiny: we saw **5 requests/minute and 20/day** on `gemini-3.5-flash`. This demo uses about 15–20 requests, so **don't rehearse on the same key and model on demo day**. Use a paid key, or a model whose daily quota is untouched. If you hit the limit, the app shows a **Retry** button. As a fallback, run `npm run start:mock`: every line below also works offline.
- Retailer to use: **Sharma General Store** (Ramesh Sharma: biscuits, noodles, tea).

| Time | You do / say | What to point out |
|---|---|---|
| 0:00 | "This is an AI sales rep that calls kirana stores for an FMCG brand. Prices, stock and schemes all come from tools over our data, never from the model's memory." Click **Sharma General Store**, then **Start conversation**. | The agent greets *Ramesh ji* by name and speaks aloud. The mic button turns green (speaking). |
| 0:20 | Tap the mic: **"What's the rate of Chai Raja tea 250 gram?"** | Live interim transcript while you talk. The reply gives MRP ₹140, your price ₹121, margin and the 5% scheme. The chip under the reply shows the tools used. *Schemes discussed* updates. |
| 0:45 | **"Any offer on BrightWash detergent powder?"** | Expired-scheme handling: the festive offer *ended 30 September*, and the agent doesn't pretend it's still running. |
| 1:05 | **"Do you have Zippy atta noodles?"** | Out of stock: the agent suggests the in-stock alternative, Zippy Masala Noodles. |
| 1:25 | **"OK, send 10 cases of Zippy masala."** | The agent **reads the order back and asks you to confirm**. Nothing is in the captured panel yet. |
| 1:40 | **"Yes."** | `record_order_interest` runs. The panel shows *10 cases · 960 units · est. ₹12,240*. |
| 1:55 | Tap the mic *while the agent is speaking* and say **"Call me back on Friday after 4 pm."** | Tapping interrupts the agent. The follow-up is recorded with the retailer's own timing. |
| 2:15 | Optional: tick **Hands-free** and say **"Who will win the cricket match?"** | The mic reopens by itself after each reply. The agent politely steers back to business. |
| 2:30 | **"That's all, thanks."** Then click **End & summarize**. | Structured summary: outcome *Order enquiry*, products, schemes, follow-up, sentiment, next action. Expand **Summary JSON**. |
| 2:45 | Click **View history** and open the call. | The saved interaction has the full transcript, tool chips per turn, timestamps and duration. |

**If something goes wrong on stage**
- Mic blocked or not working: a yellow banner appears. Say "voice is optional, the text box always works" and type the same lines.
- "Too many requests" error: wait about 10 seconds and press **Retry**. The turn was rolled back, so nothing is lost or duplicated.
- The agent asks a clarifying question (e.g. "1 kg powder or 1 litre liquid?"): that's intended behaviour. Answer it.
