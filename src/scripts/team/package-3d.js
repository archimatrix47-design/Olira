// Workspace: the 3D view (box packaging-3d), for the packaging team and the manager.
// Each holds one switch; 3D shows on the website only while both are on. The screen
// shows both switches, who moved them and when, what each product still needs before
// it can be shown in 3D, and a preview of any ready product as visitors will see it
// (the preview works whatever the switches say).
//   GET/POST /api/team/packaging-3d, GET /api/packaging-products?scope=all
import { $, api, toast } from '../admin/api.js';
import { has3d, measuredSizes, needsDepth, BOX_STYLES } from '../../../lib/box-styles.js';

let bound = false, data = null, products = [], viewer = null, previewing = null;
const say = (msg) => { const s = $('#v3Live'); s.textContent = ''; setTimeout(() => { s.textContent = msg; }, 50); };
const NAMES = { team: 'Packaging team', manager: 'Manager' };
const when = (iso) => { try { return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };

export async function show() {
  if (!bound) { bound = true; bind(); }
  try {
    [data, products] = await Promise.all([api('/api/team/packaging-3d'), api('/api/packaging-products?scope=all')]);
    render();
  } catch (e) { if (e.status !== 401) toast(e.message, 'error'); }
}

function render() {
  const mine = data.yours, other = mine === 'manager' ? 'team' : 'manager';
  const state = $('#v3State');
  state.textContent = data.live ? 'On the website' : 'Not on the website';
  state.classList.toggle('on', data.live); state.classList.toggle('off', !data.live);
  const sw = $('#v3Mine');
  sw.checked = data[mine].on; sw.disabled = false;
  $('#v3MineHint').textContent = `Your switch${data[mine].at ? `, last moved by ${data[mine].by || 'someone'} on ${when(data[mine].at)}` : ''}. Changes reach visitors on their next page, with no rebuild.`;
  const o = $('#v3Other');
  o.textContent = `${NAMES[other]}: ${data[other].on ? 'on' : 'off'}`;
  o.classList.toggle('on', data[other].on); o.classList.toggle('off', !data[other].on);
  $('#v3OtherWhen').textContent = data[other].at ? `Moved by ${data[other].by || 'someone'} on ${when(data[other].at)}.` : 'Not moved yet.';
  $('#v3Gate').textContent = data.live
    ? '3D is on the website: both switches are on. Turning either off takes it off.'
    : data[mine].on ? `3D is not on the website yet: it waits for the ${NAMES[other].toLowerCase()} to switch theirs on.`
      : data[other].on ? '3D is not on the website: the other switch is on and waits for yours.'
        : '3D is not on the website: both switches are off. It shows only when both are on.';
  renderProducts();
}

/** One row per product: its 3D shape, its measured sizes, and a preview when it is ready. */
function renderProducts() {
  const list = $('#v3Products');
  const rows = products.filter((p) => p && p.id && p.name).map((p) => {
    const li = document.createElement('li');
    const text = document.createElement('div'); text.className = 'v3-row-text';
    const name = document.createElement('strong'); name.textContent = p.name;
    const meta = document.createElement('div'); meta.className = 'a-row-meta';
    const shape = BOX_STYLES[p.shape3d];
    const m = measuredSizes(p);
    const ready = has3d(p);
    const tag = document.createElement('span');
    tag.className = `a-tag ${ready ? 'stage-won' : 'warn'}`;
    tag.textContent = ready ? 'Ready' : !shape ? 'No 3D shape' : 'Needs measurements';
    const detail = document.createElement('span');
    detail.textContent = !shape ? (data.yours === 'manager' ? 'No 3D shape chosen yet: the packaging team sets it' : 'Choose its 3D shape in Packaging products')
      : `${shape.label}. ${m.of ? `${m.done} of ${m.of} sizes measured` : 'No sizes yet'}${ready || !m.of ? '' : needsDepth(p.shape3d) ? ' (width, depth and height)' : ' (width and height)'}`;
    meta.append(tag, detail);
    if (p.site === false) { const hid = document.createElement('span'); hid.textContent = 'Hidden from the website'; meta.append(hid); }
    text.append(name, meta);
    li.append(text);
    if (ready) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn btn-secondary btn-sm'; b.textContent = 'Preview';
      b.setAttribute('aria-label', `Preview ${p.name} in 3D`);
      b.addEventListener('click', () => preview(p));
      const acts = document.createElement('div'); acts.className = 'a-row-actions'; acts.append(b);
      li.append(acts);
    }
    return li;
  });
  const ready = products.filter(has3d).length;
  const head = document.createElement('li'); head.className = 'hint';
  head.textContent = `${ready} of ${products.length} products ready for 3D.`;
  list.replaceChildren(head, ...rows);
}

async function preview(p) {
  previewing = p;
  const card = $('#v3Preview');
  card.hidden = false;
  $('#v3PreviewTitle').textContent = `Preview: ${p.name}`;
  $('#v3About').textContent = `${BOX_STYLES[p.shape3d].label}. Drag to turn it. Choose a size and try a print beside it, as a visitor can.`;
  viewer?.destroy();
  $('#v3PanelHost').replaceChildren();
  const anchor = document.createElement('div');
  $('#v3PanelHost').append(anchor);
  const stage = $('#v3Stage');
  const { mountViewer } = await import('../package-3d/viewer.js');
  if (previewing !== p) return;
  viewer = mountViewer({ media: stage, panelHost: anchor, product: p, panelOpen: true });
  await viewer.start();
  if (!stage.classList.contains('has-3d')) $('#v3About').textContent = 'This device cannot show the 3D view.';
  card.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  say(`Previewing ${p.name} in 3D.`);
}

function bind() {
  $('#v3Mine').addEventListener('change', async (e) => {
    const sw = e.currentTarget, on = sw.checked;
    sw.disabled = true;
    try {
      data = await api('/api/team/packaging-3d', { method: 'POST', body: { on } });
      render();
      toast(data.live ? '3D is on the website.' : on ? 'Your switch is on. 3D shows once the other switch is on too.' : '3D is off the website.');
    } catch (err) { sw.checked = !on; toast(err.message, 'error'); }
    sw.disabled = false;
  });
  $('#v3Close').addEventListener('click', () => {
    viewer?.destroy(); viewer = null; previewing = null;
    $('#v3Preview').hidden = true;
    say('Preview closed.');
  });
}
