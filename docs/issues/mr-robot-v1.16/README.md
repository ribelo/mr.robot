# Mr. Robot v1.16 — tickets

Spec: ../mr-robot-v1.16.md. Frontier at the start: 01, 05, 08 in parallel; then 02, 06; then 03, 04, 07, 09; then 10.

| # | Ticket | Blocked by | Status |
|---|---|---|---|
| 01 | [One execution surface: run, file tools, copy and jobs with a mandatory on](01-one-surface.md) | — | ready-for-agent |
| 02 | [The Host executes through DSH: bash, sandbox, modes and roots](02-host-through-dsh.md) | 01 | ready-for-agent |
| 03 | [Jobs on a Host through DSH jobs-local](03-host-jobs.md) | 02 | ready-for-agent |
| 04 | [Windows Host: build, pwsh, restricted-token sandbox](04-windows-host.md) | 02 | ready-for-agent |
| 05 | [A Robot that waits for its Hosts](05-requires-hosts.md) | — | ready-for-agent |
| 06 | [Files without limit: presigned R2 copies and ws in the Box](06-files-without-limit.md) | 01 | ready-for-agent |
| 07 | [The Box image and the generated docs/box.md](07-box-image.md) | 06 | ready-for-agent |
| 08 | [Two browsers: remove Container Chrome and its variants](08-two-browsers.md) | — | ready-for-agent |
| 09 | [Native Ask on a Host and Mr. Robot's defaults](09-host-ask-and-defaults.md) | 02 | ready-for-agent |
| 10 | [Skills, prompt, glossary and docs](10-skills-glossary-docs.md) | 01, 02, 03, 04, 05, 06, 07, 08, 09 | ready-for-agent |
