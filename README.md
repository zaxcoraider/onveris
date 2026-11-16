# Onveris

**Your Jira says one thing. The blockchain says another. Onveris tells you when, and opens the ticket.**

Onveris is an Atlassian Forge app for teams that run smart contracts. It keeps the team's record of each contract in Jira and Confluence true to what is actually on the chain. When a contract changes and no Jira issue explains why, Onveris raises one.

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
| **Records each contract** | Register a contract by chain and address. Onveris reads it from the chain and records which code it runs, who can change it, and a fingerprint of its code. Link the Jira issues that plan its changes and the Confluence pages that document it. |
| **Watches the chain** | Every five minutes it compares the chain with the record. Any difference becomes a change, with before and after values and the transaction when the chain identifies it. |
| **Opens a Jira issue** | A change that no issue announced raises an issue in the project you choose, explaining what changed and what to do. |
| **Knows planned work** | An issue can declare in advance that it will change a contract. When that change lands, it is matched to the issue and nothing is raised. |
| **Closes the loop** | Link a change to the issue that explains it, or acknowledge it with a note. The record updates, the change goes into the contract's history, and Onveris comments on and closes its issue. |
| **Shows it in context** | A panel on any Jira issue shows the live state of the contracts it concerns, and lets you reconcile their open changes right there: "this issue explains it", link another issue, or acknowledge. |
| **Keeps docs live** | A Confluence macro puts a live table of the registered contracts on any page, filtered by chain and status, so deployment pages never go stale. |
| **Answers questions** | A Rovo agent answers "has anything changed this week?" from the registry, and the same tools are available to other AI agents over the Atlassian MCP server. An open [skill file](skills/onveris/SKILL.md) teaches any agent how to set them up and use them. |

### Built not to cry wolf

- **A failed read is never reported as a change.** If a chain cannot be reached, the contract shows as *unreachable* with its last known values, and nothing is raised.
- **Two checks never raise the same issue twice.** Recording a change takes a short per-contract claim in storage.
- **People only see issues and pages they are allowed to see.** Linked issues and Confluence pages are read as the person looking.

## Try it in five minutes

You need a Jira Cloud site where you can install apps and are a Jira admin. Confluence on the same site is optional (step 7).

1. **Install** Onveris in Jira from the install link in the Devpost submission.
2. **Load samples.** Open **Apps > Onveris** in Jira and choose **Load sample contracts**. Eight well-known public contracts on five chains are read live and appear *In sync*.
3. **Choose where issues go.** Open **Settings (⚙️) > Jira apps** and choose **Onveris** under **Apps** in the left menu. Pick a project and save. Below it, **How Onveris is running** tests every chain endpoint live and shows when the automatic check last ran.
4. **Cause a change.** Open any sample contract, choose **Edit record** on the *Proxy admin* row, change the last character and choose **Save and check**. Onveris shows **Drift**, records the change and opens a Jira issue for it.
5. **Reconcile it.** Choose **Acknowledge**, add a note and confirm. The contract is back *In sync*, the change is in **History**, and the Jira issue gets a comment and is closed.
6. **Work from an issue.** Open any Jira issue and choose **Onveris** in the row of app buttons under the title. Link a contract.
   - **Reconcile from the issue:** repeat step 4 on that contract. The panel now lists the open change; choose **… explains it** (the button carries this issue's key). The change is linked to the issue and the contract is back *In sync*.
   - **Plan ahead:** choose **Declare change**, pick **Proxy admin** and declare it. Repeat step 4 once more: this time the change is recognised as planned and no issue is raised.
7. **Put it in Confluence** (optional). Onveris is installed in Jira first; to use it in Confluence on the same site, connect it there: in [Atlassian Administration](https://admin.atlassian.com) open **Apps > Connected apps**, choose **View app details** on **onveris**, open **Connections** and connect **Confluence**. Then edit any page, type `/Onveris contracts` (or use **+** in the toolbar) and publish. The table shows every registered contract with its live status; choose **Edit** on the macro to filter by chain or status.
8. **Ask Rovo** (if your site has it). Open Rovo Chat, choose the **Onveris** agent and ask *"Has anything changed this week?"*

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
- **Endpoints:** free public endpoints, so no keys or sign-up are needed. The first choice on every chain is [PublicNode](https://www.publicnode.com/terms), whose terms allow automated reads like these; the fallbacks are other free endpoints that run on a best-effort basis. A team using Onveris for real would point it at its own node provider.
- **Data that leaves Atlassian:** only contract addresses, in standard read requests to those endpoints. Nothing from Jira or Confluence is sent anywhere.

## Built with

Atlassian Forge, UI Kit, Forge key-value storage, scheduled triggers, Jira REST API, Rovo agents and actions, the Atlassian MCP server (`rovo:mcp`), and the Teamwork Graph connector. JavaScript on Node.js 24, with no blockchain libraries beyond a hashing package.

## In this repository

This repository is the Forge app itself: [`manifest.yml`](manifest.yml), [`src/`](src/) and [`test/`](test/), plus [`skills/onveris/SKILL.md`](skills/onveris/SKILL.md) for third-party AI agents. [DEVELOPMENT.md](DEVELOPMENT.md) covers setup, modules, permissions, tests and the code layout.

## Status

Working today: everything above. Still to come before the deadline: live updates to the Teamwork Graph. Onveris knows the changes it has seen since a contract was registered; older history is not available from free public endpoints.
