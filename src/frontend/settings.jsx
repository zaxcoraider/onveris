import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  DynamicTable,
  Heading,
  Inline,
  Label,
  LoadingButton,
  Lozenge,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Text,
  xcss,
} from '@forge/react';
import { call, timeAgo } from './shared.jsx';

const pickerBox = xcss({ width: '360px' });

const LATE_AFTER_MS = 15 * 60 * 1000;

// Room above and below each endpoint, so every chain's row reads as one block.
const cellBox = xcss({ paddingBlock: 'space.150' });

const EndpointCell = ({ endpoint }) =>
  endpoint ? (
    <Box xcss={cellBox}>
      <Stack space="space.050">
        <Inline space="space.100" alignBlock="center">
          <Lozenge appearance={endpoint.ok ? 'success' : 'removed'}>{endpoint.ok ? 'Working' : 'Not responding'}</Lozenge>
          <Text>{endpoint.host}</Text>
        </Inline>
        <Text color="color.text.subtle">
          {endpoint.ok ? `Block ${endpoint.block.toLocaleString('en-US')} · ${endpoint.ms} ms` : endpoint.reason}
        </Text>
      </Stack>
    </Box>
  ) : (
    <Text color="color.text.subtle">None</Text>
  );

const StatusRow = ({ label, appearance, state, children }) => (
  <Stack space="space.050">
    <Inline space="space.100" alignBlock="center">
      <Text weight="bold">{label}</Text>
      {state && <Lozenge appearance={appearance}>{state}</Lozenge>}
    </Inline>
    <Text>{children}</Text>
  </Stack>
);

const connectorText = (sync) => {
  if (!sync) return 'Contracts are sent to the graph every 30 minutes. Reconnect once in Atlassian Administration to start this.';
  const plural = (n) => `${n} contract${n === 1 ? '' : 's'}`;
  if (!sync.ok) return `Contracts are sent every 30 minutes. The last try, ${timeAgo(sync.at)}, failed; it is tried again.`;
  const removed = sync.removed ? `, ${plural(sync.removed)} removed` : '';
  return `Contracts are sent every 30 minutes. Last sent ${timeAgo(sync.at)}: ${plural(sync.sent)}${removed}.`;
};

const checkerRow = (checker) => {
  if (!checker) {
    return { appearance: 'default', state: 'Not run yet', text: 'The first automatic check runs within five minutes of installing.' };
  }
  const { checked = 0, unreachable = 0, drift = 0 } = checker.summary || {};
  const parts = [`${checked} ${checked === 1 ? 'contract' : 'contracts'} checked`];
  if (drift) parts.push(`${drift} not matching ${drift === 1 ? 'its' : 'their'} record`);
  if (unreachable) parts.push(`${unreachable} unreachable`);
  if (Date.now() - new Date(checker.at).getTime() > LATE_AFTER_MS) {
    return {
      appearance: 'moved',
      state: 'Late',
      text: `Last ran ${timeAgo(checker.at)} (${parts.join(', ')}). It should run every five minutes.`,
    };
  }
  return { appearance: 'success', state: 'Running', text: `Every five minutes. Last ran ${timeAgo(checker.at)}: ${parts.join(', ')}.` };
};

// How Onveris is running: chain endpoints tested live, plus the checker and the optional connections.
const SystemStatus = () => {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const result = await call('getStatus');
    setLoading(false);
    if (!result.ok) return setError(result.message);
    setError(null);
    setStatus(result);
  };

  useEffect(() => {
    load();
  }, []);

  const header = (
    <Inline spread="space-between" alignBlock="center">
      <Heading as="h2">How Onveris is running</Heading>
      <LoadingButton onClick={load} isLoading={loading} isDisabled={!status && !error}>
        Test again
      </LoadingButton>
    </Inline>
  );

  if (!status) {
    return (
      <Stack space="space.100">
        {header}
        {error ? (
          <SectionMessage appearance="error">
            <Text>{error}</Text>
          </SectionMessage>
        ) : (
          <Spinner size="medium" label="Testing the connections" />
        )}
      </Stack>
    );
  }

  const checker = checkerRow(status.checker);
  const connected = status.connector && status.connector.action !== 'DELETED';
  const down = status.chains.filter((chain) => !chain.endpoints.some((endpoint) => endpoint.ok));

  return (
    <Stack space="space.200">
      {header}
      {error && (
        <SectionMessage appearance="error">
          <Text>{error}</Text>
        </SectionMessage>
      )}
      <Text>
        Each chain has a main endpoint and a backup, tried in that order. A chain is only unreachable when both fail;
        Onveris then shows the contract as unreachable and never reports it as a change.
      </Text>
      {down.length > 0 && (
        <SectionMessage appearance="warning" title="Some chains can't be reached right now">
          <Text>
            {down.map((chain) => chain.name).join(', ')}: contracts on these chains show as unreachable until an endpoint
            answers again.
          </Text>
        </SectionMessage>
      )}
      <DynamicTable
        label="Blockchain endpoints"
        head={{
          cells: [
            { key: 'chain', content: 'Chain' },
            { key: 'main', content: 'Main endpoint' },
            { key: 'backup', content: 'Backup endpoint' },
          ],
        }}
        rows={status.chains.map((chain) => ({
          key: chain.key,
          cells: [
            { key: 'chain', content: <Text weight="bold">{chain.name}</Text> },
            { key: 'main', content: <EndpointCell endpoint={chain.endpoints[0]} /> },
            { key: 'backup', content: <EndpointCell endpoint={chain.endpoints[1]} /> },
          ],
        }))}
      />
      <StatusRow label="Automatic checks" appearance={checker.appearance} state={checker.state}>
        {checker.text}
      </StatusRow>
      <StatusRow
        label="Confluence"
        appearance={status.confluence.connected ? 'success' : 'default'}
        state={status.confluence.connected ? 'Connected' : 'Not connected'}
      >
        {status.confluence.connected
          ? 'The Onveris contracts macro and links to documentation pages work.'
          : 'Optional. To use the contracts macro and documentation page links, connect Onveris to Confluence in Atlassian Administration under Apps.'}
      </StatusRow>
      <StatusRow
        label="Teamwork Graph"
        appearance={connected ? 'success' : 'default'}
        state={connected ? 'Connected' : 'Not connected'}
      >
        {connected
          ? connectorText(status.connectorSync)
          : 'Optional. Connect Onveris in Atlassian Administration under Apps to make contracts findable in Rovo search.'}
      </StatusRow>
      <StatusRow label="Rovo">
        The Onveris agent appears in Rovo Chat on sites that have Rovo. Everything else in Onveris works without it.
      </StatusRow>
      <Text color="color.text.subtle">Tested {timeAgo(status.checkedAt)}.</Text>
    </Stack>
  );
};

