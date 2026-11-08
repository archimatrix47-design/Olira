// BOX wiring: the board every box plugs into. server.js is the one place boxes are
// connected; plug() calls a box and writes down what really happened: what it was
// given and by whom, what it offers, and which routes it added. Nothing is decided
// here, so a site with this board runs exactly as one without it. `npm run boxes`
// saves the record (boxes/wiring.json) and the tests compare the code with it.

/** @param {import('express').Express} app */
export function createBoard(app) {
  const plugged = [];
  const sources = new Map(); // a value a box offers -> which box and under what name

  const layers = () => app._router?.stack || [];
  const remember = (value, box, name, late = false) => {
    if (['function', 'object', 'string'].includes(typeof value) && value !== null && value !== '' && !sources.has(value)) sources.set(value, { box, name, late });
  };

  /** Connect a box: register(app, wires) runs at once and its result is returned. */
  function plug(id, register, wires = {}) {
    const before = layers().length;
    const out = register(app, wires);
    const offers = out && typeof out === 'object' ? out : {};
    const added = layers().slice(before);
    plugged.push({
      id,
      receives: Object.entries(wires).map(([name, value]) => {
        const s = sources.get(value);
        return s ? { name, from: s.box, as: s.name, ...(s.late ? { late: true } : {}) } : { name, from: null };
      }),
      offers: Object.keys(offers),
      routes: added.filter((l) => l.route).flatMap((l) => Object.keys(l.route.methods).filter((m) => m !== '_all').map((m) => `${m.toUpperCase()} ${l.route.path}`)),
      guards: added.filter((l) => !l.route).length,
    });
    for (const [name, value] of Object.entries(offers)) remember(value, id, name);
    if (out && typeof out === 'object') remember(out, id, 'the whole box');
    return out;
  }

  /**
   * A wire to a box that is plugged in later, for the few that wait on each other.
   * It is only called once the site is running, when every box exists.
   */
  function later(box, name, fn) {
    remember(fn, box, name, true);
    return fn;
  }

  return { plug, later, plugged };
}
