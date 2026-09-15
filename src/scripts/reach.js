// The call and WhatsApp icons (src/components/site/ReachIcons.astro). Numbers
// are fetched only when a visitor presses an icon, so they never sit in the
// page for a scraper to collect.
const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  n.append(...kids.filter((k) => k != null));
  return n;
};

let pending = null;
export function reveal() {
  if (!pending) {
    pending = fetch('/api/contact/reveal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
    pending.catch(() => { pending = null; }); // allow a retry
  }
  return pending;
}

function copyButton(text) {
  const btn = h('button', { type: 'button', class: 'reach-copy' }, 'Copy');
  btn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; }
    catch (e) { btn.textContent = 'Copy failed'; }
    setTimeout(() => { btn.textContent = 'Copy'; }, 1800);
  });
  return btn;
}

let open = null; // { root, button }
function close(returnFocus) {
  if (!open) return;
  open.root.querySelector('.reach-pop').hidden = true;
  open.button.setAttribute('aria-expanded', 'false');
  if (returnFocus) open.button.focus();
  open = null;
}

async function show(root, button) {
  const kind = button.dataset.reachKind;
  if (open && open.button === button) return close(false);
  close(false);
  const pop = root.querySelector('.reach-pop');
  pop.setAttribute('aria-label', kind === 'phone' ? 'Call Olira' : 'WhatsApp');
  pop.replaceChildren(h('p', { class: 'reach-note' }, 'Loading'));
  pop.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  open = { root, button };
  try {
    const data = await reveal();
    if (!open || open.button !== button) return;
    try { window.oliraTrack?.(kind === 'phone' ? 'reveal_phone' : 'reveal_whatsapp'); } catch (x) {}
    if (kind === 'phone') {
      if (!data.phones?.length) throw new Error('none');
      pop.replaceChildren(h('strong', {}, 'Call Olira'), ...data.phones.map((p) =>
        h('div', { class: 'reach-line' },
          h('div', {}, h('small', {}, p.label), h('a', { class: 'reach-num', href: p.href }, p.display)),
          copyButton(p.display))));
    } else {
      if (!data.whatsapp) throw new Error('none');
      pop.replaceChildren(
        h('strong', {}, 'WhatsApp'),
        h('div', { class: 'reach-line' }, h('span', { class: 'reach-num' }, data.whatsapp.display), copyButton(data.whatsapp.display)),
        h('a', { class: 'btn btn-primary reach-go', href: data.whatsapp.href, target: '_blank', rel: 'noopener' }, 'Open WhatsApp'));
    }
    pop.querySelector('a, button')?.focus({ preventScroll: true });
  } catch (e) {
    if (!open || open.button !== button) return;
    const retry = h('button', { type: 'button', class: 'reach-copy' }, 'Try again');
    retry.addEventListener('click', () => { close(false); show(root, button); });
    pop.replaceChildren(h('p', { class: 'reach-note' }, e.message === '429' ? 'Too many requests. Wait a minute, or email us.' : 'The number could not load. Try again, or email us.'), retry);
  }
}

for (const root of document.querySelectorAll('[data-reach]')) {
  for (const btn of root.querySelectorAll('[data-reach-kind]')) btn.addEventListener('click', () => show(root, btn));
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) close(true); });
document.addEventListener('click', (e) => { if (open && !open.root.contains(e.target)) close(false); });
