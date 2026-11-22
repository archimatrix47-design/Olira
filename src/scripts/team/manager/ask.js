// Manager, Ask the data: a question about the website in plain words, answered by
// the website itself from its performance log (lib/ai-log.js) and the enquiries,
// worked out in this browser by lib/ask-rules.js: no AI model is needed. Each answer
// gives the figures, the change on the period before and the screen to check them.
// When the admin has connected a local model (lib/ai-access.js), the manager can tick
// "Use the local model" to ask it instead: the question and the log then go from this
// browser straight to the model on this computer. Answers are shown as text only,
// never as HTML. "Download the data log" gives the same log as a file.
import { $, $$, h, api, toast, busy } from '../../admin/api.js';
import { messagesFor, requestFor, readLine, streamLines } from './ask-model.js';
import { answer as builtIn, periodOf } from '../../../../lib/ask-rules.js';
import { barList } from '../../admin/charts.js';
import * as store from '../../admin/store.js';
import { session, followupsOf } from '../session.js';

let bound = false, cfg = null, schema = null, controller = null;
let log = null, logDays = 0;
let history = []; // this conversation: { q, a }
const PROGRAM = { ollama: 'Ollama', openai: 'the model server' };

export async function show() {
  if (!bound) { bound = true; bind(); }
  try {
    const r = await api('/api/team/manager/ai');
    cfg = r.llm; schema = r.schema;
  } catch (e) { cfg = null; if (e.status !== 401) toast(e.message, 'error'); }
  const model = $('#askModel');
  model.textContent = cfg
    ? `Answers come from the website's own numbers, worked out in this browser. A local model is also connected (${cfg.model}, in ${PROGRAM[cfg.kind] || 'a model server'} on this computer): tick "Use the local model" to ask it instead.`
    : "Answers come from the website's own numbers, worked out in this browser: no AI model is used, and nothing leaves this computer.";
  model.classList.toggle('is-off', false);
  $('#askUseModelRow').hidden = !cfg;
  if (!cfg) $('#askUseModel').checked = false;
  $('#askGo').disabled = false;
  $$('[data-ask-idea]').forEach((b) => { b.disabled = false; });
}

const days = () => Number($('#askDays').value) || 30;
async function getLog() {
  if (log && logDays === days()) return log;
  log = await api(`/api/team/manager/ai-log?days=${days()}`);
  logDays = days();
  return log;
}

function bind() {
  $('#askForm').addEventListener('submit', (e) => { e.preventDefault(); ask($('#askQ').value.trim()); });
  $('#askQ').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ask($('#askQ').value.trim()); } });
  $$('[data-ask-idea]').forEach((b) => b.addEventListener('click', () => { $('#askQ').value = b.textContent.trim(); ask(b.textContent.trim()); }));
  $('#askStop').addEventListener('click', () => controller?.abort());
  $('#askClear').addEventListener('click', () => { history = []; $('#askThread').replaceChildren(); $('#askClear').hidden = true; $('#askQ').focus(); });
  // a new period is a new log: the conversation so far was about the old one
  $('#askDays').addEventListener('change', () => { if (history.length) { history = []; $('#askThread').replaceChildren(); $('#askClear').hidden = true; } });
  $('#askDownload').addEventListener('click', async (e) => {
    const done = busy(e.currentTarget, 'Preparing');
    try {
      const data = await getLog();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = h('a', { href: url, download: `olira-site-log-${data.period.to}-${data.period.days}d.json` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('Data log downloaded: counts and totals only, no personal details.');
    } catch (err) { toast(err.message, 'error'); }
    done();
  });
}

function ask(question) {
  return cfg && $('#askUseModel').checked ? askModel(question) : askWebsite(question);
}

/** The website's own answer (lib/ask-rules.js): sentences, a small chart, where to check. */
async function askWebsite(question) {
  if (controller) return;
  if (!question) { toast('Type a question, or choose one above.', 'error'); $('#askQ').focus(); return; }
  const want = periodOf(question);
  if (want && want !== days()) $('#askDays').value = String(want); // "this week" asks about the last 7 days
  const out = h('div', { class: 'a-ask-a', 'aria-busy': 'true' }, 'Working it out.');
  $('#askThread').append(h('div', { class: 'a-ask-turn' }, h('p', { class: 'a-ask-q' }, question), out));
  $('#askQ').value = '';
  try {
    const [data, inbox] = await Promise.all([getLog(), store.inquiries()]);
    const leads = Array.isArray(inbox?.inquiries) ? inbox.inquiries : [];
    const a = builtIn(question, { log: data, leads, members: session.members, overdue: followupsOf(leads) });
    out.replaceChildren(...[
      ...a.lines.map((s) => h('p', {}, s)),
      a.bars?.length ? barList(a.bars) : null,
      a.ideas ? h('div', { class: 'a-ask-ideas' }, a.ideas.map((idea) => h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => { $('#askQ').value = idea; ask(idea); } }, idea))) : null,
      a.link ? h('p', { class: 'a-ask-check' }, h('a', { href: a.link.href }, `Check it in ${a.link.label}`)) : null,
    ].filter(Boolean));
    $('#askStatus').textContent = a.lines[0] || 'Answer ready.';
    $('#askClear').hidden = false;
  } catch (e) {
    if (e.status !== 401) { out.textContent = e.message; out.classList.add('is-error'); }
  } finally {
    out.removeAttribute('aria-busy');
    $('#askQ').focus();
  }
}

