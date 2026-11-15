import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  Heading,
  Label,
  LoadingButton,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Text,
  xcss,
} from '@forge/react';
import { call } from './shared.jsx';

const pickerBox = xcss({ width: '360px' });

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
