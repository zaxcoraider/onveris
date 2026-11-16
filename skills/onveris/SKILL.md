---
name: onveris
description: Check a team's smart contracts against the blockchain using the Onveris tools on the Atlassian MCP server. Use when the user asks whether their contracts changed, what a contract currently runs, who controls it, which changes are still unexplained, or wants to compare a contract's live state with its record in Jira.
---

# Onveris: smart contract records kept true to the chain

Onveris is an Atlassian Forge app. A team registers its smart contracts in Jira; Onveris records which code each contract runs (its implementation), who can upgrade it (proxy admin), who owns it, and a fingerprint of its code. Every five minutes it compares the chain with that record. A difference becomes a *change*, and a change that no Jira issue announced raises a Jira issue.

These tools are **read-only**. They cannot register contracts, reconcile changes, or send transactions. Onveris holds no keys and connects to no wallet.

## Setup

1. Onveris must be installed on the user's Atlassian site.
2. A site or org admin turns on its tools: in [Atlassian Administration](https://admin.atlassian.com), open **Apps > Sites > *the site* > Connected apps**, choose **onveris**, open its app details and enable the tools under **Tools**.
3. Add the remote MCP server to your client:

   ```
   https://mcp.atlassian.com/forge/0d7d779b-4386-4240-a63a-675969946686
   ```

   For example, in Claude Code:

   ```shell
   claude mcp add --transport http onveris https://mcp.atlassian.com/forge/0d7d779b-4386-4240-a63a-675969946686
   ```

   Connecting opens an Atlassian consent screen; choose the site and approve. Tools then run with the user's own permissions on that site.

## Tools

| Tool | Use it for | Inputs |
|---|---|---|
| `list-contracts` | What is registered, and the status of each | `chain` and `status` (both optional) |
| `contract-status` | One contract: recorded values next to the values last read from the chain, and changes still open | `contract` (name or address), `chain` (optional) |
| `recent-changes` | What changed lately, newest first, and how each change was resolved | `days` (default 7), `contract`, `chain` (all optional) |
| `read-contract` | A live read of any contract, registered or not | `chain`, `address` (both required) |

Chains: `ethereum`, `base`, `arbitrum`, `optimism`, `polygon`, `sepolia`. Statuses: `in sync`, `drift`, `unreachable`. Addresses are `0x` followed by 40 hexadecimal characters.

Every tool returns `ok`. When `ok` is false, tell the user the `message` and stop; do not guess an answer. `read-contract` can also return `found: false`: nothing is deployed at that address on that chain, which often means the wrong chain was chosen.

## What the words mean

- **In sync**: the record matches the chain.
- **Drift**: the chain differs from the record. Treat an unexplained drift as a possible incident until someone explains it.
- **Unreachable**: Onveris could not read that chain on its last check. This is a connection problem, **never** a change to the contract. Do not describe an unreachable contract as changed.
- Change statuses from `recent-changes`:
  - *unrecorded*: nobody has explained it yet.
  - *planned*: a Jira issue announced it in advance.
  - *reconciled*: linked to the issue that explains it.
  - *acknowledged*: accepted with a note.
  - *matches the record again*: the change reverted on its own.
- **Implementation**: the code an upgradeable contract currently runs. **Proxy admin**: who can switch that code. **Owner**: who controls the contract's privileged functions. **Code fingerprint**: a hash of the contract's own code.

## How to answer

- Say when the data is from. Status comes from the last check (`lastCheckedAt`), usually within five minutes.
- Lead with what needs attention: unrecorded changes and drift first, then everything in sync in one line.
- Give the transaction link (`transactionUrl`) when a change has one, and the explorer link for a contract.
- Shorten addresses in prose (`0x1234…abcd`), but give full addresses when the user will copy them.
- To act on a change (link it to an issue, acknowledge it, register a contract), send the user to Onveris in Jira: **Apps > Onveris**. These tools cannot do it.
- `read-contract` reads the chain directly and does not compare anything with a record. Use `contract-status` for "is it still what we recorded?"

## Examples

**"Has anything changed on our contracts this week?"**
Call `recent-changes` with no inputs. If the list is empty, say nothing changed in the last 7 days and when the last check ran (from `list-contracts`). Otherwise list the unrecorded changes first, each with contract, chain, what changed, before and after, and the transaction.

**"Is the Treasury contract still running the version we approved?"**
Call `contract-status` with `contract: "Treasury"`. Compare the recorded and on-chain implementation. If several contracts match the name, ask which chain and call again with `chain`.

**"What does 0x… on Base run right now?"**
Call `read-contract` with `chain: "base"` and the address. Report whether it is an upgradeable proxy, its implementation, proxy admin and owner. If the contract is also registered, offer to compare it with its record using `contract-status`.
