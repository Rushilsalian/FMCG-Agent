// Thin fetch wrapper. Throws an Error whose message is safe to show users.
async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('Network error: is the server running?'), { retryable: true });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.error || `Request failed (${res.status})`), {
      status: res.status,
      retryable: Boolean(data.retryable),
    });
  }
  return data;
}

export const api = {
  health: () => request('GET', '/health'),
  retailers: () => request('GET', '/retailers'),
  startSession: (retailerId) => request('POST', '/sessions', { retailerId }),
  sendMessage: (sessionId, text) => request('POST', `/sessions/${sessionId}/messages`, { text }),
  endSession: (sessionId) => request('POST', `/sessions/${sessionId}/end`),
  interactions: () => request('GET', '/interactions'),
  interaction: (id) => request('GET', `/interactions/${encodeURIComponent(id)}`),
};
