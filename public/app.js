// UI controller: navigation, the conversation flow, mic states and the live order panel.
import { api } from './api.js';
import { createVoice } from './voice.js';
import {
  $, h, icon, rupees, formatTime, formatLatency, formatDateTime, timeAgo, plural, sentence, initials, avatarClass, OUTCOME_LABELS, outcomePill, toast,
} from './ui.js';
import { renderDashboard, renderHistory, renderInteraction, renderCatalog, quoteBreakdown, toolLabel } from './views.js';

const state = {
  retailers: [],
  catalog: null,
  selectedRetailerId: null,
  retailer: null,
  sessionId: null,
  busy: false,
  timer: null,
  lastReply: '',
  said: new Set(), // suggestion chips already used this call
  quote: null,
  micState: 'idle', // idle | listening | thinking | speaking | unavailable
  handsFree: false,
  quietRestarts: 0, // hands-free: how many silent listens in a row
  userStoppedMic: false,
};

// ---------- voice ----------

const MIC_LABELS = {
  idle: 'Tap to speak',
  listening: 'Listening... tap to stop',
  thinking: 'Asha is thinking...',
  speaking: 'Speaking... tap to interrupt',
  unavailable: 'Voice unavailable, type below',
};
// Recognition ends on silence; in hands-free mode re-open it this many times before pausing.
const MAX_QUIET_RESTARTS = 2;

const voice = createVoice({
  lang: 'en-IN',
  onInterim: (text) => ($('#interim').textContent = text),
  onFinal: (text) => {
    state.quietRestarts = 0;
    sendText(text);
  },
  onEnd: ({ fatal }) => {
    if (fatal || !state.sessionId) return;
    const keepListening = state.handsFree && !state.userStoppedMic && state.quietRestarts < MAX_QUIET_RESTARTS;
    if (keepListening) {
      state.quietRestarts++;
      startListening();
    } else {
      setMicState('idle');
      if (state.handsFree) $('#mic-label').textContent = 'Hands-free paused, tap to resume';
    }
  },
  onError: (message, { fatal }) => {
    showBanner(message);
    if (fatal || !voice.isListening) setMicState(voice.support.recognition ? 'idle' : 'unavailable');
  },
});

function setMicState(micState) {
  state.micState = micState;
  const btn = $('#mic-btn');
  btn.dataset.state = micState;
  btn.disabled = micState === 'thinking' || micState === 'unavailable';
  btn.setAttribute('aria-label', MIC_LABELS[micState]);
  $('#mic-label').textContent = MIC_LABELS[micState];
}

function showBanner(message) {
  $('#voice-banner').replaceChildren(icon('alert'), h('span', {}, message));
  $('#voice-banner').hidden = false;
}

function startListening() {
  if (!voice.support.recognition || !state.sessionId) return;
  voice.stopSpeaking(); // tapping while the agent talks interrupts it
  state.userStoppedMic = false;
  setMicState('listening');
  voice.listen();
}

// Speak a reply, then (in hands-free mode) re-open the mic. The mic is never
// open while the agent speaks, so it doesn't hear itself.
async function speakReply(text) {
  if (!voice.support.synthesis) return afterSpeaking();
  setMicState('speaking');
  const finished = await voice.speak(text);
  if (finished) afterSpeaking(); // if interrupted, whoever interrupted owns the state
}

function afterSpeaking() {
  if (!state.sessionId) return;
  if (state.handsFree && voice.support.recognition) startListening();
  else setMicState(voice.support.recognition ? 'idle' : 'unavailable');
}

function onMicClick() {
  if (state.micState === 'listening') {
    state.userStoppedMic = true;
    voice.stopListening(); // anything heard so far is still sent
    return;
  }
  state.quietRestarts = 0;
  startListening();
}

async function checkVoiceSupport() {
  $('#voice-banner').hidden = true;
  if (!voice.support.recognition) {
    showBanner(voice.support.reason || 'Voice input is unavailable. You can keep typing.');
    setMicState('unavailable');
    return;
  }
  setMicState('idle');
  // Warn early if the mic is already blocked for this site.
  try {
    const permission = await navigator.permissions?.query({ name: 'microphone' });
    if (permission?.state === 'denied') {
      voice.support.recognition = false;
      showBanner('Microphone access is blocked for this site. Allow it in the address bar to talk, or keep typing.');
      setMicState('unavailable');
    }
  } catch {
    /* permissions API not available for microphone in this browser: find out on first use */
  }
}

