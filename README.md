# Onveris

**Your Jira says one thing. The blockchain says another. Onveris tells you when, and opens the ticket.**

Onveris is an Atlassian Forge app for teams that run smart contracts. It keeps the team's record of each contract in Jira true to what is actually on the chain. When a contract changes and no Jira issue explains why, Onveris raises one.

It only reads public blockchain data. It holds no keys, connects to no wallet and cannot send transactions.

Built for **Codegeist 2026**, category **Apps for Specialized Industries**.

---

## The problem

Many smart contracts that hold real money are *upgradeable*: someone with the right key can swap the code the contract runs, or hand control to someone else.

Teams plan that work in Jira. But the blockchain is the only source of truth, and the two drift apart:

- A contract is upgraded, or its owner changes, and **no ticket records it**. That is either a broken process or a security incident.
- Addresses and versions in docs and tickets **go stale**.
- Nobody can easily answer: *"What changed on our contracts this month, and was each change approved?"*

No blockchain knowledge is needed to see the risk: it is an unapproved change to production.

## What Onveris does

| | |
|---|---|
| **Records each contract** | Register a contract by chain and address. Onveris reads it from the chain and records which code it runs, who can change it, and a fingerprint of its code. |
| **Watches the chain** | Every five minutes it compares the chain with the record. Any difference becomes a change, with before and after values and the transaction when the chain identifies it. |
| **Opens a Jira issue** | A change that no issue announced raises an issue in the project you choose, explaining what changed and what to do. |
| **Knows planned work** | An issue can declare in advance that it will change a contract. When that change lands, it is matched to the issue and nothing is raised. |
| **Closes the loop** | Link a change to the issue that explains it, or acknowledge it with a note. The record updates, the change goes into the contract's history, and Onveris comments on and closes its issue. |
| **Shows it in context** | A panel on any Jira issue shows the live state of the contracts it concerns. |
| **Answers questions** | A Rovo agent answers "has anything changed this week?" from the registry, and the same tools are available to other AI agents over the Atlassian MCP server. |

### Built not to cry wolf

- **A failed read is never reported as a change.** If a chain cannot be reached, the contract shows as *unreachable* with its last known values, and nothing is raised.
- **Two checks never raise the same issue twice.** Recording a change takes a short per-contract claim in storage.
- **People only see issues they are allowed to see.** Linked issues are read from Jira as the person looking.

## Try it in five minutes

You need a Jira Cloud site where you can install apps and are a Jira admin.

1. **Install** Onveris from the install link in the Devpost submission.
2. **Load samples.** Open **Apps > Onveris** in Jira and choose **Load sample contracts**. Eight well-known public contracts on five chains are read live and appear *In sync*.
3. **Choose where issues go.** Open **Settings (⚙️) > Apps**, choose **Onveris** in the left menu, pick a project and save.
4. **Cause a change.** Open any sample contract, choose **Edit record** on the *Proxy admin* row, change the last character and choose **Save and check**. Onveris shows **Drift**, records the change and opens a Jira issue for it.
5. **Reconcile it.** Choose **Acknowledge**, add a note and confirm. The contract is back *In sync*, the change is in **History**, and the Jira issue gets a comment and is closed.
6. **See it on an issue.** Open any Jira issue, open the **Onveris** panel from the apps button under the title, and link a contract. Choose **Declare change**, pick **Proxy admin** and declare it. Then repeat step 4 on that contract: this time the change is recognised as planned and no issue is raised.
7. **Ask Rovo** (if your site has it). Open Rovo Chat, choose the **Onveris** agent and ask *"Has anything changed this week?"*

Editing the record is the same as the chain changing under you: Onveris cannot tell the difference, so the full flow can be tried without touching a blockchain.

## How it works

```
 Registry page ─┐
 Issue panel ───┤                     ┌─ Forge storage (contracts, changes, plans)
 Settings page ─┼─ resolvers ─┐       ├─ Jira REST API (read issues, open and close drift issues)
 Rovo actions ──┤             ├─ core ┤
 MCP tools ─────┤             │       ├─ Public blockchain endpoints (read-only JSON-RPC)
 5-min check ───┘─────────────┘       └─ Teamwork Graph
```

Every entry point calls the same core services, so the page, the issue panel, the agent and the scheduled check always agree.

- **Reading the chain:** standard public JSON-RPC calls. The code fingerprint comes from `eth_getCode`, proxy details from the standard storage slots (EIP-1967 and the older OpenZeppelin layout), the owner from `owner()`, and the transaction behind a change from upgrade and ownership events.
- **Chains:** Ethereum, Base, Arbitrum One, Optimism, Polygon and the Sepolia test network, each with two public endpoints tried in turn.
- **Data that leaves Atlassian:** only contract addresses, in standard read requests to those endpoints. Nothing from Jira or Confluence is sent anywhere.

## Built with

Atlassian Forge, UI Kit, Forge key-value storage, scheduled triggers, Jira REST API, Rovo agents and actions, the Atlassian MCP server (`rovo:mcp`), and the Teamwork Graph connector. JavaScript on Node.js 24, with no blockchain libraries beyond a hashing package.

## In this repository

This repository is the Forge app itself: [`manifest.yml`](manifest.yml), [`src/`](src/) and [`test/`](test/). [DEVELOPMENT.md](DEVELOPMENT.md) covers setup, modules, permissions, tests and the code layout.

## Status

Working today: everything above. Still to come before the deadline: live updates to the Teamwork Graph, and a Confluence macro with a live deployment table. Onveris knows the changes it has seen since a contract was registered; older history is not available from free public endpoints.
