// Gemini provider. Translates our provider-neutral messages to Gemini
// "contents", calls the official SDK and translates the reply back.
import { GoogleGenAI } from '@google/genai';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`LLM timed out after ${ms} ms`), { status: 408 })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Server hiccups are worth one quick retry. Rate limits (429, per-minute
// quotas) and timeouts are not: we fail fast and let the user retry.
const isTransient = (err) => [500, 502, 503, 504].includes(err?.status);

/**
 * Neutral history -> Gemini contents.
 *   { role: 'user', text }                       -> user text part
 *   { role: 'assistant', text, raw }             -> the model's original content (keeps thought signatures)
 *   { role: 'tool', name, id, result }           -> functionResponse parts, grouped per turn
 */
function toContents(messages) {
  const contents = [];
  for (const m of messages) {
    if (m.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: m.text }] });
    } else if (m.role === 'assistant') {
      contents.push(m.raw?.parts?.length ? m.raw : { role: 'model', parts: [{ text: m.text || '...' }] });
    } else if (m.role === 'tool') {
      const part = { functionResponse: { name: m.name, response: m.result, ...(m.id && { id: m.id }) } };
      const last = contents.at(-1);
      if (last?.role === 'user' && last.parts[0]?.functionResponse) last.parts.push(part);
      else contents.push({ role: 'user', parts: [part] });
    }
  }
  return contents;
}

function firstCandidate(response) {
  const candidate = response.candidates?.[0];
  if (!candidate?.content) {
    const reason = response.promptFeedback?.blockReason || candidate?.finishReason || 'no candidates';
    throw new Error(`Gemini returned no content (${reason})`);
  }
  return candidate.content;
}

const textOf = (content) =>
  (content.parts || [])
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join('')
    .trim();

export function createGeminiLLM({ apiKey, model, timeoutMs = 15000 }) {
  const ai = new GoogleGenAI({ apiKey });

  async function call(request) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await withTimeout(ai.models.generateContent({ model, ...request }), timeoutMs);
      } catch (err) {
        if (attempt >= 2 || !isTransient(err)) throw err;
        await sleep(1000);
      }
    }
  }

  return {
    name: 'gemini',
    model,

    /** One model step: returns spoken text and/or tool calls. */
    async generate({ system, messages, tools }) {
      const response = await call({
        contents: toContents(messages),
        config: {
          systemInstruction: system,
          temperature: 0.4,
          tools: [
            {
              functionDeclarations: tools.map((t) => ({
                name: t.name,
                description: t.description,
                parametersJsonSchema: t.parameters,
              })),
            },
          ],
        },
      });
      const content = firstCandidate(response);
      const toolCalls = (content.parts || [])
        .filter((p) => p.functionCall)
        .map((p) => ({ id: p.functionCall.id, name: p.functionCall.name, args: p.functionCall.args || {} }));
      return { text: textOf(content), toolCalls, raw: content };
    },

    /** Structured output constrained by a JSON Schema (used for summaries). */
    async generateJSON({ system, prompt, schema }) {
      const response = await call({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          systemInstruction: system,
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
        },
      });
      return JSON.parse(textOf(firstCandidate(response)));
    },
  };
}