// ---------- navigation & theme ----------

const NAV_FOR_SCREEN = { dashboard: 'dashboard', start: 'start', call: 'start', history: 'history', detail: 'history', catalog: 'catalog' };

function show(screen) {
  document.querySelectorAll('.screen').forEach((s) => (s.hidden = s.id !== `screen-${screen}`));
  document.querySelectorAll('.nav-item').forEach((n) => n.toggleAttribute('aria-current', n.dataset.nav === NAV_FOR_SCREEN[screen]));
  document.body.dataset.screen = screen;
  window.scrollTo(0, 0);
}

const ROUTES = { dashboard: loadDashboard, start: loadStart, history: loadHistory, catalog: loadCatalog };

document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-nav]');
  if (!target) return;
  if (state.sessionId && !confirm('Leave this call without summarizing it?')) return;
  leaveCall();
  ROUTES[target.dataset.nav]?.();
});

function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  localStorage.setItem('theme', root.dataset.theme);
}

// ---------- dashboard / history / catalogue ----------

async function loadDashboard() {
  show('dashboard');
  const body = $('#dashboard-body');
  try {
    renderDashboard(body, await api.stats(), { onOpen: openDetail, onStart: loadStart });
  } catch (err) {
    body.replaceChildren(h('p', { class: 'error' }, `Could not load the dashboard: ${err.message}`));
  }
}

async function loadHistory() {
  show('history');
  const container = $('#history-list');
  container.replaceChildren(h('p', { class: 'loading' }, 'Loading...'));
  try {
    renderHistory(container, await api.interactions(), { onOpen: openDetail });
  } catch (err) {
    container.replaceChildren(h('p', { class: 'error' }, `Could not load history: ${err.message}`));
  }
}

async function openDetail(id) {
  show('detail');
  const body = $('#detail-body');
  body.replaceChildren(h('p', { class: 'loading' }, 'Loading...'));
  try {
    body.replaceChildren(renderInteraction(await api.interaction(id), { withTranscript: true }));
  } catch (err) {
    body.replaceChildren(h('p', { class: 'error' }, err.message));
  }
}

async function loadCatalog() {
  show('catalog');
  try {
    state.catalog ||= await api.catalog();
    renderCatalog($('#catalog-body'), state.catalog);
  } catch (err) {
    $('#catalog-body').replaceChildren(h('p', { class: 'error' }, `Could not load the catalogue: ${err.message}`));
  }
}

// ---------- start screen ----------

async function loadStart() {
  show('start');
  try {
    state.retailers = await api.retailers(); // refresh "last call" info
    renderRetailers();
  } catch (err) {
    $('#start-error').textContent = `Could not load retailers: ${err.message}`;
    $('#start-error').hidden = false;
  }
}

function renderRetailers() {
  $('#retailer-list').replaceChildren(
    ...state.retailers.map((r) =>
      h(
        'button',
        {
          class: 'retailer',
          role: 'radio',
          'aria-checked': String(r.id === state.selectedRetailerId),
          onclick: () => {
            state.selectedRetailerId = r.id;
            $('#start-btn').disabled = false;
            renderRetailers();
          },
          ondblclick: () => startCall(),
        },
        h('span', { class: 'retailer-top' },
          h('span', { class: avatarClass(r.store_name) }, initials(r.store_name)),
          h('span', {}, h('strong', {}, r.store_name), h('small', {}, `${r.owner} · ${r.outlet_type}`))),
        h('small', { class: 'area' }, r.area),
        h('span', { class: 'tags' }, r.usual_categories.map((c) => h('span', { class: 'cat-tag' }, c))),
        h('span', { class: 'last-call' },
          r.last_call
            ? [icon('history'), `Last call ${timeAgo(r.last_call.startedAt)} · `, OUTCOME_LABELS[r.last_call.outcome]]
            : [icon('spark'), 'First call']),
      ),
    ),
  );
}

