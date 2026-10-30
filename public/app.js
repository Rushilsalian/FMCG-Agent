// UI controller: screens, conversation flow and the captured-items panel.
import { api } from './api.js';

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
};

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
    addMessage('agent', data.reply);
    $('#text-input').focus();
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
  addMessage('retailer', text);
  await askAgent(text);
}

// Sends one retailer turn. On failure, shows an inline Retry that resends it.
async function askAgent(text) {
  setBusy(true);
  const thinking = addMessage('agent thinking', 'Asha is checking...');
  try {
    const data = await api.sendMessage(state.sessionId, text);
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
}

// ---------- wiring ----------

$('#start-btn').addEventListener('click', startCall);
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
