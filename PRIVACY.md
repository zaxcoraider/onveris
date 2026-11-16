# Onveris privacy policy

Last updated: 16 November 2026

Onveris is an Atlassian Forge app that compares a team's record of its smart contracts with public blockchain data. It runs entirely on Atlassian's Forge platform. The developer operates no servers of their own and cannot see the data of any site that installs the app.

## Personal data

Onveris does not store personal data. It keeps no names, email addresses or Atlassian account IDs.

To decide what a person may see or do, Onveris asks Jira and Confluence at that moment, as that person: which issues and pages they can view, and whether they are a Jira admin. The answers are used for that request and are not stored.

## What Onveris stores

Everything below is kept in Atlassian's Forge storage for your site, and nowhere else:

- The contracts you register: the name you give each one, its chain and address, and the public values read from the chain (implementation, proxy admin, beacon, owner and a fingerprint of the code).
- The changes Onveris detects, with before and after values, the transaction where the chain identifies it, and the note an admin writes when acknowledging a change.
- Links between contracts and Jira issues (issue ID and key) and Confluence pages (page ID). Issue summaries and page titles are not stored; they are read when shown.
- Planned changes declared on an issue.
- Settings: the Jira project chosen for drift issues, and when the automatic check last ran.

Notes and contract names are free text. Do not put personal data in them.

## What leaves Atlassian

To read a contract, Onveris sends its address in a standard, read-only request to public blockchain endpoints: PublicNode, 1RPC, and the public endpoints of Base, Arbitrum and Optimism. The requests come from Atlassian's Forge platform, not from your browser. Nothing from Jira or Confluence is sent to them: no issue content, no page content and nothing about your users.

Onveris holds no keys, connects to no wallet and cannot send transactions.

## What Onveris writes in your Atlassian products

- A Jira issue in the project your admin chooses, when a contract changes with nothing to explain it, and a comment on that issue when the change is resolved.
- If an admin connects the Teamwork Graph connector: each registered contract, with its name, address and public chain values, visible to everyone on the site.

## Logs

Forge keeps technical logs of the app's activity, such as how many contracts were checked and whether a chain could be reached. They can include contract addresses and Jira issue keys. They contain no personal data.

## Keeping and deleting data

Data stays in Forge storage for as long as the app is installed. A Jira admin can remove a contract in Onveris at any time, which deletes its record, changes and planned changes. Uninstalling the app leaves the stored data to Atlassian, which deletes it under its own Forge data retention rules.

## Changes and contact

Changes to this policy are published in this file. For questions, open an issue at https://github.com/zaxcoraider/onveris/issues.
