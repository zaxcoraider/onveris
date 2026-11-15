# Onveris: developer guide

The Forge app behind Onveris. For what it does and how to try it, see the [README](README.md).

## Setup

Requirements: Node.js 24 and the [Forge CLI](https://developer.atlassian.com/platform/forge/set-up-forge/), logged in.

```sh
npm install
forge register        # once, to create your own copy of the app
forge deploy
forge install         # choose Jira and your site
```

A change of scope or allowed endpoint in `manifest.yml` is a major version: deploy with `--approve MAJOR_VERSION_RULE`, then run `forge install --upgrade`.

## Tests and checks

```sh
npm test       # node's built-in test runner
npm run lint   # eslint over src and test
forge lint     # manifest checks
```

Most tests run the real services against in-memory storage with a scripted chain and Jira (`node:test` module mocks). `test/reader.test.js` reads live public chains and needs a network connection.

## Forge modules

| Module | Purpose |
|---|---|
| `jira:globalPage` | The registry, contract detail, open changes and history |
| `jira:issuePanel` | Linked contracts on an issue, and planned changes |
| `jira:adminPage` | Project for drift issues, and a statement of what leaves Atlassian |
| `scheduledTrigger` | The five-minute check (`fiveMinute`, 300 second timeout, 240 second work budget) |
| `rovo:agent`, `action` | The Onveris agent and four read-only actions |
| `rovo:mcp` | The same actions as MCP tools |
| `graph:connector` | Registered contracts as documents in the Teamwork Graph |

## Permissions

| Scope | Why |
|---|---|
| `storage:app` | Contracts, changes, planned changes and settings |
| `read:jira-work` | Read linked issues and projects as the current user |
| `write:jira-work` | Create, comment on and close drift issues, as the app |
| `read:object:jira`, `write:object:jira`, `delete:object:jira` | Teamwork Graph connector |

External fetches are allowed only to the public JSON-RPC endpoints listed under `permissions.external.fetch.backend`. Every host in `src/services/chains.js` must also be declared there.

## Code layout

```
manifest.yml
src/
  index.js              every function handler named in the manifest
  resolvers/
    index.js            registry page and issue panel
    admin.js            settings page only
  triggers/index.js     the scheduled check
  actions/index.js      Rovo actions and MCP tools
  connector/index.js    Teamwork Graph connector
  services/
    chains.js           supported chains and endpoints
    rpc.js              batched JSON-RPC with endpoint failover
    reader.js           reads a contract: code hash, proxy slots, owner
    registry.js         register, check, remove, issue links
    decide.js           pure logic: what a check's differences mean
    drift.js            change records, drift issues, reconcile, planned changes
    history.js          the transaction behind a newly detected change
    issues.js           Jira calls
    samples.js          sample contracts
  storage/              key-value storage, one record per item under a key prefix
  frontend/             UI Kit views: registry, issue panel, settings
test/                   node --test suites
static/icons/           app icons
```

## Conventions

- Resolvers are thin: they check who and what, call a service, and always answer `{ ok: true, ... }` or `{ ok: false, message }`.
- `RegistryError` carries a message the user can act on; anything else is logged and shown as a general error.
- A failed chain read raises `ChainUnreachableError`, which marks the contract unreachable and is never treated as a change.
- Jira is called as the user when one is present, and as the app from the scheduled check.
- Imports between our own files include the `.js` extension, so services also run under plain Node for tests.
