import React from 'react';
import { Lozenge } from '@forge/react';
import { invoke } from '@forge/bridge';

// Pieces used by both the registry page and the issue panel.

export const STATUS = {
  in_sync: { label: 'In sync', appearance: 'success' },
  drift: { label: 'Drift', appearance: 'removed' },
  unreachable: { label: 'Unreachable', appearance: 'default' },
};

export const CHANGE_STATUS = {
  unreconciled: { label: 'Unrecorded', appearance: 'removed' },
  planned: { label: 'Planned change seen', appearance: 'inprogress' },
  reconciled: { label: 'Linked to issue', appearance: 'success' },
  acknowledged: { label: 'Acknowledged', appearance: 'success' },
  cleared: { label: 'Matches again', appearance: 'default' },
};

export const KIND_LABEL = { proxy: 'Upgradeable proxy', plain: 'Plain contract' };

// Word joiners (U+2060) around the ellipsis keep a shortened address on one line.
export const shorten = (address) => (address ? `${address.slice(0, 6)}\u2060…\u2060${address.slice(-4)}` : '');

export const timeAgo = (iso) => {
  if (!iso) return 'never';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
};

export const StatusLozenge = ({ status }) => {
  const { label, appearance } = STATUS[status] || STATUS.unreachable;
  return <Lozenge appearance={appearance}>{label}</Lozenge>;
};

const GENERIC_ERROR = { ok: false, message: 'Something went wrong. Try again.' };

// Calls a backend handler. Always resolves to { ok, ... } so views have one shape to handle.
export const call = (name, payload) => invoke(name, payload).catch(() => GENERIC_ERROR);
