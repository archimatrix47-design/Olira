// The floating contact button (ContactFab.astro). It opens when the pointer rests
// on it, when it is pressed (touch screens) and when the keyboard reaches it; it
// closes a moment after the pointer leaves, on Escape, and on a press elsewhere.
// It stays open while the WhatsApp number is showing. Social pages the admin or a
// marketing team saved since the page was built are shown from the live data.
import { ICONS } from './social-icons.js';
import { SOCIAL_PAGES } from '../../lib/social.js';

const fab = document.querySelector('[data-fab]');
if (fab) {
  const main = fab.querySelector('.fab-main');
  const list = fab.querySelector('.fab-list');
  const pop = fab.querySelector('.fab-pop');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  let leaveTimer = 0;

  const setOpen = (open) => {
    fab.classList.toggle('is-open', open);
    main.setAttribute('aria-expanded', String(open));
    if (!open && !pop.hidden) pop.hidden = true;
  };
  const isOpen = () => fab.classList.contains('is-open');

  main.addEventListener('click', () => {
    setOpen(!isOpen());
    if (isOpen()) list.querySelector('li:not([hidden]) .fab-btn')?.focus({ preventScroll: true });
  });
  fab.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && fine.matches) { clearTimeout(leaveTimer); setOpen(true); } });
  fab.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse' || !fine.matches) return;
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => { if (pop.hidden && !fab.contains(document.activeElement)) setOpen(false); }, 350);
  });
  fab.addEventListener('focusout', () => setTimeout(() => { if (!fab.contains(document.activeElement) && pop.hidden) setOpen(false); }, 0));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) { setOpen(false); main.focus(); } });
  document.addEventListener('click', (e) => { if (isOpen() && !fab.contains(e.target)) setOpen(false); });

  // live social pages: the order and labels of lib/social.js
  document.addEventListener('social:live', (e) => {
    const social = e.detail || {};
    list.querySelectorAll('[data-fab-social]').forEach((li) => li.remove());
    const start = list.children.length;
    SOCIAL_PAGES.filter((p) => /^https?:\/\//.test(social[p.key] || '')).forEach((p, i) => {
      const li = document.createElement('li');
      li.dataset.fabSocial = p.key;
      li.style.setProperty('--i', String(start + i));
      const a = document.createElement('a');
      a.className = 'fab-btn'; a.href = social[p.key]; a.target = '_blank'; a.rel = 'noopener';
      a.setAttribute('aria-label', `Olira on ${p.label}`);
      a.innerHTML = ICONS[p.key] || ICONS.chat; // fixed icon markup, never saved text
      const tip = document.createElement('span');
      tip.className = 'fab-tip'; tip.setAttribute('aria-hidden', 'true'); tip.textContent = p.label;
      a.append(tip);
      li.append(a);
      list.append(li);
    });
    const tg = list.querySelector('[data-fab-channel="telegram"]');
    if (tg) tg.hidden = !/^https:\/\/\S+$/.test(social.telegram || '');
  });
}
