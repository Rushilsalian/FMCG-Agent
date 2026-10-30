// Conversation API: start a call, send a retailer turn, end the call.
import { Router } from 'express';
import { findRetailer } from '../tools/catalog.js';
import { quoteOrder } from '../tools/pricing.js';
import { HttpError, requireText } from '../errors.js';

const MAX_MESSAGE_LENGTH = 500;
const LLM_UNAVAILABLE = "Sorry, I couldn't reach the assistant just now. Please try again.";

// "3 h 16 min", "45 s"
function formatWait(seconds) {
  if (seconds < 90) return `${seconds} s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

// A per-minute limit clears soon, so Retry makes sense. A daily quota does not:
// say so plainly, with the ways out, and don't offer a Retry that will only fail.
function rateLimitError({ scope, retryAfterSeconds } = {}) {
  const wait = retryAfterSeconds ? formatWait(retryAfterSeconds) : null;
  if (scope === 'day') {
    return new HttpError(
      503,
      `The Gemini API key has used its free daily quota${wait ? ` (it resets in about ${wait})` : ''}. ` +
        'To keep going, set a different GEMINI_MODEL, use a paid key, or restart with npm run start:mock.',
      { retryable: false, rateLimit: 'day' },
    );
  }
  return new HttpError(
    503,
    `The assistant is getting too many requests (per-minute limit). Please wait ${wait || 'a few seconds'} and try again.`,
    { retryable: true, rateLimit: 'minute' },
  );
}

export function sessionsRouter({ agent, sessions }) {
  const router = Router();

  function loadSession(id) {
    const session = sessions.get(id);
    if (!session) throw new HttpError(404, 'This conversation has ended or expired. Please start a new one.');
    if (session.busy) throw new HttpError(409, 'Still answering your previous message.');
    return session;
  }

  router.post('/', async (req, res) => {
    const retailer = findRetailer(req.body?.retailerId);
    if (!retailer) throw new HttpError(400, 'Please choose a valid retailer.');
    const session = await agent.startConversation(retailer);
    res.status(201).json({
      sessionId: session.id,
      retailer,
      previousCall: session.previous,
      reply: session.transcript[0].text,
      captured: session.captured,
      quote: quoteOrder(session.captured.orders),
    });
  });

  router.post('/:id/messages', async (req, res) => {
    const session = loadSession(req.params.id);
    const text = requireText(req.body?.text, 'text', MAX_MESSAGE_LENGTH);
    try {
      res.json(await agent.reply(session, text));
    } catch (err) {
      if (err.status === 429) {
        const { scope, retryAfterSeconds } = err.rateLimit || {};
        console.error(`LLM turn rate-limited: ${scope || 'unknown'} quota, retry after ${retryAfterSeconds ?? '?'} s`);
        throw rateLimitError(err.rateLimit);
      }
      console.error('LLM turn failed:', err.message);
      throw new HttpError(503, LLM_UNAVAILABLE, { retryable: true });
    }
  });

  // The summariser never throws (it falls back to rules), so only storage can fail here.
  router.post('/:id/end', async (req, res) => {
    const session = loadSession(req.params.id);
    try {
      res.json({ interaction: await agent.endConversation(session) });
    } catch (err) {
      console.error('Saving interaction failed:', err);
      throw new HttpError(500, "Couldn't save this interaction. Please try ending the call again.", { retryable: true });
    }
  });

  return router;
}
