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
} from '@forge/react';
import { invoke } from '@forge/bridge';

const STATUS = {
  in_sync: { label: 'In sync', appearance: 'success' },
  drift: { label: 'Drift', appearance: 'removed' },
  unreachable: { label: 'Unreachable', appearance: 'default' },
};

const KIND_LABEL = { proxy: 'Upgradeable proxy', plain: 'Plain contract' };

const shorten = (address) => (address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '');

const timeAgo = (iso) => {
  if (!iso) return 'never';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} days ago`;
};

const StatusLozenge = ({ status }) => {
  const { label, appearance } = STATUS[status] || STATUS.unreachable;
  return <Lozenge appearance={appearance}>{label}</Lozenge>;
};

const GENERIC_ERROR = { ok: false, message: 'Something went wrong. Try again.' };
const call = (name, payload) => invoke(name, payload).catch(() => GENERIC_ERROR);

const RegisterModal = ({ chains, onClose, onRegistered }) => {
  const [chain, setChain] = useState(chains[0] || null);
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    const result = await call('registerContract', { chain: chain?.value, address, name });
    setSaving(false);
    if (result.ok) onRegistered(result.contract);
    else setError(result.message);
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader>
        <ModalTitle>Register a contract</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <Stack space="space.200">
          <Text>
            Onveris reads the contract from the chain and records what it finds. Later checks compare the chain
            against that record.
          </Text>
          {error && (
            <SectionMessage appearance="error" title="Couldn't register this contract">
              <Text>{error}</Text>
            </SectionMessage>
          )}
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
        <Button appearance="subtle" onClick={onClose} isDisabled={saving}>
          Cancel
        </Button>
        <Button
          appearance="primary"
          onClick={submit}
          isLoading={saving}
          isDisabled={!chain || !address.trim() || !name.trim()}
        >
          Read and register
        </Button>
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
        <Button appearance="danger" onClick={remove} isLoading={removing}>
          Remove
        </Button>
      </ModalFooter>
    </Modal>
  );
};

const ContractDetail = ({ contract, fields, onBack, onUpdated, onRemoved }) => {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const check = async () => {
    setChecking(true);
    setError(null);
    const result = await call('checkContract', { id: contract.id });
    setChecking(false);
    if (result.ok) onUpdated(result.contract);
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
          <Button onClick={check} isLoading={checking}>
            Check now
          </Button>
          <Button appearance="danger" onClick={() => setConfirmRemove(true)}>
            Remove
          </Button>
        </ButtonGroup>
      </Inline>

      {error && (
        <SectionMessage appearance="error" title="Check failed">
          <Text>{error}</Text>
        </SectionMessage>
      )}

      {contract.status === 'drift' && (
        <SectionMessage appearance="error" title="The chain no longer matches the record">
          <Text>
            {contract.differences.map((d) => d.label).join(', ')} changed on the chain since this contract was
            recorded. If nobody planned this change, treat it as an incident.
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
            ],
          }}
          rows={rows}
        />
      </Stack>

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
        <EmptyState
          header="Keep your contract records true to the chain"
          description="Register a smart contract and Onveris records its implementation, admin, owner and code. It then checks the chain and tells you when something changes. Read-only: no wallet or keys."
          primaryAction={
            <Button appearance="primary" onClick={() => setRegistering(true)}>
              Register a contract
            </Button>
          }
        />
        {registerModal}
      </>
    );
  }

  const rows = registry.contracts.map((contract) => ({
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
          <Button onClick={checkAll} isLoading={checkingAll}>
            Check now
          </Button>
          <Button appearance="primary" onClick={() => setRegistering(true)}>
            Register contract
          </Button>
        </ButtonGroup>
      </Inline>

      {notice && (
        <SectionMessage appearance={notice.appearance}>
          <Text>{notice.text}</Text>
        </SectionMessage>
      )}

      <DynamicTable
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
