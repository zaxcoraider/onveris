import React, { useCallback, useEffect, useRef, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  Inline,
  Label,
  Link,
  LoadingButton,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Text,
  Textfield,
  xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { StatusLozenge, call, shorten, timeAgo } from './shared.jsx';

// State older than this is re-read from the chain when the panel opens.
const STALE_AFTER_MS = 5 * 60 * 1000;

const pickerBox = xcss({ width: '320px' });

const isStale = (contract) =>
  !contract.lastCheckedAt || Date.now() - new Date(contract.lastCheckedAt).getTime() > STALE_AFTER_MS;

// The one line of chain state most worth seeing on an issue: what code the contract runs.
const headline = (contract) => {
  const { implementation, owner, codeHash } = contract.observed;
  if (implementation) return `Implementation ${shorten(implementation)}`;
  if (owner) return `Owner ${shorten(owner)}`;
  return `Code fingerprint ${shorten(codeHash)}`;
};

const fieldBox = xcss({ width: '200px' });
const valueBox = xcss({ width: '320px' });

// Lets the issue say in advance which value of the contract it will change.
const DeclareChange = ({ contract, fields, busy, onDeclare, onCancel }) => {
  const [field, setField] = useState(null);
  const [expected, setExpected] = useState('');
  return (
    <Stack space="space.100">
      <Text>
        Say what this issue will change. When Onveris sees that change on the chain, it records it against this issue
        instead of raising it as unrecorded.
      </Text>
      <Inline space="space.100" alignBlock="end" shouldWrap>
        <Box xcss={fieldBox}>
          <Label labelFor={`declare-field-${contract.id}`}>What will change</Label>
          <Select
            inputId={`declare-field-${contract.id}`}
            placeholder="Choose"
            options={fields.map(({ key, label }) => ({ label, value: key }))}
            value={field}
            onChange={setField}
          />
        </Box>
        <Box xcss={valueBox}>
          <Label labelFor={`declare-value-${contract.id}`}>New value (optional)</Label>
          <Textfield
            id={`declare-value-${contract.id}`}
            placeholder="0x… to accept only this value"
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
          />
        </Box>
        <LoadingButton
          appearance="primary"
          isLoading={busy === 'declare'}
          isDisabled={!field || busy !== null}
          onClick={() => onDeclare(contract.id, field.value, expected)}
        >
          Declare
        </LoadingButton>
        <Button appearance="subtle" onClick={onCancel} isDisabled={busy !== null}>
          Cancel
        </Button>
      </Inline>
    </Stack>
  );
};

const PlannedChange = ({ plan, busy, onRemove }) => (
  <Inline space="space.100" alignBlock="center" spread="space-between">
    <Text>
      Planned change: {plan.label.toLowerCase()}
      {plan.expectedValue ? ` to ${shorten(plan.expectedValue)}` : ''} ·{' '}
      {plan.status === 'matched' ? `seen on the chain ${timeAgo(plan.matchedAt)}` : 'waiting to be seen on the chain'}
    </Text>
    {plan.status === 'open' && (
      <Button appearance="subtle" spacing="compact" isDisabled={busy !== null} onClick={onRemove}>
        Remove
      </Button>
    )}
  </Inline>
);

const LinkedContract = ({ contract, fields, busy, onUnlink, onDeclare, onRemovePlan }) => {
  const [declaring, setDeclaring] = useState(false);
  return (
  <Stack space="space.050">
    <Inline space="space.100" alignBlock="center" spread="space-between">
      <Inline space="space.100" alignBlock="center" shouldWrap>
        <Text weight="bold">{contract.name}</Text>
        <Text>
          {contract.chainName} ·{' '}
          {contract.explorerUrl ? (
            <Link href={contract.explorerUrl} openNewTab>
              {shorten(contract.address)}
            </Link>
          ) : (
            shorten(contract.address)
          )}
        </Text>
        <StatusLozenge status={contract.status} />
      </Inline>
      <Button appearance="subtle" spacing="compact" isDisabled={busy !== null} onClick={() => onUnlink(contract.id)}>
        Unlink
      </Button>
    </Inline>
    <Text>
      {headline(contract)} · checked {timeAgo(contract.lastCheckedAt)}
    </Text>
    {contract.status === 'drift' && (
      <Text color="color.text.danger">
        Changed on the chain since it was recorded: {contract.differences.map((d) => d.label).join(', ')}.
      </Text>
    )}
    {contract.status === 'unreachable' && (
      <Text color="color.text.subtle">
        Couldn't reach {contract.chainName} on the last check. This is a connection problem, not a change to the
        contract.
      </Text>
    )}
    {contract.planned.map((plan) => (
      <PlannedChange
        key={plan.field}
        plan={plan}
        busy={busy}
        onRemove={() => onRemovePlan(contract.id, plan.field)}
      />
    ))}
    {declaring ? (
      <DeclareChange
        contract={contract}
        fields={fields}
        busy={busy}
        onCancel={() => setDeclaring(false)}
        onDeclare={async (...args) => {
          if (await onDeclare(...args)) setDeclaring(false);
        }}
      />
    ) : (
      <Box>
        <Button spacing="compact" isDisabled={busy !== null} onClick={() => setDeclaring(true)}>
          Declare change
        </Button>
      </Box>
    )}
  </Stack>
  );
};

const Panel = () => {
  const [panel, setPanel] = useState(null);
  const [error, setError] = useState(null);
  const [choice, setChoice] = useState(null);
  const [busy, setBusy] = useState(null);
  const [fields, setFields] = useState([]);
  const refreshed = useRef(false);

  const apply = (result) => {
    if (result.ok) {
      setPanel(result);
      setError(null);
    } else {
      setError(result.message);
    }
    return result.ok;
  };

  const run = useCallback(async (action, name, payload) => {
    setBusy(action);
    const ok = apply(await call(name, payload));
    setBusy(null);
    return ok;
  }, []);

  useEffect(() => {
    run('load', 'getIssuePanel');
    invoke('getSetup')
      .then((setup) => setFields(setup.fields))
      .catch(() => {});
  }, [run]);

  // Show the stored state straight away, then bring it up to date once if it is old.
  useEffect(() => {
    if (!panel || refreshed.current) return;
    refreshed.current = true;
    if (panel.linked.some(isStale)) run('check', 'checkIssueContracts');
  }, [panel, run]);

  if (!panel) {
    if (!error) return <Spinner size="medium" label="Loading contracts" />;
    return (
      <SectionMessage appearance="error" title="Couldn't load Onveris">
        <Stack space="space.100">
          <Text>{error}</Text>
          <Box>
            <Button onClick={() => run('load', 'getIssuePanel')}>Retry</Button>
          </Box>
        </Stack>
      </SectionMessage>
    );
  }

  const link = async () => {
    if (await run('link', 'linkContractToIssue', { contractId: choice.value })) setChoice(null);
  };

  const options = panel.available.map((contract) => ({
    label: `${contract.name} · ${contract.chainName} · ${shorten(contract.address)}`,
    value: contract.id,
  }));
  const nothingRegistered = panel.linked.length === 0 && panel.available.length === 0;

  return (
    <Stack space="space.200">
      {error && (
        <SectionMessage appearance="error">
          <Text>{error}</Text>
        </SectionMessage>
      )}

      {panel.linked.length === 0 && (
        <Text>
          {nothingRegistered
            ? 'No contracts are registered yet. Open Onveris from the Apps menu and register one, then link it here.'
            : 'No contracts linked to this issue. Link the contracts this issue is about to see their live state here.'}
        </Text>
      )}

      {panel.linked.map((contract) => (
        <LinkedContract
          key={contract.id}
          contract={contract}
          fields={fields}
          busy={busy}
          onUnlink={(contractId) => run('unlink', 'unlinkContractFromIssue', { contractId })}
          onDeclare={(contractId, field, expectedValue) =>
            run('declare', 'declarePlannedChange', { contractId, field, expectedValue })
          }
          onRemovePlan={(contractId, field) => run('removePlan', 'removePlannedChange', { contractId, field })}
        />
      ))}

      {!nothingRegistered && (
        <Inline space="space.100" alignBlock="end" shouldWrap>
          {options.length > 0 && (
            <>
              <Box xcss={pickerBox}>
                <Label labelFor="link-contract">Link a contract</Label>
                <Select
                  inputId="link-contract"
                  placeholder="Choose a contract"
                  options={options}
                  value={choice}
                  onChange={setChoice}
                />
              </Box>
              <LoadingButton onClick={link} isLoading={busy === 'link'} isDisabled={!choice || busy !== null}>
                Link contract
              </LoadingButton>
            </>
          )}
          {panel.linked.length > 0 && (
            <LoadingButton
              onClick={() => run('check', 'checkIssueContracts')}
              isLoading={busy === 'check'}
              isDisabled={busy !== null && busy !== 'check'}
            >
              Check now
            </LoadingButton>
          )}
        </Inline>
      )}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <Panel />
  </React.StrictMode>
);
