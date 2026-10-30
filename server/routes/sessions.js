// Conversation API: start a call, send a retailer turn, end the call.
import { Router } from 'express';
import { findRetailer } from '../tools/catalog.js';
import { HttpError, requireText } from '../errors.js';

const MAX_MESSAGE_LENGTH = 500;
const LLM_UNAVAILABLE = "Sorry, I couldn't reach the assistant just now. Please try again.";
const LLM_RATE_LIMITED = 'The assistant is getting too many requests. Please wait a few seconds and try again.';

export function sessionsRouter({ agent, sessions }) {
  const router = Router();

  function loadSession(id) {
    const session = sessions.get(id);
    if (!session) throw new HttpError(404, 'This conversation has ended or expired. Please start a new one.');
    if (session.busy) throw new HttpError(409, 'Still answering your previous message.');
    return session;
  }

  router.post('/', (req, res) => {
    const retailer = findRetailer(req.body?.retailerId);
    if (!retailer) throw new HttpError(400, 'Please choose a valid retailer.');
    const session = agent.startConversation(retailer);
    res.status(201).json({
      sessionId: session.id,
      retailer,
      reply: session.transcript[0].text,
      captured: session.captured,
    });
  });

  router.post('/:id/messages', async (req, res) => {
    const session = loadSession(req.params.id);
    const text = requireText(req.body?.text, 'text', MAX_MESSAGE_LENGTH);
    try {
      res.json(await agent.reply(session, text));
    } catch (err) {
      console.error('LLM turn failed:', err.message);
      throw new HttpError(503, err.status === 429 ? LLM_RATE_LIMITED : LLM_UNAVAILABLE, { retryable: true });
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
