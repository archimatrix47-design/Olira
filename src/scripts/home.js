// Home: the product names on each half are an index into its photos. Pointing
// at "Pulses" shows pulses behind the half; leaving the name restores the scene.
// Keyboard focus swaps the photo without the fade: an action that is repeated
// with the keyboard should not be made to wait.
for (const half of document.querySelectorAll('.half')) {
  const layer = half.querySelector('.half-peek');
  const img = layer?.querySelector('img');
  const links = [...half.querySelectorAll('.index a[data-photo]')];
  if (!img || !links.length) continue;

  // fetch the photos the first time the pointer or focus comes near, not on load
  let warmed = false;
  const warm = () => {
    if (warmed) return;
    warmed = true;
    for (const a of links) { const i = new Image(); i.src = a.dataset.photo; }
  };
  half.addEventListener('pointerenter', warm);
  half.addEventListener('focusin', warm);

  let token = 0;
  const show = async (a, instant) => {
    const t = ++token;
    if (!img.src.endsWith(a.dataset.photo)) {
      img.src = a.dataset.photo;
      try { await img.decode(); } catch (e) { return; }
    }
    if (t !== token) return;
    half.classList.toggle('peek-instant', instant);
    half.classList.add('is-peeking');
    for (const x of links) x.classList.toggle('is-shown', x === a);
  };
  const hide = () => {
    token++;
    half.classList.remove('is-peeking');
    for (const x of links) x.classList.remove('is-shown');
  };

  for (const a of links) {
    a.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') show(a, false); });
    a.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
    a.addEventListener('focus', () => show(a, !a.matches(':hover')));
    a.addEventListener('blur', hide);
  }
}
