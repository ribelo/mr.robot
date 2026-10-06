# Mr. Robot v1 — tickets

Tracker: Markdown files in this directory. Work the frontier: any ticket whose blockers are done. Status field: ready-for-agent → in-progress → done.

| # | Ticket | Blocked by |
|---|---|---|
| 01 | [Repository skeleton and first Cloudflare deploy](01-skeleton-and-deploy.md) | — |
| 02 | [Code-mode isolate prototype and decision](02-ptc-isolate-prototype.md) | 01 |
| 03 | [A Robot Durable Object runs one turn](03-robot-do-runs-a-turn.md) | 01 |
| 04 | [Robot creation interview, grant approval, Mr. Robot bootstrap](04-robot-creation-and-grant-approval.md) | 03 |
| 05 | [Workspace in R2, persona files, basic tools](05-workspace-persona-files-basic-tools.md) | 03 |
| 06 | [Routines on Durable Object alarms](06-routines-on-do-alarms.md) | 03 |
| 07 | [Code mode executor, tool grants, advanced settings](07-code-mode-and-tool-grants.md) | 02, 04 |
| 08 | [Browser Rendering provider with Leash primitives](08-browser-primitives.md) | 07 |
| 09 | [Live view and takeover from the phone](09-live-view-and-takeover.md) | 08, 11 |
| 10 | [Trajectory view and rewind](10-trajectory-and-rewind.md) | 03 |
| 11 | [Web Push and notification settings](11-web-push-and-notifications.md) | 04 |
| 12 | [Secrets vault and secret.get](12-secrets.md) | 07 |
| 13 | [Providers, subscriptions and per-robot model](13-providers-and-subscriptions.md) | 04 |
| 14 | [Usage accounting and spend limits](14-usage-and-spend-limits.md) | 13 |
| 15 | [Robot-to-robot messaging and Mr. Robot coordination](15-robot-to-robot-messaging.md) | 07 |
| 16 | [Home skill library and per-robot skill grants](16-skill-library.md) | 07 |
| 17 | [Admin view](17-admin-view.md) | 06, 13, 14, 16 |
| 18 | [Channel seam with the PWA as first adapter](18-channel-seam.md) | 11 |
| 19 | [OpenCode Go as a Provider with key rotation](19-opencode-go-provider.md) | 13 |
| 20 | [Live model catalogs from configured providers](20-live-model-catalogs.md) | 13 |
| 21 | [Robot list menu, Edit profile sheet, routine detail](21-robot-profile-and-routine-detail.md) | 06, 11 |
| 22 | [Trajectory view with DeepSeek Harness parity](22-trajectory-parity-with-dsh.md) | 10 |
| 23 | [Durable Object internals on Effect](23-effect-in-durable-objects.md) | — |

Story-by-story status: [verification.md](verification.md).
