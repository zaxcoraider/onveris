import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  ButtonGroup,
  DynamicTable,
  EmptyState,
  Heading,
  Inline,
  Label,
  Link,
  LoadingButton,
  Lozenge,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTransition,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Text,
  Textfield,
  xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { CHANGE_STATUS, KIND_LABEL, STATUS, StatusLozenge, call, shorten, timeAgo } from './shared.jsx';

const filterBox = xcss({ width: '220px' });
const pageLinkBox = xcss({ width: '360px' });
const STATUS_OPTIONS = Object.entries(STATUS).map(([value, { label }]) => ({ label, value }));

const RegisterModal = ({ chains, fields, onClose, onRegistered }) => {
  const [chain, setChain] = useState(chains[0] || null);
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const input = { chain: chain?.value, address, name };

  // Step one reads the chain and shows what was found. Nothing is saved yet.
  const read = async () => {
    setBusy(true);
    setError(null);
    const result = await call('previewContract', input);
    setBusy(false);
    if (result.ok) setPreview(result.preview);
    else setError(result.message);
  };

  // Step two saves it. The chain is read again, so the record is as fresh as possible.
  const confirm = async () => {
    setBusy(true);
    setError(null);
    const result = await call('registerContract', input);
    setBusy(false);
    if (result.ok) onRegistered(result.contract);
    else setError(result.message);
  };

  const errorMessage = error && (
    <SectionMessage appearance="error" title="Couldn't register this contract">
      <Text>{error}</Text>
    </SectionMessage>
  );

  if (preview) {
    const found = fields.filter(({ key }) => preview.values[key]);
    return (
      <Modal onClose={onClose}>
        <ModalHeader>
          <ModalTitle>Record {preview.name}?</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <Stack space="space.200">
            <Text>
              This is what Onveris read from {preview.chainName} at block {preview.blockNumber}. Confirm to save it as
              the record. Later checks compare the chain against it.
            </Text>
            {errorMessage}
            <Stack space="space.050">
              <Text weight="bold">{KIND_LABEL[preview.kind] || 'Contract'}</Text>
              <Text>{preview.address}</Text>
            </Stack>
            {found.map(({ key, label }) => (
              <Stack key={key} space="space.050">
                <Text weight="bold">{label}</Text>
                <Text>{preview.values[key]}</Text>
              </Stack>
            ))}
          </Stack>
        </ModalBody>
        <ModalFooter>
          <Button appearance="subtle" onClick={() => setPreview(null)} isDisabled={busy}>
            Back
          </Button>
          <LoadingButton appearance="primary" onClick={confirm} isLoading={busy}>
            Confirm and register
          </LoadingButton>
        </ModalFooter>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose}>
      <ModalHeader>
        <ModalTitle>Register a contract</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <Stack space="space.200">
          <Text>
            Onveris reads the contract from the chain and shows you what it found before anything is saved. Read-only:
            no wallet or keys.
          </Text>
          {errorMessage}
          <Box>
            <Label labelFor="register-chain">Chain</Label>
            <Select inputId="register-chain" options={chains} value={chain} onChange={setChain} />
          </Box>
          <Box>
            <Label labelFor="register-address">Contract address</Label>
            <Textfield
              id="register-address"
              placeholder="0x…"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </Box>
          <Box>
            <Label labelFor="register-name">Name</Label>
            <Textfield
              id="register-name"
              placeholder="For example: Treasury"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Box>
        </Stack>
      </ModalBody>
      <ModalFooter>
        <Button appearance="subtle" onClick={onClose} isDisabled={busy}>
          Cancel
        </Button>
        <LoadingButton
          appearance="primary"
          onClick={read}
          isLoading={busy}
          isDisabled={!chain || !address.trim() || !name.trim()}
        >
          Read from chain
        </LoadingButton>
      </ModalFooter>
    </Modal>
  );
};

