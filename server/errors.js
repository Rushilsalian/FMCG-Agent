// An error with an HTTP status and a message that is safe to show users.
export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** Validate a required, trimmed, length-limited string from a request body. */
export function requireText(value, field, maxLength) {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${field} is required.`);
  if (value.length > maxLength) throw new HttpError(400, `${field} must be at most ${maxLength} characters.`);
  return value.trim();
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body must be valid JSON.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side.' });
}
