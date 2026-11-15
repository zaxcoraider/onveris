import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractIssueKey } from '../src/services/issues.js';

test('accepts a key in any case, with spaces around it', () => {
  assert.equal(extractIssueKey('CLSD-6'), 'CLSD-6');
  assert.equal(extractIssueKey('  clsd-6 '), 'CLSD-6');
});

test('takes the key out of an issue link', () => {
  assert.equal(extractIssueKey('https://one-atlas-horv.atlassian.net/browse/CLSD-6'), 'CLSD-6');
  assert.equal(extractIssueKey('https://example.atlassian.net/browse/OPS-12?focusedCommentId=1'), 'OPS-12');
});

test('takes the key out of surrounding text', () => {
  assert.equal(extractIssueKey('CLSD-6 Upgrade USDC contract'), 'CLSD-6');
});

test('rejects text with no key in it', () => {
  assert.equal(extractIssueKey('clsd6'), null);
  assert.equal(extractIssueKey(''), null);
  assert.equal(extractIssueKey(undefined), null);
  assert.equal(extractIssueKey('-6'), null);
});
