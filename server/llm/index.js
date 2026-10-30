// Picks the LLM provider. Both providers implement:
//   generate({ system, messages, tools }) -> { text, toolCalls: [{ id, name, args }], raw }
//   generateJSON({ system, prompt, schema }) -> object
import { createGeminiLLM } from './gemini.js';
import { createMockLLM } from './mock.js';

export function createLLM(config) {
  if (config.llmProvider === 'mock' || !config.geminiApiKey) return createMockLLM();
  return createGeminiLLM({ apiKey: config.geminiApiKey, model: config.geminiModel, timeoutMs: config.llmTimeoutMs });
}