async function startCall() {
  if (!state.selectedRetailerId || state.sessionId) return;
  voice.unlock(); // must run inside the click, before any await, so TTS is allowed
  const btn = $('#start-btn');
  btn.disabled = true;
  btn.querySelector('span').textContent = 'Connecting...';
  $('#start-error').hidden = true;
  try {
    const data = await api.startSession(state.selectedRetailerId);
    state.sessionId = data.sessionId;
    state.retailer = data.retailer;
    state.said = new Set();
    $('#call-avatar').textContent = initials(data.retailer.store_name);
    $('#call-avatar').className = avatarClass(data.retailer.store_name);
    $('#call-retailer').textContent = data.retailer.store_name;
    $('#call-retailer-meta').textContent = `${data.retailer.owner} · ${data.retailer.area}`;
    $('#transcript').replaceChildren();
    renderMemory(data.previousCall);
    renderOrderPanel(data.captured, data.quote);
    startTimer();
    show('call');
    await checkVoiceSupport();
    addAgentMessage(data.reply);
    renderSuggestions();
    if (matchMedia('(pointer: fine)').matches) $('#text-input').focus(); // don't pop the keyboard on phones
    speakReply(data.reply);
  } catch (err) {
    $('#start-error').textContent = err.message;
    $('#start-error').hidden = false;
  } finally {
    btn.disabled = false;
    btn.querySelector('span').textContent = 'Start conversation';
  }
}

// What Asha remembers from the previous call with this retailer.
function renderMemory(previous) {
  const banner = $('#memory-banner');
  banner.hidden = !previous;
  if (!previous) return;
  banner.replaceChildren(
    icon('history', 'memory-icon'),
    h('div', {},
      h('strong', {}, 'Asha remembers · ', `last call ${timeAgo(previous.startedAt)}`),
      outcomePill(previous.outcome),
      h('p', {}, previous.next_action)),
  );
}

// ---------- conversation ----------

const scrollToEnd = (item) => item.scrollIntoView({ block: 'end', behavior: 'smooth' });

function addMessage(role, text) {
  const item = h('li', { class: `msg ${role}` },
    role === 'agent' ? h('span', { class: 'avatar agent-avatar sm', 'aria-hidden': 'true' }, 'A') : null,
    h('div', { class: 'bubble' }, h('span', { class: 'msg-text' }, text), h('span', { class: 'msg-meta' }, formatTime(new Date().toISOString()))));
  $('#transcript').append(item);
  scrollToEnd(item);
  return item;
}

// An agent reply, with an expandable trace of the tool calls behind it.
function addAgentMessage(text, { toolsUsed = [], llmCalls, latencyMs } = {}) {
  const item = addMessage('agent', text);
  const bubble = item.querySelector('.bubble');
  if (latencyMs !== undefined) bubble.querySelector('.msg-meta').append(` · ${formatLatency(latencyMs)}`);
  if (toolsUsed.length) {
    bubble.append(
      h('details', { class: 'trace' },
        h('summary', {}, icon('tool'), `${plural(toolsUsed.length, 'tool call')} · ${plural(llmCalls, 'LLM step')}`),
        h('ol', {}, toolsUsed.map((t) =>
          h('li', { class: t.ok ? 'ok' : 'failed' },
            h('strong', {}, toolLabel(t.name)),
            h('code', {}, `${t.name}(${Object.keys(t.args).length ? JSON.stringify(t.args) : ''})`),
            h('span', {}, `→ ${t.result}`))))));
  }
  state.lastReply = text;
  return item;
}

function setBusy(busy) {
  state.busy = busy;
  $('#text-input').disabled = busy;
  $('#text-form button').disabled = busy;
  $('#end-btn').disabled = busy;
  $('#suggestions').classList.toggle('disabled', busy);
}

async function sendText(text) {
  text = text.trim();
  if (!text || state.busy || !state.sessionId) return;
  // Typing while the mic is open or the agent is talking takes over.
  voice.abortListening();
  voice.stopSpeaking();
  addMessage('retailer', text);
  await askAgent(text);
}