const RemoveModal = ({ contract, onClose, onRemoved }) => {
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState(null);

  const remove = async () => {
    setRemoving(true);
    const result = await call('removeContract', { id: contract.id });
    setRemoving(false);
    if (result.ok) onRemoved();
    else setError(result.message);
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader>
        <ModalTitle appearance="danger">Remove {contract.name}?</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <Stack space="space.150">
          <Text>
            Onveris will stop checking this contract and delete its record. Nothing changes on the chain. You can
            register it again later.
          </Text>
          {error && (
            <SectionMessage appearance="error">
              <Text>{error}</Text>
            </SectionMessage>
          )}
        </Stack>
      </ModalBody>
      <ModalFooter>
        <Button appearance="subtle" onClick={onClose} isDisabled={removing}>
          Cancel
        </Button>
        <LoadingButton appearance="danger" onClick={remove} isLoading={removing}>
          Remove
        </LoadingButton>
      </ModalFooter>
    </Modal>
  );
};

// Jira issues linked to a contract. The backend only returns issues the current user can view.
const LinkedIssues = ({ contractId }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [issueKey, setIssueKey] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = (result) => {
    if (result.ok) {
      setData(result);
      setError(null);
    } else {
      setError(result.message);
    }
    return result.ok;
  };

  const load = useCallback(async () => apply(await call('getContractIssues', { id: contractId })), [contractId]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (name, payload) => {
    setBusy(true);
    const ok = apply(await call(name, { id: contractId, ...payload }));
    setBusy(false);
    return ok;
  };

  const link = async () => {
    if (await run('linkIssueByKey', { issueKey })) setIssueKey('');
  };

  return (
    <Stack space="space.150">
      <Heading as="h2">Linked issues</Heading>
      {error && (
        <SectionMessage appearance="error">
          <Text>{error}</Text>
        </SectionMessage>
      )}
      {!data && !error && <Spinner size="small" label="Loading linked issues" />}
      {!data && error && (
        <Box>
          <Button onClick={load}>Retry</Button>
        </Box>
      )}
      {data && data.issues.length === 0 && data.hidden === 0 && (
        <Text>No issues are linked to this contract yet. Link the tickets that plan or explain changes to it.</Text>
      )}
      {data &&
        data.issues.map((issue) => (
          <Inline key={issue.id} space="space.150" alignBlock="center" spread="space-between">
            <Inline space="space.100" alignBlock="center">
              <Text>
                <Link href={`/browse/${issue.key}`} openNewTab>
                  {issue.key}
                </Link>{' '}
                {issue.summary}
              </Text>
              {issue.status && <Lozenge>{issue.status}</Lozenge>}
            </Inline>
            <Button appearance="subtle" isDisabled={busy} onClick={() => run('unlinkIssue', { issueId: issue.id })}>
              Unlink
            </Button>
          </Inline>
        ))}
      {data && data.hidden > 0 && (
        <Text>
          {data.hidden === 1
            ? '1 more linked issue is not shown because you cannot view it.'
            : `${data.hidden} more linked issues are not shown because you cannot view them.`}
        </Text>
      )}
      {data && (
        <Inline space="space.100" alignBlock="end">
          <Box xcss={filterBox}>
            <Label labelFor="link-issue-key">Issue key or link</Label>
            <Textfield
              id="link-issue-key"
              placeholder="For example: OPS-12"
              value={issueKey}
              onChange={(e) => setIssueKey(e.target.value)}
            />
          </Box>
          <LoadingButton onClick={link} isLoading={busy} isDisabled={!issueKey.trim()}>
            Link issue
          </LoadingButton>
        </Inline>
      )}
    </Stack>
  );
};

// Confluence pages that document a contract. The backend only returns pages the current user can view.
const LinkedPages = ({ contractId }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [pageLink, setPageLink] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = (result) => {
    if (result.ok) {
      setData(result);
      setError(null);
    } else {
      setError(result.message);
    }
    return result.ok;
  };

  const load = useCallback(async () => apply(await call('getContractPages', { id: contractId })), [contractId]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (name, payload) => {
    setBusy(true);
    const ok = apply(await call(name, { id: contractId, ...payload }));
    setBusy(false);
    return ok;
  };

  const link = async () => {
    if (await run('linkPageByLink', { pageLink })) setPageLink('');
  };

  return (
    <Stack space="space.150">
      <Heading as="h2">Documentation pages</Heading>
      {error && (
        <SectionMessage appearance="error">
          <Text>{error}</Text>
        </SectionMessage>
      )}
      {!data && !error && <Spinner size="small" label="Loading linked pages" />}
      {!data && error && (
        <Box>
          <Button onClick={load}>Retry</Button>
        </Box>
      )}
      {data && data.pages.length === 0 && data.hidden === 0 && (
        <Text>
          No Confluence pages are linked yet. Link the pages that document this contract, such as its deployment notes
          or audit report.
        </Text>
      )}
      {data &&
        data.pages.map((page) => (
          <Inline key={page.id} space="space.150" alignBlock="center" spread="space-between">
            <Text>
              {page.url ? (
                <Link href={page.url} openNewTab>
                  {page.title}
                </Link>
              ) : (
                page.title
              )}
            </Text>
            <Button appearance="subtle" isDisabled={busy} onClick={() => run('unlinkPage', { pageId: page.id })}>
              Unlink
            </Button>
          </Inline>
        ))}
      {data && data.hidden > 0 && (
        <Text>
          {data.hidden === 1
            ? '1 more linked page is not shown because you cannot view it, or it was deleted.'
            : `${data.hidden} more linked pages are not shown because you cannot view them, or they were deleted.`}
        </Text>
      )}
      {data && (
        <Inline space="space.100" alignBlock="end">
          <Box xcss={pageLinkBox}>
            <Label labelFor="link-page">Confluence page link</Label>
            <Textfield
              id="link-page"
              placeholder="Paste the page's link"
              value={pageLink}
              onChange={(e) => setPageLink(e.target.value)}
            />
          </Box>
          <LoadingButton onClick={link} isLoading={busy} isDisabled={!pageLink.trim()}>
            Link page
          </LoadingButton>
        </Inline>
      )}
    </Stack>
  );
};

const IssueLink = ({ issue }) => (
  <Link href={`/browse/${issue.key}`} openNewTab>
    {issue.key}
  </Link>
);

// Changes a recorded value by hand. The chain is checked against the new record straight away.
const EditRecordModal = ({ contract, field, onClose, onSaved }) => {
  const [value, setValue] = useState(contract.baseline[field.key] || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    const result = await call('editBaseline', { id: contract.id, field: field.key, value });
    setSaving(false);
    if (result.ok) onSaved(result);
    else setError(result.message);
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader>
        <ModalTitle>Edit recorded {field.label.toLowerCase()}</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <Stack space="space.200">
          <Text>
            The record is what Onveris expects to find on the chain. If you record a value that differs from the
            chain, the contract shows as drift and the difference is raised as an unrecorded change.
          </Text>
          {error && (
            <SectionMessage appearance="error">
              <Text>{error}</Text>
            </SectionMessage>
          )}
          <Box>
            <Label labelFor="edit-record-value">Recorded value</Label>
            <Textfield
              id="edit-record-value"
              placeholder="0x… or leave empty for none"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </Box>
          <Text>On chain now: {contract.observed[field.key] || 'None'}</Text>
        </Stack>
      </ModalBody>
      <ModalFooter>
        <Button appearance="subtle" onClick={onClose} isDisabled={saving}>
          Cancel
        </Button>
        <LoadingButton appearance="primary" onClick={save} isLoading={saving}>
          Save and check
        </LoadingButton>
      </ModalFooter>
    </Modal>
  );
};

// Closes an open change, either by naming the issue that explains it or by accepting it with a note.
const ReconcileModal = ({ change, mode, onClose, onDone }) => {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const linking = mode === 'link';

  const submit = async () => {
    setSaving(true);
    setError(null);
    const result = linking
      ? await call('reconcileWithIssue', { changeId: change.id, issueKey: text })
      : await call('acknowledgeChange', { changeId: change.id, note: text });
    setSaving(false);
    if (result.ok) onDone(result);
    else setError(result.message);
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader>
        <ModalTitle>{linking ? 'Link this change to an issue' : 'Acknowledge this change'}</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <Stack space="space.200">
          <Text>
            {linking
              ? 'Name the issue that explains this change. The record is then updated to match the chain.'
              : 'Say briefly why this change is accepted. The record is then updated to match the chain.'}
          </Text>
          <Text>
            {change.label}: {change.oldValue || 'None'} → {change.newValue || 'None'}
          </Text>
          {error && (
            <SectionMessage appearance="error">
              <Text>{error}</Text>
            </SectionMessage>
          )}
          <Box>
            <Label labelFor="reconcile-text">{linking ? 'Issue key or link' : 'Note'}</Label>
            <Textfield
              id="reconcile-text"
              placeholder={linking ? 'For example: OPS-12' : 'For example: Emergency fix agreed in the incident call'}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Box>
        </Stack>
      </ModalBody>
      <ModalFooter>
        <Button appearance="subtle" onClick={onClose} isDisabled={saving}>
          Cancel
        </Button>
        <LoadingButton appearance="primary" onClick={submit} isLoading={saving} isDisabled={!text.trim()}>
          {linking ? 'Link and update record' : 'Acknowledge and update record'}
        </LoadingButton>
      </ModalFooter>
    </Modal>
  );
};

const OpenChange = ({ change, canManage, onReconcile }) => (
  <Stack space="space.100">
    <Inline space="space.100" alignBlock="center" shouldWrap>
      <Text weight="bold">{change.label} changed</Text>
      <Lozenge appearance="removed">Unrecorded</Lozenge>
      <Text color="color.text.subtle">
        detected {timeAgo(change.detectedAt)}
        {change.blockNumber ? ` at block ${change.blockNumber}` : ''}
      </Text>
    </Inline>
    <Text>Recorded: {change.oldValue || 'None'}</Text>
    <Text>On chain: {change.newValue || 'None'}</Text>
    {change.txUrl && (
      <Text>
        Changed by transaction{' '}
        <Link href={change.txUrl} openNewTab>
          {shorten(change.txHash)}
        </Link>{' '}
        at block {change.blockNumber}
      </Text>
    )}
    {change.driftIssue && (
      <Text>
        Raised as <IssueLink issue={change.driftIssue} /> {change.driftIssue.summary}
      </Text>
    )}
    {change.issueFailed && !change.driftIssue && (
      <Text color="color.text.danger">
        Onveris couldn't create a Jira issue for this change. It will try again on the next check. A Jira admin can
        review the project chosen in the Onveris settings.
      </Text>
    )}
    {canManage ? (
      <ButtonGroup>
        <Button onClick={() => onReconcile(change, 'link')}>Link to issue</Button>
        <Button onClick={() => onReconcile(change, 'acknowledge')}>Acknowledge</Button>
      </ButtonGroup>
    ) : (
      <Text color="color.text.subtle">A Jira admin can link this change to an issue or acknowledge it.</Text>
    )}
  </Stack>
);

const historyRows = (history) =>
  history.map((change) => {
    const { label, appearance } = CHANGE_STATUS[change.status] || CHANGE_STATUS.cleared;
    return {
      key: change.id,
      cells: [
        {
          key: 'when',
          content: (
            <Text>
              {timeAgo(change.detectedAt)}
              {change.txUrl && (
                <>
                  {' · '}
                  <Link href={change.txUrl} openNewTab>
                    transaction
                  </Link>
                </>
              )}
            </Text>
          ),
        },
        { key: 'field', content: <Text>{change.label}</Text> },
        {
          key: 'values',
          content: (
            <Text>
              {shorten(change.oldValue) || 'None'} → {shorten(change.newValue) || 'None'}
            </Text>
          ),
        },
        { key: 'status', content: <Lozenge appearance={appearance}>{label}</Lozenge> },
        {
          key: 'explained',
          content: change.resolutionIssue ? (
            <Text>
              <IssueLink issue={change.resolutionIssue} /> {change.resolutionIssue.summary}
            </Text>
          ) : (
            <Text>{change.note || (change.status === 'cleared' ? 'The chain matches the record again' : '')}</Text>
          ),
        },
      ],
    };
  });

const ContractDetail = ({ contract, fields, canManage, onBack, onUpdated, onRemoved }) => {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [changes, setChanges] = useState(null);
  const [changesError, setChangesError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [reconciling, setReconciling] = useState(null);
  const [linksVersion, setLinksVersion] = useState(0);

  // Every action that touches the contract answers with the contract and its changes together.
  const applyResult = (result) => {
    onUpdated(result.contract);
    setChanges(result.changes);
    setLinksVersion((version) => version + 1);
  };

  const loadChanges = useCallback(async () => {
    setChangesError(null);
    const result = await call('getContractChanges', { id: contract.id });
    if (result.ok) setChanges(result.changes);
    else setChangesError(result.message);
  }, [contract.id]);

  useEffect(() => {
    loadChanges();
  }, [loadChanges]);

  const check = async () => {
    setChecking(true);
    setError(null);
    const result = await call('checkContract', { id: contract.id });
    setChecking(false);
    if (result.ok) applyResult(result);
    else setError(result.message);
  };

  const rows = fields
    .filter(({ key }) => contract.baseline[key] || contract.observed[key])
    .map(({ key, label }) => {
      const recorded = contract.baseline[key];
      const onChain = contract.observed[key];
      const matches = recorded === onChain;
      return {
        key,
        cells: [
          { key: 'field', content: <Text>{label}</Text> },
          { key: 'recorded', content: <Text>{recorded || 'None'}</Text> },
          { key: 'chain', content: <Text>{onChain || 'None'}</Text> },
          {
            key: 'match',
            content: <Lozenge appearance={matches ? 'success' : 'removed'}>{matches ? 'Matches' : 'Differs'}</Lozenge>,
          },
          {
            key: 'edit',
            content: canManage ? (
              <Button appearance="subtle" spacing="compact" onClick={() => setEditing({ key, label })}>
                Edit record
              </Button>
            ) : null,
          },
        ],
      };
    });

  return (
    <Stack space="space.300">
      <Box>
        <Button appearance="subtle" onClick={onBack}>
          Back to all contracts
        </Button>
      </Box>

      <Inline space="space.200" alignBlock="center" spread="space-between">
        <Stack space="space.050">
          <Inline space="space.100" alignBlock="center">
            <Heading as="h1">{contract.name}</Heading>
            <StatusLozenge status={contract.status} />
          </Inline>
          <Text>
            {contract.chainName} · {KIND_LABEL[contract.kind] || 'Contract'} · {contract.address}
          </Text>
          <Text>
            Last checked {timeAgo(contract.lastCheckedAt)}
            {contract.lastBlock ? ` at block ${contract.lastBlock}` : ''}
          </Text>
        </Stack>
        <ButtonGroup>
          {contract.explorerUrl && (
            <Link href={contract.explorerUrl} openNewTab>
              View on explorer
            </Link>
          )}
          <LoadingButton onClick={check} isLoading={checking}>
            Check now
          </LoadingButton>
          {canManage && (
            <Button appearance="danger" onClick={() => setConfirmRemove(true)}>
              Remove
            </Button>
          )}
        </ButtonGroup>
      </Inline>

      {error && (
        <SectionMessage appearance="error" title="That didn't work">
          <Text>{error}</Text>
        </SectionMessage>
      )}

      {contract.status === 'drift' && (
        <SectionMessage appearance="error" title="The chain no longer matches the record">
          <Text>
            {contract.differences.map((d) => d.label).join(', ')} on the chain differs from the record. If nobody
            planned this change, treat it as an incident. Reconcile it under Open changes below.
          </Text>
        </SectionMessage>
      )}

      {contract.status === 'unreachable' && (
        <SectionMessage appearance="warning" title="Couldn't reach the chain">
          <Text>
            The last check could not read {contract.chainName}. The values below are from{' '}
            {timeAgo(contract.lastCheckedAt)}. This is a connection problem, not a change to the contract.
          </Text>
        </SectionMessage>
      )}

      <Stack space="space.100">
        <Heading as="h2">Record versus chain</Heading>
        <DynamicTable
          head={{
            cells: [
              { key: 'field', content: 'Field' },
              { key: 'recorded', content: 'Recorded' },
              { key: 'chain', content: 'On chain' },
              { key: 'match', content: 'Status' },
              { key: 'edit', content: '' },
            ],
          }}
          rows={rows}
        />
      </Stack>

      {changes && changes.open.length > 0 && (
        <Stack space="space.200">
          <Heading as="h2">Open changes</Heading>
          {changes.open.map((change) => (
            <OpenChange key={change.id} change={change} canManage={canManage} onReconcile={(target, mode) => setReconciling({ change: target, mode })} />
          ))}
        </Stack>
      )}

      <LinkedIssues key={linksVersion} contractId={contract.id} />

      <LinkedPages contractId={contract.id} />

      <Stack space="space.100">
        <Heading as="h2">History</Heading>
        {!changes && !changesError && <Spinner size="small" label="Loading history" />}
        {!changes && changesError && (
          <SectionMessage appearance="error" title="Couldn't load the changes for this contract">
            <Stack space="space.100">
              <Text>{changesError} Open changes and history are not shown until they load.</Text>
              <Box>
                <Button onClick={loadChanges}>Retry</Button>
              </Box>
            </Stack>
          </SectionMessage>
        )}
        {changes && changes.history.length === 0 && (
          <Text>No changes have been reconciled yet. Each change Onveris detects is kept here with what explained it.</Text>
        )}
        {changes && changes.history.length > 0 && (
          <DynamicTable
            label="Change history"
            rowsPerPage={10}
            head={{
              cells: [
                { key: 'when', content: 'Detected' },
                { key: 'field', content: 'What changed' },
                { key: 'values', content: 'Before → after' },
                { key: 'status', content: 'Outcome' },
                { key: 'explained', content: 'Explained by' },
              ],
            }}
            rows={historyRows(changes.history)}
          />
        )}
      </Stack>

      <ModalTransition>
        {editing && (
          <EditRecordModal
            contract={contract}
            field={editing}
            onClose={() => setEditing(null)}
            onSaved={(result) => {
              setEditing(null);
              applyResult(result);
            }}
          />
        )}
      </ModalTransition>
      <ModalTransition>
        {reconciling && (
          <ReconcileModal
            change={reconciling.change}
            mode={reconciling.mode}
            onClose={() => setReconciling(null)}
            onDone={(result) => {
              setReconciling(null);
              applyResult(result);
            }}
          />
        )}
      </ModalTransition>

      <ModalTransition>
        {confirmRemove && (
          <RemoveModal contract={contract} onClose={() => setConfirmRemove(false)} onRemoved={onRemoved} />
        )}
      </ModalTransition>
    </Stack>
  );
};

const summaryText = ({ total, inSync, drift, unreachable }) =>
  [
    `${total} ${total === 1 ? 'contract' : 'contracts'}`,
    `${inSync} in sync`,
    `${drift} with drift`,
    unreachable > 0 && `${unreachable} unreachable`,
  ]
    .filter(Boolean)
    .join(' · ');

const App = () => {
  const [setup, setSetup] = useState(null);
  const [registry, setRegistry] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [registering, setRegistering] = useState(false);
  const [checkingAll, setCheckingAll] = useState(false);
  const [notice, setNotice] = useState(null);
  const [search, setSearch] = useState('');
  const [chainFilter, setChainFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState(null);
  const [sampleAction, setSampleAction] = useState(null);

  const load = useCallback(async () => {
    const result = await call('getRegistry');
    if (result.ok) {
      setRegistry(result);
      setLoadError(null);
    } else {
      setLoadError(result.message);
    }
  }, []);

  useEffect(() => {
    invoke('getSetup')
      .then((data) => setSetup({ ...data, chains: data.chains.map((c) => ({ label: c.name, value: c.key })) }))
      .catch(() => setLoadError('Something went wrong. Try again.'));
    load();
  }, [load]);

  const checkAll = async () => {
    setCheckingAll(true);
    setNotice(null);
    const result = await call('checkAll');
    setCheckingAll(false);
    if (result.ok) setRegistry(result);
    else setNotice({ appearance: 'error', text: result.message });
  };

  const loadSampleContracts = async () => {
    setSampleAction('load');
    setNotice(null);
    const result = await call('loadSamples');
    setSampleAction(null);
    if (!result.ok) return setNotice({ appearance: 'error', text: result.message });
    setRegistry(result);
    const { added, alreadyThere, failed } = result.loaded;
    const parts = [
      added.length > 0 && `Loaded ${added.length} sample ${added.length === 1 ? 'contract' : 'contracts'}, read live from their chains.`,
      alreadyThere.length > 0 && `${alreadyThere.length} ${alreadyThere.length === 1 ? 'was' : 'were'} already registered.`,
      failed.length > 0 && `Couldn't reach the chain for ${failed.join(', ')}. Try loading again in a moment.`,
    ].filter(Boolean);
    setNotice({ appearance: failed.length > 0 ? 'warning' : 'success', text: parts.join(' ') });
  };

  const removeSampleContracts = async () => {
    setSampleAction('remove');
    setNotice(null);
    const result = await call('removeSamples');
    setSampleAction(null);
    if (!result.ok) return setNotice({ appearance: 'error', text: result.message });
    setRegistry(result);
    setNotice({ appearance: 'success', text: `Removed ${result.removed} sample ${result.removed === 1 ? 'contract' : 'contracts'}.` });
  };

  const replaceContract = (updated) =>
    setRegistry((current) => {
      const contracts = current.contracts.map((c) => (c.id === updated.id ? updated : c));
      const count = (status) => contracts.filter((c) => c.status === status).length;
      return {
        ...current,
        contracts,
        summary: {
          total: contracts.length,
          inSync: count('in_sync'),
          drift: count('drift'),
          unreachable: count('unreachable'),
        },
      };
    });

  if (loadError && !registry) {
    return (
      <SectionMessage appearance="error" title="Couldn't load Onveris">
        <Stack space="space.100">
          <Text>{loadError}</Text>
          <Box>
            <Button onClick={load}>Retry</Button>
          </Box>
        </Stack>
      </SectionMessage>
    );
  }

  if (!setup || !registry) return <Spinner size="large" label="Loading contracts" />;

  const selected = selectedId ? registry.contracts.find((c) => c.id === selectedId) : null;

  if (selected) {
    return (
      <ContractDetail
        contract={selected}
        fields={setup.fields}
        canManage={setup.canManage}
        onBack={() => setSelectedId(null)}
        onUpdated={replaceContract}
        onRemoved={() => {
          setSelectedId(null);
          setNotice({ appearance: 'success', text: `${selected.name} was removed.` });
          load();
        }}
      />
    );
  }

  const registerModal = (
    <ModalTransition>
      {registering && (
        <RegisterModal
          chains={setup.chains}
          fields={setup.fields}
          onClose={() => setRegistering(false)}
          onRegistered={(contract) => {
            setRegistering(false);
            setNotice({ appearance: 'success', text: `${contract.name} is registered and in sync with the chain.` });
            load();
          }}
        />
      )}
    </ModalTransition>
  );

  if (registry.contracts.length === 0) {
    return (
      <>
        {notice && (
          <SectionMessage appearance={notice.appearance}>
            <Text>{notice.text}</Text>
          </SectionMessage>
        )}
        <EmptyState
          header="Keep your contract records true to the chain"
          description={
            setup.canManage
              ? 'Register a smart contract and Onveris records its implementation, admin, owner and code. It then checks the chain and tells you when something changes. Read-only: no wallet or keys. To look around first, load a few well-known public contracts as samples.'
              : 'Onveris records which code each of your smart contracts runs and who controls it, then checks the chain and tells you when something changes. No contracts are registered yet. Ask a Jira admin to register one or to load the samples.'
          }
          isLoading={sampleAction === 'load'}
          primaryAction={
            setup.canManage ? (
              <Button appearance="primary" onClick={() => setRegistering(true)} isDisabled={sampleAction !== null}>
                Register a contract
              </Button>
            ) : undefined
          }
          secondaryAction={
            setup.canManage ? (
              <Button onClick={loadSampleContracts} isDisabled={sampleAction !== null}>
                Load sample contracts
              </Button>
            ) : undefined
          }
        />
        {registerModal}
      </>
    );
  }

  const needle = search.trim().toLowerCase();
  const visible = registry.contracts.filter(
    (contract) =>
      (!chainFilter || contract.chain === chainFilter.value) &&
      (!statusFilter || contract.status === statusFilter.value) &&
      (!needle || contract.name.toLowerCase().includes(needle) || contract.address.includes(needle))
  );
  const filtered = Boolean(needle || chainFilter || statusFilter);
  const clearFilters = () => {
    setSearch('');
    setChainFilter(null);
    setStatusFilter(null);
  };

  const rows = visible.map((contract) => ({
    key: contract.id,
    cells: [
      {
        key: 'name',
        content: (
          <Button appearance="subtle" onClick={() => setSelectedId(contract.id)}>
            {contract.name}
          </Button>
        ),
      },
      { key: 'chain', content: <Text>{contract.chainName}</Text> },
      { key: 'address', content: <Text>{shorten(contract.address)}</Text> },
      { key: 'status', content: <StatusLozenge status={contract.status} /> },
      { key: 'checked', content: <Text>{timeAgo(contract.lastCheckedAt)}</Text> },
    ],
  }));

  return (
    <Stack space="space.300">
      <Inline spread="space-between" alignBlock="center">
        <Stack space="space.050">
          <Heading as="h1">Onveris</Heading>
          <Text>{summaryText(registry.summary)}</Text>
        </Stack>
        <ButtonGroup>
          {setup.canManage && registry.contracts.some((contract) => contract.sample) && (
            <LoadingButton appearance="subtle" onClick={removeSampleContracts} isLoading={sampleAction === 'remove'}>
              Remove samples
            </LoadingButton>
          )}
          <LoadingButton onClick={checkAll} isLoading={checkingAll}>
            Check now
          </LoadingButton>
          {setup.canManage && (
            <Button appearance="primary" onClick={() => setRegistering(true)}>
              Register contract
            </Button>
          )}
        </ButtonGroup>
      </Inline>

      {notice && (
        <SectionMessage appearance={notice.appearance}>
          <Text>{notice.text}</Text>
        </SectionMessage>
      )}

      {!registry.raisesIssues && (
        <SectionMessage appearance="information" title="Changes are not raising Jira issues yet">
          <Text>
            Onveris detects changes and shows them here. To also get a Jira issue for each unrecorded change, a Jira
            admin chooses a project under Jira settings, Apps, Onveris.
          </Text>
        </SectionMessage>
      )}

      <Inline space="space.150" alignBlock="end" shouldWrap>
        <Box xcss={filterBox}>
          <Label labelFor="filter-search">Search</Label>
          <Textfield
            id="filter-search"
            placeholder="Name or address"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Box>
        <Box xcss={filterBox}>
          <Label labelFor="filter-chain">Chain</Label>
          <Select
            inputId="filter-chain"
            placeholder="All chains"
            options={setup.chains}
            value={chainFilter}
            onChange={setChainFilter}
            isClearable
          />
        </Box>
        <Box xcss={filterBox}>
          <Label labelFor="filter-status">Status</Label>
          <Select
            inputId="filter-status"
            placeholder="All statuses"
            options={STATUS_OPTIONS}
            value={statusFilter}
            onChange={setStatusFilter}
            isClearable
          />
        </Box>
        {filtered && (
          <Button appearance="subtle" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </Inline>

      <DynamicTable
        label="Registered contracts"
        emptyView={<Text>No contracts match these filters.</Text>}
        rowsPerPage={25}
        head={{
          cells: [
            { key: 'name', content: 'Name' },
            { key: 'chain', content: 'Chain' },
            { key: 'address', content: 'Address' },
            { key: 'status', content: 'Status' },
            { key: 'checked', content: 'Last checked' },
          ],
        }}
        rows={rows}
      />
      {registerModal}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
