// Progress against the month's targets, counted from the enquiries: received this
// month, quotes sent this month, and the value of enquiries won this month (in the
// target's currency; a win quoted in another currency is counted separately so
// it is not silently added at the wrong rate). Pure, for the tests.
const lineOf = (l) => (l?.line === 'pack' ? 'pack' : 'agri');
const closedAt = (l) => Date.parse((l.history || []).filter((x) => x.status === l.status).at(-1)?.at || l.createdAt);

/** The first moment of the month `now` is in, and how far through it we are (0 to 1). */
export function monthOf(now = Date.now()) {
  const d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  return { start, end, elapsed: Math.min(1, Math.max(0, (now - start) / (end - start))), name: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) };
}

/** { enquiries, quotes, wonValue: { done, target, ... }, month } for one line. */
export function progress(leads, target = {}, line = 'agri', now = Date.now()) {
  const m = monthOf(now);
  const mine = (leads || []).filter((l) => lineOf(l) === line);
  const enquiries = mine.filter((l) => Date.parse(l.createdAt) >= m.start && Date.parse(l.createdAt) <= now).length;
  const quotes = mine.reduce((n, l) => n + (l.activity || []).filter((a) => a.type === 'quote' && Date.parse(a.at) >= m.start && Date.parse(a.at) <= now).length, 0);
  const won = mine.filter((l) => l.status === 'won' && closedAt(l) >= m.start && closedAt(l) <= now);
  const currency = target.currency || (line === 'pack' ? 'ETB' : 'USD');
  const value = won.filter((l) => l.quote?.currency === currency).reduce((n, l) => n + (Number(l.quote.total) || 0), 0);
  const elsewhere = won.filter((l) => l.quote && l.quote.currency !== currency).length;
  const row = (done, t) => ({ done, target: t ?? null, share: t ? done / t : null, expected: t ? t * m.elapsed : null, onPace: t ? done >= t * m.elapsed : null });
  return {
    month: m,
    enquiries: row(enquiries, target.enquiries),
    quotes: row(quotes, target.quotes),
    wonValue: { ...row(Math.round(value), target.wonValue), currency, won: won.length, otherCurrency: elsewhere },
  };
}