// Sends one retailer turn. On failure, shows an inline Retry that resends it.
async function askAgent(text) {
  setBusy(true);
  setMicState('thinking');
  const thinking = h('li', { class: 'msg agent thinking' }, h('span', { class: 'avatar agent-avatar sm' }, 'A'),
    h('div', { class: 'bubble' }, h('span', { class: 'typing', 'aria-label': 'Asha is checking' }, h('i'), h('i'), h('i'))));
  $('#transcript').append(thinking);
  scrollToEnd(thinking);
  let reply = null;
  try {
    const data = await api.sendMessage(state.sessionId, text);
    reply = data.reply;
    thinking.remove();
    addAgentMessage(data.reply, data);
    renderOrderPanel(data.captured, data.quote);
  } catch (err) {
    thinking.remove();
    const errorItem = addMessage('error', err.message);
    if (err.retryable) {
      errorItem.querySelector('.bubble').append(h('button', { onclick: () => { errorItem.remove(); askAgent(text); } }, 'Retry'));
    }
  } finally {
    setBusy(false);
    renderSuggestions();
    if (matchMedia('(pointer: fine)').matches) $('#text-input').focus();
  }
  if (reply) speakReply(reply);
  else setMicState(voice.support.recognition ? 'idle' : 'unavailable');
}

// ---------- suggestion chips ----------

// Phrasings that work with both Gemini and the offline MockLLM, per category the retailer stocks.
const CATEGORY_PROMPTS = {
  tea: ["What's the rate of Chai Raja tea 250 gram?", 'Send 2 cases of Chai Raja 250 gram'],
  noodles: ['Do you have Zippy atta noodles?', 'Send 10 cases of Zippy masala noodles'],
  biscuits: ['Price of Crunchies cream bourbon?', 'Send 12 cases of Crunchies glucose biscuits'],
  coffee: ['Price of Brewly instant coffee?', 'Send 3 cases of Brewly coffee'],
  detergent: ['Any offer on BrightWash detergent powder?', 'Send 5 cases of BrightWash detergent powder'],
  soap: ['Price of Neela sandal soap?', 'Send 2 cases of Neela sandal soap'],
  shampoo: ['Do you have SilkLeaf shampoo 340 ml?', 'Send 1 case of SilkLeaf shampoo 180 ml'],
  toothpaste: ['Price of DentaGlo toothpaste?', 'Send 2 cases of DentaGlo toothpaste'],
};

// Chips that stay useful after being used once.
const REPEATABLE = new Set(['Yes', "What's my total?"]);

function renderSuggestions() {
  const items = [];
  if (/shall i note that\?/i.test(state.lastReply)) items.push('Yes', 'Make it 5 cases');
  if (state.quote?.lines.length) items.push("What's my total?");
  // A nudge that names a product ("Add 1 case of X to get ₹300 off") becomes a one-tap reply.
  for (const n of state.quote?.nudges || []) {
    const add = n.message.split(' to get ')[0];
    if (/^Add \d+ cases? of /.test(add)) items.push(add);
  }
  for (const c of state.retailer?.usual_categories || []) {
    const next = (CATEGORY_PROMPTS[c] || []).find((p) => !state.said.has(p));
    if (next) items.push(next);
  }
  items.push('Any offers this week?', 'Call me back tomorrow at 5 pm', "That's all, thanks");
  const chips = [...new Set(items)].filter((t) => REPEATABLE.has(t) || !state.said.has(t)).slice(0, 6);

  $('#suggestions').replaceChildren(
    ...chips.map((t) => h('button', { class: 'chip suggestion', type: 'button', onclick: () => { state.said.add(t); sendText(t); } }, t)),
  );
}

// ---------- live order panel ----------

function renderOrderPanel(captured, quote) {
  const changed = state.quote && JSON.stringify(state.quote.lines) !== JSON.stringify(quote.lines);
  state.quote = quote;
  $('#order-net').textContent = rupees(quote.net_value);
  $('#order-savings').textContent = quote.total_savings ? `Saves ${rupees(quote.total_savings)} with offers` : '';
  $('#order-toggle').textContent = quote.lines.length ? `Order · ${rupees(quote.net_value)}` : 'Order';
  $('#cap-quote').replaceChildren(
    quote.lines.length ? quoteBreakdown(quote) : h('p', { class: 'empty' }, 'Nothing yet. Items appear here once the retailer confirms.'),
  );
  $('#cap-nudges').replaceChildren(
    ...quote.nudges.map((n) => h('div', { class: 'nudge' }, icon('bulb'), h('span', {}, n.message))),
  );

  const list = (selector, items, render, emptyText) =>
    $(selector).replaceChildren(...(items.length ? items.map(render) : [h('li', { class: 'empty' }, emptyText)]));
  list('#cap-followups', captured.followups, (f) => h('li', {}, `${sentence(f.type)} · ${f.when}`, h('small', {}, f.details)), 'None');
  list('#cap-schemes', captured.schemes_discussed, (s) =>
    h('li', {}, s.name, h('small', { class: s.status === 'expired' ? 'expired' : 'active' }, s.status)), 'None');

  if (changed) {
    const panel = $('#order-panel');
    panel.classList.remove('flash');
    void panel.offsetWidth; // restart the animation
    panel.classList.add('flash');
    $('#order-toggle').classList.add('flash');
    setTimeout(() => $('#order-toggle').classList.remove('flash'), 900);
  }
}

