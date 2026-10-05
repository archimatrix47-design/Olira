// The phone quote bar (QuoteBar.astro): shown once the element named in
// data-after has scrolled up out of view, hidden while any element named in
// data-until (the form, the footer) is on screen, and never on wider screens.
// Hidden, it is inert: out of the tab order and the accessibility tree.
const bar = document.querySelector('[data-quote-bar]');
if (bar) {
  const phone = matchMedia('(max-width: 760px)');
  const after = document.querySelector(bar.dataset.after);
  const until = [...document.querySelectorAll(`${bar.dataset.until ? `${bar.dataset.until}, ` : ''}.sheet-foot`)];
  let past = false;
  const showing = new Set();
  const sync = () => {
    const show = phone.matches && past && !showing.size;
    bar.toggleAttribute('data-shown', show);
    bar.inert = !show;
    document.documentElement.toggleAttribute('data-quote-bar-shown', show); // the contact button moves up
  };
  if (after) new IntersectionObserver(([e]) => { past = !e.isIntersecting && e.boundingClientRect.bottom < 0; sync(); }).observe(after);
  const io = new IntersectionObserver((entries) => { for (const e of entries) e.isIntersecting ? showing.add(e.target) : showing.delete(e.target); sync(); });
  until.forEach((el) => io.observe(el));
  phone.addEventListener('change', sync);
}