async function askModel(question) {
  if (!cfg || controller) return;
  if (!question) { toast('Type a question, or choose one above.', 'error'); $('#askQ').focus(); return; }
  const status = $('#askStatus'), go = $('#askGo'), stop = $('#askStop');
  const answer = h('div', { class: 'a-ask-a', 'aria-busy': 'true' }, 'Reading the log.');
  $('#askThread').append(h('div', { class: 'a-ask-turn' }, h('p', { class: 'a-ask-q' }, question), answer));
  $('#askQ').value = '';
  go.disabled = true; stop.hidden = false;
  status.textContent = 'Asking the model. The answer appears below.';
  controller = new AbortController();
  let text = '';
  try {
    const data = await getLog();
    answer.textContent = 'Thinking. A local model can take a minute.';
    const { url, body } = requestFor(cfg, messagesFor(question, history, data, schema));
    let r;
    try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal }); }
    catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new Error(`The model at ${cfg.url} did not answer. Check that ${PROGRAM[cfg.kind] || 'it'} is running on this computer and allows this website (the admin's AI access page explains how), and that the browser was allowed to reach it.`);
    }
    if (!r.ok || !r.body) {
      const said = await r.text().catch(() => '');
      if (r.status === 404 && /not found/i.test(said)) throw new Error(`The model ${cfg.model} is not on this computer. Download it there first, or ask the admin to name one that is.`);
      throw new Error(`The model answered with an error (status ${r.status}).`);
    }
    for await (const line of streamLines(r.body)) {
      const part = readLine(cfg.kind, line);
      if (!part) continue;
      if (part.error) throw new Error(`The model said: ${part.error}`);
      if (part.text) { text += part.text; answer.textContent = text; }
      if (part.done) break;
    }
    if (!text.trim()) throw new Error('The model sent an empty answer. Try asking again, more simply.');
    history.push({ q: question, a: text });
    status.textContent = 'Answer ready.';
    $('#askClear').hidden = false;
  } catch (e) {
    if (e.name === 'AbortError') { answer.textContent = text ? `${text}\n\n(Stopped.)` : 'Stopped.'; status.textContent = 'Stopped.'; }
    else { answer.textContent = e.message; answer.classList.add('is-error'); status.textContent = e.message; }
  } finally {
    answer.removeAttribute('aria-busy');
    controller = null;
    go.disabled = false; stop.hidden = true;
    $('#askQ').focus();
  }
}
