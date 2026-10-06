import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askFor, askedCert, certRequest } from '../src/scripts/cert-ask.js';

test('"Copy on request" on the line page stays on the page', () => {
  assert.equal(askFor('#contact', 'ISO 22000:2018'), '#contact');
});

test('"Copy on request" on a product page carries the certificate to the form', () => {
  assert.equal(askFor('/agriculture/?ask=cleaned-natural-sesame-seeds#contact', 'ISO 22000:2018'), '/agriculture/?ask=cleaned-natural-sesame-seeds&cert=ISO%2022000%3A2018#contact');
  assert.equal(askFor('/agriculture/#contact', 'GMP'), '/agriculture/?cert=GMP#contact');
  assert.equal(askFor('/agriculture/', 'GMP'), '/agriculture/?cert=GMP');
});

test('the form only writes a certificate it lists', () => {
  const listed = ['ISO 22000:2018', 'GMP'];
  assert.equal(askedCert('?ask=x&cert=ISO%2022000%3A2018', listed), 'ISO 22000:2018');
  assert.equal(askedCert('?cert=Send%20your%20bank%20details', listed), null, 'a made-up request is ignored');
  assert.equal(askedCert('?ask=x', listed), null);
  assert.equal(certRequest('GMP'), 'Please send a copy of your GMP certificate. ');
});
