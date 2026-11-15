import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  DynamicTable,
  Inline,
  Label,
  Link,
  LoadingButton,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Text,
  useConfig,
} from '@forge/react';
import { listChains } from '../services/chains.js';
import { STATUS, StatusLozenge, call, shorten, timeAgo } from './shared.jsx';

// Confluence macro: a live table of the contracts registered in Onveris, for deployment pages.
// It reads the same registry as the Jira page; nothing is edited from here.

const CHAIN_OPTIONS = listChains().map(({ key, name }) => ({ label: name, value: key }));
const STATUS_OPTIONS = Object.entries(STATUS).map(([value, { label }]) => ({ label, value }));

// A Select in the macro config may be stored as the option or as its value.
const configValue = (value) => (value && typeof value === 'object' ? value.value : value) || null;

// What the contract currently runs, or failing that who controls it.
const currentState = ({ observed }) => {
  if (observed.implementation) return `Implementation ${shorten(observed.implementation)}`;
  if (observed.owner) return `Owner ${shorten(observed.owner)}`;
  if (observed.codeHash) return `Code ${shorten(observed.codeHash)}`;
  return 'Not read yet';
};

const summaryText = (contracts) => {
  const count = (status) => contracts.filter((c) => c.status === status).length;
  const parts = [`${contracts.length} ${contracts.length === 1 ? 'contract' : 'contracts'}`];
  if (count('in_sync')) parts.push(`${count('in_sync')} in sync`);
  if (count('drift')) parts.push(`${count('drift')} changed on the chain`);
  if (count('unreachable')) parts.push(`${count('unreachable')} unreachable`);
  return parts.join(' · ');
};

const Config = () => (
  <>
    <Label>Chain</Label>
    <Select name="chain" options={CHAIN_OPTIONS} placeholder="All chains" />
    <Label>Status</Label>
    <Select name="status" options={STATUS_OPTIONS} placeholder="All statuses" />
  </>
);

const App = () => {
  const config = useConfig();
  const chain = configValue(config?.chain);
  const status = configValue(config?.status);
  const [registry, setRegistry] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await call('getRegistry');
    setLoading(false);
    if (result.ok) {
      setRegistry(result);
      setError(null);
    } else {
      setError(result.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!registry) {
    if (!error) return <Spinner size="medium" label="Loading contracts" />;
    return (
      <SectionMessage appearance="error" title="Couldn't load Onveris">
        <Stack space="space.100">
          <Text>{error}</Text>
          <Box>
            <Button onClick={load}>Retry</Button>
          </Box>
        </Stack>
      </SectionMessage>
    );
  }

  if (registry.contracts.length === 0) {
    return (
      <SectionMessage appearance="information" title="No contracts registered yet">
        <Text>
          Register contracts in Onveris from the Apps menu in Jira. They appear here with their live state from the
          chain.
        </Text>
      </SectionMessage>
    );
  }

  const shown = registry.contracts.filter(
    (contract) => (!chain || contract.chain === chain) && (!status || contract.status === status)
  );
  const filters = [
    chain && CHAIN_OPTIONS.find((o) => o.value === chain)?.label,
    status && STATUS[status]?.label.toLowerCase(),
  ].filter(Boolean);

  const rows = shown.map((contract) => ({
    key: contract.id,
    cells: [
      { key: 'name', content: <Text weight="bold">{contract.name}</Text> },
      { key: 'chain', content: <Text>{contract.chainName}</Text> },
      {
        key: 'address',
        content: contract.explorerUrl ? (
          <Link href={contract.explorerUrl} openNewTab>
            {shorten(contract.address)}
          </Link>
        ) : (
          <Text>{shorten(contract.address)}</Text>
        ),
      },
      { key: 'state', content: <Text>{currentState(contract)}</Text> },
      { key: 'status', content: <StatusLozenge status={contract.status} /> },
      { key: 'checked', content: <Text>{timeAgo(contract.lastCheckedAt)}</Text> },
    ],
  }));

  const drift = shown.some((c) => c.status === 'drift');
  const unreachable = shown.some((c) => c.status === 'unreachable');

  return (
    <Stack space="space.150">
      <Inline spread="space-between" alignBlock="center" shouldWrap>
        <Text>
          {summaryText(shown)}
          {filters.length > 0 ? ` (showing ${filters.join(', ')})` : ''}
        </Text>
        <LoadingButton appearance="subtle" spacing="compact" onClick={load} isLoading={loading}>
          Refresh
        </LoadingButton>
      </Inline>
      <DynamicTable
        label="Smart contracts registered in Onveris"
        emptyView={<Text>No registered contracts match this macro's chain and status settings.</Text>}
        rowsPerPage={25}
        head={{
          cells: [
            { key: 'name', content: 'Name' },
            { key: 'chain', content: 'Chain' },
            { key: 'address', content: 'Address' },
            { key: 'state', content: 'On chain now' },
            { key: 'status', content: 'Status' },
            { key: 'checked', content: 'Last checked' },
          ],
        }}
        rows={rows}
      />
      {drift && (
        <Text color="color.text.danger">
          A contract marked Drift has changed on the chain since it was recorded. Open Onveris in Jira to see what
          changed and reconcile it.
        </Text>
      )}
      {unreachable && (
        <Text color="color.text.subtle">
          Unreachable means Onveris couldn't read that chain on its last check. It is a connection problem, not a
          change to the contract.
        </Text>
      )}
      <Text color="color.text.subtle">
        Read from the chain by Onveris about every five minutes. Read-only: no wallet or keys.
      </Text>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

ForgeReconciler.addConfig(<Config />);
