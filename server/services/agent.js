// The conversation agent: owns the tool-call loop. The browser only ever
// sends text and receives the spoken reply plus the captured state.
import { toolDeclarations, runTool, describeToolResult } from '../tools/index.js';
import { emptyCaptured } from '../tools/capture.js';
import { quoteOrder } from '../tools/pricing.js';
import { buildSystemPrompt, buildGreeting } from './prompts.js';
import { toSpeakable } from './text.js';
import { summarize } from './summarizer.js';
import { todayISO } from '../config.js';

// Enough for search -> check -> record in one turn, but stops runaway loops.
const MAX_TOOL_ROUNDS = 5;
const EMPTY_REPLY = "Sorry, I didn't catch that. Could you say it again?";
const TOO_MANY_STEPS = 'Let me check on that and get back to you. Is there anything else I can help with?';

// The slice of a past interaction the agent "remembers" on the next call.
function recapOf(interaction) {
  if (!interaction) return null;
  const { id, startedAt, summary } = interaction;
  const { outcome, overview, next_action, products, followups } = summary;
  return { id, startedAt, outcome, overview, next_action, products, followups };
}

export function createAgent({ llm, sessions, repo }) {
  async function startConversation(retailer) {
    // repo.list() is newest first, so this is the retailer's most recent call.
    const previous = recapOf((await repo.list()).find((i) => i.retailer.id === retailer.id));
    const greeting = buildGreeting(retailer, previous);
    const now = new Date().toISOString();
    return sessions.create({
      retailer,
      previous,
      startedAt: now,
      systemPrompt: buildSystemPrompt(retailer, todayISO(), previous),
      // History in a provider-neutral shape. The synthetic first user turn
      // keeps providers happy that expect the user to speak first.
      messages: [
        { role: 'user', text: '(The call has connected.)' },
        { role: 'assistant', text: greeting },
      ],
      transcript: [{ role: 'agent', text: greeting, at: now }],
      captured: emptyCaptured(),
      busy: false,
    });
  }

  /** Run one retailer turn through the LLM + tools loop and return the reply. */
  async function reply(session, text) {
    // Snapshot so a failed turn can be retried cleanly.
    const checkpoint = session.messages.length;
    const capturedBefore = structuredClone(session.captured);
    const toolsUsed = [];
    const startedAt = Date.now();
    let llmCalls = 0;
    session.busy = true;
    session.messages.push({ role: 'user', text });

    try {
      let answer = TOO_MANY_STEPS;
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const res = await llm.generate({ system: session.systemPrompt, messages: session.messages, tools: toolDeclarations });
        llmCalls++;

        if (res.toolCalls.length === 0) {
          answer = toSpeakable(res.text) || EMPTY_REPLY;
          session.messages.push({ role: 'assistant', text: answer, raw: res.text ? res.raw : undefined });
          break;
        }

        session.messages.push({ role: 'assistant', text: res.text, toolCalls: res.toolCalls, raw: res.raw });
        for (const toolCall of res.toolCalls) {
          const result = runTool(toolCall.name, toolCall.args, { captured: session.captured });
          session.messages.push({ role: 'tool', id: toolCall.id, name: toolCall.name, result });
          toolsUsed.push({
            name: toolCall.name,
            args: toolCall.args,
            ok: !result.error && result.ok !== false,
            result: describeToolResult(toolCall.name, result),
          });
        }
      }
      if (answer === TOO_MANY_STEPS) session.messages.push({ role: 'assistant', text: answer });

      const now = new Date().toISOString();
      const latencyMs = Date.now() - startedAt;
      session.transcript.push(
        { role: 'retailer', text, at: now },
        { role: 'agent', text: answer, at: now, tools: toolsUsed.map((t) => t.name), latencyMs },
      );
      return { reply: answer, captured: session.captured, quote: quoteOrder(session.captured.orders), toolsUsed, llmCalls, latencyMs };
    } catch (err) {
      session.messages.length = checkpoint;
      session.captured = capturedBefore;
      throw err;
    } finally {
      session.busy = false;
    }
  }

  /** Summarise, save and close the conversation. */
  async function endConversation(session) {
    session.busy = true;
    try {
      const endedAt = new Date();
      const { retailer, transcript, captured } = session;
      const summary = await summarize({ llm, retailer, transcript, captured });
      const interaction = {
        id: session.id,
        retailer: { id: retailer.id, store_name: retailer.store_name, owner: retailer.owner, area: retailer.area },
        startedAt: session.startedAt,
        endedAt: endedAt.toISOString(),
        durationSeconds: Math.round((endedAt - new Date(session.startedAt)) / 1000),
        llm: `${llm.name}:${llm.model}`,
        summary,
        captured,
        quote: quoteOrder(captured.orders),
        transcript,
      };
      await repo.save(interaction);
      sessions.delete(session.id);
      return interaction;
    } finally {
      session.busy = false; // if saving failed, the user can try ending again
    }
  }

  return { startConversation, reply, endConversation };
}
