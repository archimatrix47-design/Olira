// Flexographic printing, shown as a press: one ink station per colour. Choosing
// how many colours lights the stations one after another, and each station lays
// its part of a sample print on kraft stock, sliding into register as it lands.
import { $, $$ } from './common.js';
import { fade } from './motion.js';

const press = $('#press');
if (press) {
  const stations = $$('.station', press);
  const layers = $$('.proof-layer', press);
  const bars = $$('.colour-bar li', press);
  const note = $('#pressNote');
  let shown = -1;
  let first = true;

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
      // the first setting appears as it is; a change after that lays the new colours one by one
      if (first) fade(l, on, { instant: true });
      else if (on && i >= from) fade(l, true, { delay: (i - from) * 160 });
      else if (!on && l.style.opacity !== '0') fade(l, false);
    });
    first = false;
  }

  $$('input[name="colours"]', press.closest('section')).forEach((r) => r.addEventListener('change', () => { if (r.checked) set(Number(r.value)); }));
  const start = $('input[name="colours"]:checked', press.closest('section'));
  set(Number(start?.value ?? 2));
}
