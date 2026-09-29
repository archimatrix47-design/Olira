// Flexographic printing, shown as a press: one ink station per colour. Choosing
// how many colours lights the stations one after another, and each station lays
// its part of a sample print on kraft stock, sliding into register as it lands.
import { $, $$ } from './common.js';
import { gsap, motionOK } from './motion.js';

const press = $('#press');
if (press) {
  const stations = $$('.station', press);
  const layers = $$('.proof-layer', press);
  const bars = $$('.colour-bar li', press);
  const note = $('#pressNote');
  let shown = -1;

  function set(n) {
    if (n === shown) return;
    const from = Math.max(0, shown);
    shown = n;
    stations.forEach((s, i) => s.classList.toggle('is-on', i < n));
    bars.forEach((b, i) => b.classList.toggle('is-on', i < n));
    note.textContent = n === 0
      ? 'Plain: the stock is left unprinted.'
      : `${n} ink station${n === 1 ? '' : 's'}: ${stations.slice(0, n).map((s) => s.dataset.ink.toLowerCase()).join(', ')}. Each colour is printed by its own station, in register with the others.`;
    layers.forEach((l, i) => {
      const on = i < n;
      if (!motionOK()) { gsap.set(l, { autoAlpha: on ? 1 : 0, x: 0, y: 0 }); return; }
      if (on && i >= from) {
        gsap.fromTo(l, { autoAlpha: 0, x: -10, y: 6 }, { autoAlpha: 1, x: 0, y: 0, duration: 0.45, delay: (i - from) * 0.16, ease: 'power3.out' });
      } else if (!on) {
        gsap.to(l, { autoAlpha: 0, duration: 0.2 });
      }
    });
  }

  $$('input[name="colours"]', press.closest('section')).forEach((r) => r.addEventListener('change', () => { if (r.checked) set(Number(r.value)); }));
  const start = $('input[name="colours"]:checked', press.closest('section'));
  set(Number(start?.value ?? 2));
}
