// Box storage: a new data folder starts from the repo's defaults (the catalogues, the
// certificates, the contact details), never from what a running site wrote. A server
// once run without DATA_DIR left its visit counts in the repo's data folder, and every
// new data folder (and every test) then started with someone else's visits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isDefault, NEVER_SEEDED } from '../lib/storage.js';

test('a new data folder is given the defaults, and nothing a running site wrote', () => {
  for (const f of ['products.json', 'packaging-products.json', 'certifications.json', 'contact-details.json', 'branding.json', 'partners.json', 'social-links.json', 'certificate-reminders.json']) assert.equal(isDefault(f), true, f);
  for (const f of ['analytics.json', 'inquiries.json', 'inquiries-pending.json', 'database.json', 'auth.json', 'team.json', 'targets.json', 'ai-access.json', 'email-status.json', 'packaging-3d.json']) {
    assert.equal(isDefault(f), false, f);
    assert.ok(NEVER_SEEDED.has(f));
  }
  for (const f of ['admin-audit.log', 'ai-log.jsonl', 'notes.txt', 'thumbs']) assert.equal(isDefault(f), false, `${f} is not a data file`);
});
