// UI controller: screens, conversation flow, mic states and the captured-items panel.
import { api } from './api.js';
import { createVoice } from './voice.js';

const $ = (sel) => document.querySelector(sel);

// Tiny DOM builder. Uses textContent everywhere, so model/user text is never parsed as HTML.
function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== false) node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

const rupees = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

const state = {
  retailers: [],
  selectedRetailerId: null,
  sessionId: null,
  busy: false,
  timer: null,
  micState: 'idle', // idle | listening | thinking | speaking | unavailable
  handsFree: false,
  quietRestarts: 0, // hands-free: how many silent listens in a row
  userStoppedMic: false,
};

// ---------- voice ----------

const MIC_LABELS = {
  idle: 'Tap to speak',
  listening: 'Listening... tap to stop',
  thinking: 'Thinking...',
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
  $('#voice-banner').textContent = message;
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

// ---------- screens ----------

function show(screen) {
  document.querySelectorAll('.screen').forEach((s) => (s.hidden = s.id !== `screen-${screen}`));
}

document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-nav]');
  if (!target) return;
  if (state.sessionId && !confirm('Leave this call without summarizing it?')) return;
  leaveCall();
  if (target.dataset.nav === 'start') show('start');
});

// ---------- start screen ----------

function renderRetailers() {
  const list = $('#retailer-list');
  list.replaceChildren(
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
        },
        h('strong', {}, r.store_name),
        h('small', {}, `${r.owner} · ${r.outlet_type}`),
        h('small', {}, r.area),
        h('small', {}, `Usually buys: ${r.usual_categories.join(', ')}`),
      ),
    ),
  );
}

async function startCall() {
  voice.unlock(); // must run inside the click, before any await, so TTS is allowed
  const btn = $('#start-btn');
  btn.disabled = true;
  btn.textContent = 'Connecting...';
  $('#start-error').hidden = true;
  try {
    const data = await api.startSession(state.selectedRetailerId);
    state.sessionId = data.sessionId;
    $('#call-retailer').textContent = data.retailer.store_name;
    $('#call-retailer-meta').textContent = `${data.retailer.owner} · ${data.retailer.area}`;
    $('#transcript').replaceChildren();
    renderCaptured(data.captured);
    startTimer();
    show('call');
    await checkVoiceSupport();
    addMessage('agent', data.reply);
    $('#text-input').focus();
    speakReply(data.reply);
  } catch (err) {
    $('#start-error').textContent = err.message;
    $('#start-error').hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Start conversation';
  }
}

// ---------- conversation ----------

function addMessage(role, text, tools = []) {
  const item = h(
    'li',
    { class: `msg ${role}` },
    text,
    tools.length ? h('span', { class: 'tools' }, `checked: ${tools.join(', ')}`) : null,
  );
  $('#transcript').append(item);
  item.scrollIntoView({ block: 'end', behavior: 'smooth' });
  return item;
}

function setBusy(busy) {
  state.busy = busy;
  $('#text-input').disabled = busy;
  $('#text-form button').disabled = busy;
  $('#end-btn').disabled = busy;
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
  const thinking = addMessage('agent thinking', 'Asha is checking...');
  let reply = null;
  try {
    const data = await api.sendMessage(state.sessionId, text);
    reply = data.reply;
    thinking.remove();
    addMessage('agent', data.reply, data.toolsUsed.map((t) => t.name));
    renderCaptured(data.captured);
  } catch (err) {
    thinking.remove();
    const errorItem = addMessage('error', err.message);
    if (err.retryable) {
      errorItem.append(h('button', { onclick: () => { errorItem.remove(); askAgent(text); } }, 'Retry'));
    }
  } finally {
    setBusy(false);
    $('#text-input').focus();
  }
  if (reply) speakReply(reply);
  else setMicState(voice.support.recognition ? 'idle' : 'unavailable');
}

function renderCaptured(captured) {
  const list = (selector, items, render, emptyText) =>
    $(selector).replaceChildren(...(items.length ? items.map(render) : [h('li', { class: 'empty' }, emptyText)]));

  list('#cap-orders', captured.orders, (o) =>
    h('li', {}, `${o.quantity} ${o.unit} · ${o.name}`, h('small', {}, `${o.total_units} units · est. ${rupees(o.estimated_value)}`)),
    'Nothing yet');
  list('#cap-followups', captured.followups, (f) =>
    h('li', {}, `${f.type.replace(/_/g, ' ')} · ${f.when}`, h('small', {}, f.details)),
    'None');
  list('#cap-schemes', captured.schemes_discussed, (s) =>
    h('li', {}, s.name, h('small', {}, s.status === 'expired' ? 'expired' : 'active')),
    'None');
}

function startTimer() {
  const started = Date.now();
  clearInterval(state.timer);
  state.timer = setInterval(() => {
    const secs = Math.floor((Date.now() - started) / 1000);
    $('#call-timer').textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  }, 1000);
}

function leaveCall() {
  clearInterval(state.timer);
  state.sessionId = null;
  voice.abortListening();
  voice.stopSpeaking();
  $('#interim').textContent = '';
}

// ---------- wiring ----------

$('#start-btn').addEventListener('click', startCall);
$('#mic-btn').addEventListener('click', onMicClick);
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

async function init() {
  show('start');
  try {
    const [health, retailers] = await Promise.all([api.health(), api.retailers()]);
    $('#llm-badge').textContent = health.llm === 'mock' ? 'Offline MockLLM' : `Gemini · ${health.model}`;
    state.retailers = retailers;
    renderRetailers();
  } catch (err) {
    $('#start-error').textContent = `Could not load retailers: ${err.message}`;
    $('#start-error').hidden = false;
  }
}

init();
