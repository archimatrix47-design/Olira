// The admin's activity log: sign-ins, problems (wrong passwords, lockouts,
// requests from other websites) and every change to the website, newest first,
// grouped by day. Read from the server's audit log (lib/admin-tools.js); the
// text is written by the server, so it is only ever shown as text here.
import { $, $$, h, api, toast } from './api.js';

let bound = false;
const KIND = { signin: 'Sign-in', change: 'Change', problem: 'Problem' };
const day = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

export async function show() {
  if (!bound) {
    bound = true;
    $$('input[name="activityKind"]').forEach((r) => r.addEventListener('change', load));
  }
  await load();
}

function row(it) {
  const d = new Date(it.at);
  return h('li', { class: `a-activity-item is-${it.kind}` },
    h('time', { datetime: it.at }, time.format(d)),
    h('div', {},
      h('strong', {}, it.text),
      h('span', {}, [KIND[it.kind], it.device, it.ip ? `from ${it.ip}` : null].filter(Boolean).join(', '))));
}

/** Several sign-ins in a row (newest first): one line naming who, opening to each. */
function signins(run) {
  const names = [...new Set(run.map((it) => String(it.text).replace(/ signed in$/i, '')))];
  const from = time.format(new Date(run[run.length - 1].at)), to = time.format(new Date(run[0].at));
  return h('li', { class: 'a-activity-item is-signin a-activity-group' },
    h('time', { datetime: run[0].at }, to),
    h('details', {},
      h('summary', {}, h('strong', {}, `${run.length} sign-ins${from === to ? ` at ${to}` : ` between ${from} and ${to}`}`), h('span', {}, names.join(', '))),
      h('ul', {}, run.map(row))));
}

async function load() {
  const list = $('#activityList');
  const kind = $('input[name="activityKind"]:checked').value;
  list.setAttribute('aria-busy', 'true');
  try {
    const { items } = await api(`/api/admin/activity${kind ? `?kind=${kind}` : ''}`);
    $('#activitySummary').textContent = `${items.length} ${items.length === 1 ? 'entry' : 'entries'} shown.`;
    if (!items.length) {
      list.replaceChildren(h('li', { class: 'a-empty' }, h('strong', {}, kind === 'problem' ? 'No problems' : 'Nothing yet'), kind === 'problem' ? 'No wrong passwords, lockouts or refused requests in the log.' : 'Sign-ins and changes appear here as they happen.'));
      return;
    }
    const out = [];
    let last = '';
    // In "Everything", a run of three or more sign-ins on one day folds into one line
    // that opens to show each, so changes and problems are not buried under them.
    let run = [];
    const flush = () => {
      if (run.length >= 3) out.push(signins(run));
      else out.push(...run.map(row));
      run = [];
    };
    for (const it of items) {
      const label = day.format(new Date(it.at));
      if (label !== last) { flush(); out.push(h('li', { class: 'a-activity-day' }, h('h2', {}, label))); last = label; }
      if (!kind && it.kind === 'signin') { run.push(it); continue; }
      flush();
      out.push(row(it));
    }
    flush();
    list.replaceChildren(...out);
  } catch (e) {
    if (e.status !== 401) toast(e.message, 'error');
  } finally {
    list.removeAttribute('aria-busy');
  }
}
