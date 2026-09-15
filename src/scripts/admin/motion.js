// Input modality and motion. Keyboard-initiated actions appear instantly;
// pointer-initiated ones may animate (ambient-ui Law 11, emil-kowalski.md §1).
// The last input is mirrored on <html data-input="keyboard|pointer"> so CSS can
// drop transitions for keyboard users, and scripts ask scrollBehavior().
const root = document.documentElement;
let keyboard = false;
const set = (kb) => { if (kb === keyboard && root.dataset.input) return; keyboard = kb; root.dataset.input = kb ? 'keyboard' : 'pointer'; };
addEventListener('keydown', (e) => { if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) set(true); }, true);
addEventListener('pointerdown', () => set(false), true);
addEventListener('pointermove', () => { if (keyboard) set(false); }, { capture: true, passive: true });
set(false);

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
/** True when a movement may animate: pointer input and no reduced-motion preference. */
export const mayAnimate = (event) => !reduced.matches && !(event ? event.detail === 0 : keyboard);
/** 'smooth' for pointer users, 'auto' (instant) for keyboard users and reduced motion. */
export const scrollBehavior = (event) => (mayAnimate(event) ? 'smooth' : 'auto');

/* ---------- keep focus across a re-render ----------
   Views here rebuild parts of the page after every save. Without this, a keyboard
   or screen reader user is dropped to <body> and has to find their place again.
   Containers that get rebuilt carry data-focus-scope="unique-key"; the focused
   control is described relative to its scope and found again afterwards. */
// A button disabled while its save runs loses focus without any event, so the
// last control that received focus is remembered and used when focus is on <body>.
let lastFocused = null;
addEventListener('focusin', (e) => { lastFocused = e.target; }, true);

export function captureFocus() {
  let el = document.activeElement;
  if ((!el || el === document.body) && lastFocused?.isConnected && lastFocused.closest('[data-focus-scope]')) el = lastFocused;
  if (!el || el === document.body) return null;
  const scope = el.closest('[data-focus-scope]');
  if (!scope) return null;
  const tag = el.tagName;
  return {
    scope: scope.dataset.focusScope, tag,
    name: el.getAttribute('name'), label: el.getAttribute('aria-label'),
    text: (el.textContent || '').trim().slice(0, 60),
    index: [...scope.querySelectorAll(tag)].indexOf(el),
    fallback: el.dataset.focusFallback || null,
    // keep the caret in text fields
    selection: typeof el.selectionStart === 'number' ? [el.selectionStart, el.selectionEnd] : null,
  };
}
export function restoreFocus(key) {
  if (!key) return;
  const scope = document.querySelector(`[data-focus-scope="${CSS.escape(key.scope)}"]`);
  if (!scope) return;
  if (document.activeElement && document.activeElement !== document.body && scope.contains(document.activeElement)) return;
  const all = [...scope.querySelectorAll(key.tag)].filter((e) => !e.hidden && !e.closest('[hidden]'));
  const visible = (e) => e && !e.hidden && !e.closest('[hidden]') && !e.disabled;
  let target = null;
  if (key.fallback) target = scope.querySelector(key.fallback);
  if (!visible(target) && key.name) target = all.find((e) => e.getAttribute('name') === key.name);
  if (!visible(target) && key.label) target = all.find((e) => e.getAttribute('aria-label') === key.label);
  if (!visible(target) && key.text) target = all.find((e) => (e.textContent || '').trim().slice(0, 60) === key.text);
  if (!visible(target)) target = scope.querySelectorAll(key.tag)[key.index];
  if (!visible(target)) target = scope.querySelector('button:not([hidden]), select, input:not([type=hidden]), textarea, a[href]');
  if (!visible(target)) { target = scope.querySelector('h1, h2, h3') || scope; target.tabIndex = -1; }
  target.focus({ preventScroll: true });
  if (key.selection && typeof target.setSelectionRange === 'function' && target.tagName === key.tag) {
    try { target.setSelectionRange(...key.selection); } catch (e) {}
  }
}