const Settings = () => {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [choice, setChoice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  const toOption = (project) => (project ? { label: `${project.name} (${project.key})`, value: project.id } : null);

  const load = async () => {
    setError(null);
    const result = await call('getSettings');
    if (!result.ok) return setError(result.message);
    setSettings(result);
    setChoice(toOption(result.driftProject));
  };

  useEffect(() => {
    load();
  }, []);

  if (!settings) {
    if (!error) return <Spinner size="large" label="Loading settings" />;
    return (
      <SectionMessage appearance="error" title="Couldn't load settings">
        <Stack space="space.100">
          <Text>{error}</Text>
          <Box>
            <Button onClick={load}>Retry</Button>
          </Box>
        </Stack>
      </SectionMessage>
    );
  }

  const save = async () => {
    setSaving(true);
    setNotice(null);
    const result = await call('saveSettings', { projectId: choice?.value || '' });
    setSaving(false);
    if (!result.ok || result.saved === false) return setNotice({ appearance: 'error', text: result.message });
    setSettings(result);
    setNotice({
      appearance: 'success',
      text: result.driftProject
        ? `Unrecorded changes will be raised as ${result.issueType.name} issues in ${result.driftProject.name}.`
        : 'Onveris will record changes without raising Jira issues.',
    });
  };

  const unchanged = (choice?.value || '') === (settings.driftProject?.id || '');

  return (
    <Stack space="space.300">
      <Stack space="space.100">
        <Heading as="h2">Issues for unrecorded changes</Heading>
        <Text>
          Onveris checks every registered contract about every five minutes. When a contract changes on the chain and
          no issue announced it, Onveris creates an issue in the project you choose here.
        </Text>
      </Stack>

      {notice && (
        <SectionMessage appearance={notice.appearance}>
          <Text>{notice.text}</Text>
        </SectionMessage>
      )}

      {!settings.driftProject && !notice && (
        <SectionMessage appearance="warning" title="No project chosen yet">
          <Text>Changes are still detected and shown in Onveris, but no Jira issue is raised for them.</Text>
        </SectionMessage>
      )}

      {settings.projects.length === 0 && (
        <SectionMessage appearance="warning" title="No projects to choose from">
          <Text>You can't see any Jira projects. Create a project, or ask for access to one, then reload this page.</Text>
        </SectionMessage>
      )}

      <Box xcss={pickerBox}>
        <Label labelFor="drift-project">Project</Label>
        <Select
          inputId="drift-project"
          placeholder="Choose a project"
          options={settings.projects.map(toOption)}
          value={choice}
          onChange={setChoice}
          isClearable
        />
      </Box>
      <Box>
        <LoadingButton appearance="primary" onClick={save} isLoading={saving} isDisabled={unchanged}>
          Save
        </LoadingButton>
      </Box>

      <SystemStatus />

      <Stack space="space.100">
        <Heading as="h2">What leaves Atlassian</Heading>
        <Text>
          To read a contract, Onveris sends its address in a standard read request to public blockchain endpoints.
          Nothing from Jira or Confluence is sent. Onveris is read-only: it holds no keys, connects to no wallet and
          cannot send transactions.
        </Text>
      </Stack>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <Settings />
  </React.StrictMode>
);
