// Motion for the public pages, on GSAP (the only animation engine here).
//
// Choreography (ambient-ui transitions §7): one orchestrated moment per page and
// everything else answers the visitor.
//  - the moment: on the home page the two doors arrive together, side by side;
//    elsewhere the title rises line by line out of a mask and the rest of the
//    hero overlaps in at about two thirds of it
//  - answers: panels and the footer rise once as they scroll into view, the
//    catalogue re-forms when a group is chosen, and a small tab travels to the
//    packing list when a product is added
// Eases decelerate and settle without overshoot (apple-design: damping 1.0).
// Everything is set up inside gsap.matchMedia: with reduced motion the page is
// simply there, finished, and nothing moves.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Flip } from 'gsap/Flip';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(ScrollTrigger, Flip, SplitText);
gsap.defaults({ ease: 'power3.out', duration: 0.6 });

const mm = gsap.matchMedia();
export const motionOK = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;
const SETTLE = 'power3.out';

/** A panel arriving: it rises a little and fades in. */
export function trace(panel, delay = 0) {
  if (!motionOK()) return;
  return gsap.fromTo(panel, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55, ease: SETTLE, delay, clearProps: 'transform,opacity' });
}

mm.add('(prefers-reduced-motion: no-preference)', () => {
  const splits = [];

  // ---------- the one moment: the hero ----------
  // the home page's two doors arrive together, side by side, neither first
  const doors = gsap.utils.toArray('.door');
  if (doors.length) gsap.from(doors, { y: 28, opacity: 0, duration: 0.9, stagger: 0.08, ease: SETTLE, clearProps: 'transform,opacity' });
  const hero = document.querySelector('.title-block, .ag-hero, .lost');
  if (hero) {
    const h1 = hero.querySelector('h1');
    const rest = [...hero.querySelectorAll('.label, .sub, .acts, .brand-field')];
    const photo = hero.querySelector('.photo img');
    const tl = gsap.timeline({ defaults: { ease: SETTLE } });
    if (photo) tl.fromTo(photo, { scale: 1.08 }, { scale: 1, duration: 1.6, ease: 'power2.out', clearProps: 'transform' }, 0);
    if (h1) {
      // lines rise out of their own mask; autoSplit re-splits when fonts load or the width changes
      const split = SplitText.create(h1, {
        type: 'lines', mask: 'lines', autoSplit: true,
        onSplit: (self) => gsap.from(self.lines, { yPercent: 105, duration: 0.9, stagger: 0.08, ease: SETTLE, delay: 0.05 }),
      });
      splits.push(split);
    }
    // overlap, do not queue: the rest starts at about two thirds of the headline
    if (rest.length) tl.from(rest, { y: 16, opacity: 0, duration: 0.7, stagger: 0.06, clearProps: 'transform,opacity' }, 0.45);
  }

  // ---------- answers: panels and the footer rise once as they come into view ----------
  const RISE = '.press, .specsheet, .sheet-site .contact > *, .foot-top, .foot-col';
  const rising = gsap.utils.toArray(RISE);
  gsap.set(rising, { opacity: 0, y: 28 });
  ScrollTrigger.batch(rising, {
    start: 'top 90%', once: true,
    onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, duration: 0.7, stagger: 0.06, ease: SETTLE, clearProps: 'transform,opacity', overwrite: true }),
  });
  // a keyboard user tabbing ahead must never land on something still invisible
  const reveal = (e) => {
    const t = e.target.closest?.(RISE);
    if (t && e.target.matches?.(':focus-visible')) gsap.set(t, { clearProps: 'transform,opacity' });
  };
  document.addEventListener('focusin', reveal);

  // section headlines rise once
  gsap.utils.toArray('.band .headline, .sec-title h2').forEach((el) => {
    if (el.getBoundingClientRect().top < innerHeight * 0.9) return;
    gsap.from(el, { y: 24, opacity: 0, duration: 0.8, ease: SETTLE, clearProps: 'opacity,transform', scrollTrigger: { trigger: el, start: 'top 88%', once: true } });
  });

  // older sections that still mark themselves with data-rise
  gsap.utils.toArray('[data-rise]').forEach((el) => {
    if (el.getBoundingClientRect().top < innerHeight * 0.9 || el.closest('.contact')) return;
    gsap.from(el, { y: 22, opacity: 0, duration: 0.7, clearProps: 'opacity,transform', scrollTrigger: { trigger: el, start: 'top 90%', once: true } });
  });

  return () => {
    document.removeEventListener('focusin', reveal);
    splits.forEach((s) => s.revert());
    ScrollTrigger.getAll().forEach((t) => t.kill());
  };
});

// fonts and late images change heights; measure again once they are in
document.fonts?.ready.then(() => ScrollTrigger.refresh()).catch(() => {});
addEventListener('load', () => ScrollTrigger.refresh());

/**
 * Filtering: record where the panels are, apply the change, and move them from
 * the old layout to the new one. Panels that appear rise in; leaving ones fade.
 */
export function flip(targets, change) {
  if (!motionOK()) { change(); return; }
  const state = Flip.getState(targets);
  change();
  Flip.from(state, {
    duration: 0.5, ease: 'power3.inOut', absolute: true, nested: true, prune: true,
    onEnter: (els) => gsap.fromTo(els, { opacity: 0, scale: 0.96 }, { opacity: 1, scale: 1, duration: 0.4, delay: 0.1, clearProps: 'all' }),
    onLeave: (els) => gsap.to(els, { opacity: 0, scale: 0.96, duration: 0.25 }), // exits faster than entrances
  });
  ScrollTrigger.refresh();
}

/** A small labelled tab travels from `from` to `to` (the packing list counter). */
export function flyTo(from, to, label, done) {
  if (!motionOK() || !from || !to) { done?.(); return; }
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  const tab = document.createElement('span');
  tab.className = 'pl-fly'; tab.textContent = label; tab.setAttribute('aria-hidden', 'true');
  document.body.append(tab);
  const w = tab.offsetWidth;
  // duration scales with distance: about 200ms per 300px, within 0.35-0.7s
  const dist = Math.hypot(b.left - a.left, b.top - a.top);
  const d = Math.min(0.7, Math.max(0.35, (dist / 300) * 0.2));
  gsap.set(tab, { x: a.left + a.width / 2 - w / 2, y: a.top + a.height / 2 - 15 });
  gsap.timeline({ onComplete: () => { tab.remove(); done?.(); } })
    .to(tab, { x: b.left + b.width / 2 - w / 2, duration: d, ease: 'power2.inOut' }, 0)
    .to(tab, { y: b.top + b.height / 2 - 15, duration: d, ease: 'power2.in' }, 0)
    .to(tab, { scale: 0.4, opacity: 0, duration: 0.18 }, d - 0.15);
}

/** The counter answers when something is added: a small settle, no bounce. */
export function bump(el) {
  if (!motionOK() || !el) return;
  gsap.fromTo(el, { scale: 1.25 }, { scale: 1, duration: 0.4, ease: SETTLE, clearProps: 'transform' });
}

export { gsap, ScrollTrigger };
