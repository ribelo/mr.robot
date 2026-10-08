# 07: SKILL.md per connector and the mBank notifications skill

**Parent:** mr-robot-v1.5 (../mr-robot-v1.5.md) — stories cn-go3s, cn-6kh9, cn-07jo

**What to build:** A SKILL.md per connector with common flows, granted with the connector; an mBank skill that reads the bank's notification e-mails through Gmail and reports balance and transactions; trajectory shows connector calls with account and action.

**Blocked by:** 03 Gmail and Calendar tools; 05 Discord bot plugin and channel; 06 Slack plugin with pasted session

**Status:** in-progress

- [ ] Skills appear in the library and load only with the connector grant
- [ ] Live: a robot reports the latest mBank transactions from notification e-mails
- [ ] Trajectory records show account and action

## How it works

- **connectors/skills.ts:**
  - google-workspace: inbox triage, scheduling, filing an attachment into Drive, filling a Sheet.
  - mbank-notifications: read mBank's notification e-mails through Gmail and report balance and transactions, quoting only what the e-mails say, never logging in to the bank.
  - slack-workspace and discord-bot.
- They are added to the Home's skill library when a person first connects anything. An admin's edit is kept, because later seeding never overwrites a skill of the same name.
- A robot loads a connector's skills only through that connector's grant. An ordinary skill grant is not enough, and a robot without the skills tool group still gets them with the connector.
- **Trajectory:** every connector call's result starts with "[kind · Label (account)] action" (ticket 01), so the trajectory shows account and action.

## Verified

- **connector-skills.test.ts:**
  - The skills appear in the library on the first connection.
  - A robot granted only the mbank skill does not get it; a robot granted the Google connection gets google-workspace and mbank-notifications but not slack-workspace.
  - An admin edit survives the next seeding.
- **Open, needs the owner:** mBank e-mail notifications switched on and a connected Gmail, then a live report of the latest transactions.

## Live, 2026-10-08
- On the deployed app, the library has google-workspace, mbank-notifications, slack-workspace and discord-bot, added when Google was first connected.
- Mr. Robot's prompt (he holds the Google connection) offers google-workspace and mbank-notifications.
- **Postponed by the owner:** whether mBank notifications are on, and so the live mBank report.
