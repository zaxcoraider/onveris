import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPageId, decodeTinyLink } from '../src/services/pages.js';

// How Confluence makes a short link code: the id as 8 bytes, least significant first, in base64,
// with "/" written as "-", "+" as "_", and trailing "A" and "=" dropped.
function encodeTinyLink(id) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(id));
  return bytes.toString('base64').replace(/\//g, '-').replace(/\+/g, '_').replace(/[A=]+$/, '');
}

test('takes the id out of a page link', () => {
  assert.equal(
    extractPageId('https://one-atlas-horv.atlassian.net/wiki/spaces/OT/pages/4849970/Contract+deployments'),
    '4849970'
  );
  assert.equal(extractPageId('https://example.atlassian.net/wiki/spaces/ENG/pages/123456'), '123456');
  assert.equal(extractPageId('https://example.atlassian.net/wiki/spaces/ENG/pages/123456?focusedCommentId=9'), '123456');
});

test('takes the id out of an edit link and an old-style link', () => {
  assert.equal(extractPageId('https://example.atlassian.net/wiki/spaces/ENG/pages/edit-v2/123456'), '123456');
  assert.equal(extractPageId('https://example.atlassian.net/wiki/pages/viewpage.action?pageId=777&x=1'), '777');
});

test('accepts a bare page id', () => {
  assert.equal(extractPageId(' 4849970 '), '4849970');
});

test('decodes short links', () => {
  assert.equal(extractPageId('https://one-atlas-horv.atlassian.net/wiki/x/MgFK'), '4849970');
  assert.equal(decodeTinyLink('AgAB'), '65538');
  for (const id of ['1', '255', '65538', '4849970', '98765432', '4294967297', '123456789012']) {
    assert.equal(decodeTinyLink(encodeTinyLink(id)), id, `round trip of ${id}`);
  }
});

test('rejects text with no page in it', () => {
  assert.equal(extractPageId(''), null);
  assert.equal(extractPageId(undefined), null);
  assert.equal(extractPageId('Contract deployments'), null);
  assert.equal(extractPageId('https://example.atlassian.net/browse/OPS-12'), null);
  assert.equal(decodeTinyLink('not a code!'), null);
});
