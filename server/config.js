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
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
  // "mock" (or the --mock flag) forces the offline provider; otherwise Gemini is used when a key exists.
  llmProvider: process.argv.includes('--mock') ? 'mock' : (process.env.LLM_PROVIDER || '').toLowerCase(),
  llmTimeoutMs: 15000,
  sessionTtlMs: 30 * 60 * 1000,
};

// Business dates are evaluated in Indian time (scheme validity, follow-ups).
export function todayISO(date = new Date()) {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}
