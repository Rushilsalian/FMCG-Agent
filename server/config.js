import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  port: Number(process.env.PORT) || 3000,
  dataDir: path.join(ROOT, 'data'),
  publicDir: path.join(ROOT, 'public'),
  interactionsFile: process.env.INTERACTIONS_FILE || path.join(ROOT, 'data', 'interactions.json'),
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  // "mock" forces the offline provider; otherwise Gemini is used when a key exists.
  llmProvider: (process.env.LLM_PROVIDER || '').toLowerCase(),
  llmTimeoutMs: 20000,
  sessionTtlMs: 30 * 60 * 1000,
};

// Business dates are evaluated in Indian time (scheme validity, follow-ups).
export function todayISO(date = new Date()) {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}
