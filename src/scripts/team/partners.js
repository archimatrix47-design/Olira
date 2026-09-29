// Both marketing workspaces: the partner logos on the home page (FAO, the World
// Bank and others). Add a logo with the organisation's name and an optional link,
// put them in order, remove any, and save the list (POST /api/team/partners).
// The logo file is uploaded first (POST /api/team/partners/logo); the server
// always stores it as a WebP image, an SVG included.
import { $, h, api, toast, busy } from '../admin/api.js';

let items = [];          // the list as edited: { id?, name, logo, url, width, height }
let saved = '[]';        // the list as last saved
let pending = null;      // the uploaded logo waiting for its name
let bound = false;
const say = (msg) => { const s = $('#tPtLive'); s.textContent = ''; setTimeout(() => { s.textContent = msg; }, 50); };
const isUrl = (v) => /^https?:\/\/\S+$/i.test(v);

export async function show() {
  if (!bound) { bound = true; bind(); }
  try {
    const list = await api('/api/partners');
    items = Array.isArray(list) ? list.map((p) => ({ ...p })) : [];
    saved = JSON.stringify(items);
    render();
  } catch (e) { if (e.status !== 401) toast(e.message, 'error'); }
}

const svgIcon = (d) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({ width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) s.setAttribute(k, v);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.append(p);
  return s;
};

function render(focus) {
  const list = $('#tPtList');
  list.replaceChildren(...items.map((p, i) => {
    const name = h('input', { class: 'input', value: p.name, maxlength: '80', 'aria-label': `Organisation ${i + 1}`, oninput: (e) => { p.name = e.target.value; dirty(); } });
    const url = h('input', { class: 'input', type: 'url', value: p.url || '', maxlength: '300', placeholder: 'Link (optional)', 'aria-label': `Link for ${p.name || `logo ${i + 1}`}`, oninput: (e) => { p.url = e.target.value; dirty(); } });
    return h('li', { class: 't-pt-item', 'data-i': String(i) },
      h('img', { src: p.logo, alt: '', width: '120', height: '40', loading: 'lazy' }),
      h('div', { class: 't-pt-fields' }, name, url),
      h('div', { class: 't-pt-actions' },
        h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': `Move ${p.name} earlier`, title: 'Move earlier', disabled: i === 0 || null, onclick: () => move(i, -1) }, svgIcon('M12 19V5M6 11l6-6 6 6')),
        h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': `Move ${p.name} later`, title: 'Move later', disabled: i === items.length - 1 || null, onclick: () => move(i, 1) }, svgIcon('M12 5v14M6 13l6 6 6-6')),
        h('button', { class: 'btn btn-danger-quiet btn-sm', type: 'button', 'aria-label': `Remove ${p.name}`, onclick: () => remove(i) }, 'Remove')));
  }));
  $('#tPtEmpty').hidden = items.length > 0;
  dirty();
  if (focus != null) list.querySelector(`[data-i="${focus}"] input`)?.focus();
}

function dirty() {
  const changed = JSON.stringify(items) !== saved;
  $('#tPtSave').disabled = !changed;
  $('#tPtNote').textContent = changed ? 'Not saved yet.' : items.length ? 'Saved. This is the row on the home page.' : '';
}

function move(i, d) {
  const j = i + d;
  if (j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j], items[i]];
  render();
  $(`#tPtList [data-i="${j}"] .btn-icon:${d < 0 ? 'first-child' : 'nth-child(2)'}`)?.focus();
  say(`${items[j].name} moved to position ${j + 1} of ${items.length}.`);
}

function remove(i) {
  const [p] = items.splice(i, 1);
  render(Math.min(i, items.length - 1));
  say(`${p.name} removed from the list. Save to take it off the home page.`);
}

function bind() {
  const input = $('#tPtFile'), drop = $('#tPtDrop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]); });
  input.addEventListener('change', () => { if (input.files[0]) upload(input.files[0]); input.value = ''; });
  $('#tPtName').addEventListener('input', () => { $('#tPtAdd').disabled = !pending; });
  $('#tPtAdd').addEventListener('click', add);
  $('#tPtSave').addEventListener('click', save);
}

async function upload(file) {
  if (!/^image\/(png|webp|jpeg|svg\+xml)$/.test(file.type)) return toast('Choose a PNG, SVG, WebP or JPG logo.', 'error');
  if (file.size > 5 * 1024 * 1024) return toast('The logo can be up to 5 MB.', 'error');
  const label = $('#tPtDropTitle'), text = label.textContent;
  label.textContent = 'Uploading';
  const fd = new FormData();
  fd.append('logo', file);
  fd.append('name', $('#tPtName').value || file.name.replace(/\.[^.]+$/, ''));
  try {
    const r = await api('/api/team/partners/logo', { method: 'POST', form: fd });
    pending = r;
    const img = $('#tPtPreview'); img.src = r.path; img.hidden = false;
    $('#tPtAdd').disabled = false;
    if (!$('#tPtName').value.trim()) $('#tPtName').focus();
    say('Logo uploaded. Add the organisation\'s name, then add it to the list.');
  } catch (e) { toast(e.message, 'error'); }
  finally { label.textContent = text; }
}

function fieldError(id, msg) { const err = $(`#${id}Err`), el = $(`#${id}`); err.textContent = msg || ''; err.hidden = !msg; if (msg) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid'); return !msg; }

function add() {
  if (!pending) return;
  const name = $('#tPtName').value.trim(), url = $('#tPtUrl').value.trim();
  const ok = fieldError('tPtName', name ? '' : 'Add the organisation\'s name.') & fieldError('tPtUrl', !url || isUrl(url) ? '' : 'Paste the full link, starting with https://');
  if (!ok) return (name ? $('#tPtUrl') : $('#tPtName')).focus();
  items.push({ name, url, logo: pending.path, width: pending.width, height: pending.height });
  pending = null;
  $('#tPtName').value = ''; $('#tPtUrl').value = '';
  const img = $('#tPtPreview'); img.hidden = true; img.removeAttribute('src');
  $('#tPtAdd').disabled = true;
  render(items.length - 1);
  say(`${name} added. Save to show it on the home page.`);
}

async function save() {
  const bad = items.findIndex((p) => !p.name.trim() || (p.url && !isUrl(p.url.trim())));
  if (bad >= 0) { toast(!items[bad].name.trim() ? `Logo ${bad + 1} needs the organisation's name.` : `The link for ${items[bad].name} must start with https://`, 'error'); return $(`#tPtList [data-i="${bad}"] input`)?.focus(); }
  const done = busy($('#tPtSave'));
  try {
    const r = await api('/api/team/partners', { method: 'POST', body: { partners: items.map((p) => ({ id: p.id, name: p.name.trim(), logo: p.logo, url: (p.url || '').trim(), width: p.width, height: p.height })) } });
    items = r.partners.map((p) => ({ ...p }));
    saved = JSON.stringify(items);
    render();
    toast(items.length ? 'Partner logos saved. The home page shows them now.' : 'Partner logos saved. The row is hidden on the home page.');
    say('Partner logos saved.');
  } catch (e) { toast(e.message, 'error'); }
  finally { done(); }
}
