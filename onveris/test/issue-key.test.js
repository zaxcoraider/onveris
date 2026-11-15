import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractIssueKey, formatTime, chooseDoneTransition } from '../src/services/issues.js';

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

test('times in issues are written out in UTC', () => {
  assert.equal(formatTime('2026-11-15T07:27:12.758Z'), '15 Nov 2026, 07:27 UTC');
  assert.equal(formatTime('2026-01-03T23:05:00Z'), '3 Jan 2026, 23:05 UTC');
  assert.equal(formatTime('not a date'), 'not a date');
});

const done = { statusCategory: { key: 'done' } };
const open = { statusCategory: { key: 'indeterminate' } };
const resolution = (values) => ({ resolution: { required: true, hasDefaultValue: false, allowedValues: values } });

test('takes a done transition that needs nothing', () => {
  assert.deepEqual(chooseDoneTransition([{ id: '1', to: open }, { id: '2', to: done, fields: {} }]), { id: '2', fields: {} });
});

test('fills in Resolution when it is the only required field, preferring Done', () => {
  const t = [{ id: '5', to: done, fields: resolution([{ id: '10', name: "Won't do" }, { id: '11', name: 'Done' }]) }];
  assert.deepEqual(chooseDoneTransition(t), { id: '5', fields: { resolution: { id: '11' } } });
});

test('falls back to the first resolution when none has a preferred name', () => {
  const t = [{ id: '5', to: done, fields: resolution([{ id: '20', name: 'Declined' }]) }];
  assert.deepEqual(chooseDoneTransition(t).fields, { resolution: { id: '20' } });
});

test('skips a transition that needs fields Onveris cannot fill', () => {
  const t = [{ id: '5', to: done, fields: { ...resolution([{ id: '1', name: 'Done' }]), customfield_1: { required: true } } }];
  assert.equal(chooseDoneTransition(t), null);
  assert.equal(chooseDoneTransition([{ id: '1', to: open }]), null);
  assert.equal(chooseDoneTransition(undefined), null);
});
