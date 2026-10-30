import { config } from './config.js';
import { createApp } from './app.js';
import { createLLM } from './llm/index.js';

const llm = createLLM(config);
const app = createApp({ llm });

app.listen(config.port, () => {
  console.log(`FMCG voice agent running at http://localhost:${config.port}`);
  console.log(`LLM provider: ${llm.name} (${llm.model})`);
  if (llm.name === 'mock') console.log('No GEMINI_API_KEY set (or LLM_PROVIDER=mock): using the offline MockLLM.');
});
