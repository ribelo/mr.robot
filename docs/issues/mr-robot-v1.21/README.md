# Mr. Robot v1.21 — tickets (revision 2)

Spec: ../mr-robot-v1.21.md. Needs v1.20 merged. Frontier at the start: 01. Then 02, 03 and 09 in parallel; then 04 and 07; then 05, 06; then 08 and 10; then 11; then 12 (acceptance, by the owner with a Coding Robot).

| # | Ticket | Blocked by | Status |
|---|---|---|---|
| 01 | [Host groundwork: environment, policy from grants, protocol version, Workspace session](01-host-groundwork.md) | — | done |
| 02 | [Words and the Workspace setting](02-words-and-workspace.md) | 01 | done |
| 03 | [File tools on a Host: hash, line endings, idempotent writes, limits](03-file-tools-hardening.md) | 01 | done |
| 04 | [Instructions and skills from the Host](04-host-instructions-skills.md) | 02, 03 | done (one check by hand) |
| 05 | [Worktrees](05-worktrees.md) | 04 | done (one check by hand) |
| 06 | [LSP on the Host](06-lsp.md) | 04 | done (one check by hand) |
| 07 | [The Code view: setting and renderers](07-code-view-renderers.md) | 02 | done |
| 08 | [The Workspace panel and the static prompt line](08-workspace-panel.md) | 04, 05, 07 | done |
| 09 | [The service Host](09-service-host.md) | 01 | done (one check by hand) |
| 10 | [The chief, the Coding Robot definition, the Add form, the coding skill, the prompt bound](10-chief-definition-skill.md) | 02, 04, 07 | ready-for-agent |
| 11 | [Glossary and docs](11-glossary-docs.md) | 02, 04, 05, 06, 07, 08, 09, 10 | ready-for-agent |
| 12 | [Acceptance: one ticket by a Coding Robot](12-acceptance.md) | 01 to 11 | ready-for-agent |
