// Buyers: enquiries from the same company are one buyer, however the company
// wrote its name, and an enquiry without a company joins it by business email.
import test from 'node:test';
import assert from 'node:assert/strict';
import { companyKey, groupBuyers, summarise } from '../src/scripts/team/buyer-groups.js';

const at = (d) => `2026-${d}T10:00:00.000Z`;

test('company names are compared without their legal form or punctuation (self-check)', () => {
  assert.equal(companyKey('Gulf Trading L.L.C.'), 'gulf trading');
  assert.equal(companyKey('Gulf Trading LLC'), 'gulf trading');
  assert.equal(companyKey('gulf  trading, llc'), 'gulf trading');
  assert.equal(companyKey('Importer B.V.'), 'importer');
  assert.equal(companyKey(''), '');
  assert.notEqual(companyKey('Gulf Trading'), companyKey('Gulf Foods'));
});

test('one buyer per company: by name, then business domain, then email', () => {
  const leads = [
    { id: 'a', name: 'Omar', email: 'omar@gulf-trading.ae', company: 'Gulf Trading LLC', createdAt: at('09-01'), status: 'won', line: 'agri', product: 'Humera Sesame Seeds', quote: { currency: 'USD', total: 92500 }, phone: '+971 50 000 0000' },
    { id: 'b', name: 'Sara', email: 'sara@gulf-trading.ae', company: 'Gulf Trading L.L.C.', createdAt: at('09-20'), status: 'quoted', line: 'agri', product: 'Pulses & Legumes', quote: { currency: 'USD', total: 40000 } },
    { id: 'c', name: 'Omar', email: 'omar@gulf-trading.ae', company: '', createdAt: at('10-01'), status: 'new', line: 'pack', product: 'Packaging' },
    { id: 'd', name: 'Hana', email: 'hana@gmail.com', company: '', createdAt: at('09-05'), status: 'lost', line: 'agri' },
    { id: 'e', name: 'Abel', email: 'abel@gmail.com', company: '', createdAt: at('09-06'), status: 'new', line: 'agri' },
  ];
  const groups = groupBuyers(leads);
  assert.equal(groups.length, 3, 'Gulf Trading (3 enquiries), and two people on free email');
  const gulf = summarise(groups.find((g) => g.leads.some((l) => l.id === 'a')));
  assert.deepEqual(gulf.leads.map((l) => l.id), ['c', 'b', 'a'], 'newest first; the enquiry without a company joined by its domain');
  assert.equal(gulf.name, 'Gulf Trading L.L.C.', 'two spellings used once each: the most recent one');
  assert.deepEqual(gulf.people.map((p) => p.email), ['omar@gulf-trading.ae', 'sara@gulf-trading.ae'], 'each person once');
  assert.deepEqual(gulf.lines.sort(), ['agri', 'pack']);
  assert.equal(gulf.open, 2);
  assert.equal(gulf.won, 1);
  assert.deepEqual(gulf.quoted, { USD: 132500 });
  assert.deepEqual(gulf.wonValue, { USD: 92500 });
  assert.deepEqual(gulf.products.sort(), ['Humera Sesame Seeds', 'Pulses & Legumes'], 'generic products are left out');
  assert.equal(gulf.market, 'United Arab Emirates');
  // two strangers on Gmail are two buyers, not one
  const free = groups.filter((g) => g.leads.every((l) => l.email.endsWith('@gmail.com')));
  assert.equal(free.length, 2);
});