// Narrow screens: the order panel is a slide-over drawer.
function setPanelOpen(open) {
  $('#order-panel').classList.toggle('open', open);
  $('#panel-backdrop').hidden = !open;
  $('#order-toggle').setAttribute('aria-expanded', String(open));
}

function startTimer() {
  const started = Date.now();
  clearInterval(state.timer);
  $('#call-timer').textContent = '00:00';
  state.timer = setInterval(() => {
    const secs = Math.floor((Date.now() - started) / 1000);
    $('#call-timer').textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  }, 1000);
}

function leaveCall() {
  clearInterval(state.timer);
  state.sessionId = null;
  state.quote = null;
  state.lastReply = '';
  voice.abortListening();
  voice.stopSpeaking();
  setPanelOpen(false);
  $('#interim').textContent = '';
}

// ---------- end call & summary ----------

async function endCall() {
  if (state.busy || !state.sessionId) return;
  voice.abortListening();
  voice.stopSpeaking();
  setBusy(true);
  setMicState('thinking');
  const btn = $('#end-btn');
  btn.textContent = 'Summarizing...';
  try {
    const { interaction } = await api.endSession(state.sessionId);
    leaveCall();
    $('#summary-body').replaceChildren(renderInteraction(interaction, { withTranscript: false }));
    show('summary');
    toast(`Saved · ${OUTCOME_LABELS[interaction.summary.outcome]} · ${formatDateTime(interaction.endedAt)}`);
  } catch (err) {
    addMessage('error', err.message);
    setMicState('idle');
  } finally {
    setBusy(false);
    btn.textContent = 'End & summarize';
  }
}

// ---------- wiring ----------

$('#start-btn').addEventListener('click', startCall);
$('#mic-btn').addEventListener('click', onMicClick);
$('#end-btn').addEventListener('click', endCall);
$('#order-toggle').addEventListener('click', () => setPanelOpen(true));
$('#order-close').addEventListener('click', () => setPanelOpen(false));
$('#panel-backdrop').addEventListener('click', () => setPanelOpen(false));
document.querySelectorAll('.theme-toggle').forEach((b) => b.addEventListener('click', toggleTheme));
$('#handsfree').addEventListener('change', (e) => {
  state.handsFree = e.target.checked;
  state.quietRestarts = 0;
  if (state.handsFree && state.micState === 'idle') startListening();
});
$('#text-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#text-input');
  const text = input.value;
  input.value = '';
  sendText(text);
});

// Space toggles the mic and Esc stops speech, unless the user is typing or on a control.
document.addEventListener('keydown', (e) => {
  if (!state.sessionId || e.target.closest('input, textarea, button, select, summary, a')) return;
  if (e.key === ' ' && !$('#mic-btn').disabled) {
    e.preventDefault();
    onMicClick();
  } else if (e.key === 'Escape') {
    if (state.micState === 'speaking') {
      voice.stopSpeaking();
      setMicState(voice.support.recognition ? 'idle' : 'unavailable');
    } else if (state.micState === 'listening') {
      state.userStoppedMic = true;
      voice.abortListening();
      setMicState('idle');
    }
    setPanelOpen(false);
  }
});

async function init() {
  try {
    const health = await api.health();
    document.querySelectorAll('.llm-badge').forEach((b) => (b.textContent = health.llm === 'mock' ? 'Offline MockLLM' : `Gemini · ${health.model}`));
    document.querySelectorAll('.llm-status').forEach((s) => s.classList.toggle('mock', health.llm === 'mock'));
  } catch {
    document.querySelectorAll('.llm-badge').forEach((b) => (b.textContent = 'Server offline'));
    document.querySelectorAll('.llm-status').forEach((s) => s.classList.add('offline'));
  }
  loadDashboard();
}

init();
