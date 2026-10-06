# Mr. Robot v1: story verification

Checked 2026-10-07 against the deployed app (mrrobot-edge-live-ribelo-ffe667mhzh4ttltx.r-krzywaznia-2c4.workers.dev), the worker and PWA test suites, and the staging Browser Rendering test (`pnpm --filter @mr-robot/worker test:integration`). "Live" means exercised by clicking through the deployed PWA as the owner. Test names refer to apps/worker/test and apps/web/test.

Status: **works** (implemented and verified as stated), **partial** (part of the story is missing or rests on an instruction rather than enforcement), **not implemented**.

## Not fully working

- 44 robot-b49q: partial. Not tested against a real CAPTCHA
- 48 robot-o6lf: partial. Fetch: tests. Search needs a DeepSeek key (the Home has none); keyless engines refuse servers (DuckDuckGo answers a bot check)
- 84 robot-naul: partial (by decision). DO classes are plain async classes (ADR 0002)
- 91 robot-lulc: partial. Live: sheet used. The "wake on screen notifications" toggle is not built: a Robot's browser exists only during a Turn
- 95 robot-cmz9: partial (no images). Live: inspector on run_code. Images are not shown: Robots store no image attachments

## Corrected on 2026-10-06/07 after the review

Until these fixes the stories were marked done but did not hold:
- Claude, ChatGPT, OpenRouter and OpenCode Go Turns failed in DSH (effort metadata used `label` instead of `name`); only Workers AI ran. Now covered by real-adapters.test.ts.
- The model list was a typed-in list; now each Provider's live list (stories 63, 87–89).
- A Robot could be created on a model without a credential and failed its first Turn (89).
- The PWA crashed on load after an update (hook order); now covered by app.test.tsx.
- In code mode, the default, routine cards, reactions and Grant questions did not appear in the chat (10, 23, 31).

## All stories

| # | Story | Implemented | Verified | Status |
|---|---|---|---|---|
| 1 | robot-7v5x | Cloudflare Access (one-time PIN) in front of the edge Worker; the Worker verifies the Access JWT against the team keys | Live: signed in with an e-mail code, /api/me returned the Member. Test: access.test.ts | works |
| 2 | robot-q7rj | Home DO holds Members and the registry; one Home per deployment | Live: admin Member in Home "Home". Tests: home.test.ts | works |
| 3 | robot-vplt | Secrets sealed in the Member DO; Home-shared secrets in the Home DO; vault UI on the profile page | Tests: secrets.test.ts (encryption at rest, sharing) | works |
| 4 | robot-dic7 | Provider credentials in the Member DO, "shared with the Home" switch | Live: Claude subscription connected and used. Tests: providers.test.ts, opencode-go.test.ts | works |
| 5 | robot-d2uv | Admin view invite/remove; removal pauses their Robots and closes their open views | Tests: home.test.ts, admin.test.ts, takeover.test.ts (socket closed on removal) | works |
| 6 | robot-mn09 | A new Home has no Robots except each Member's Mr. Robot | Live: first sign-in showed only Mr. Robot. Test: home.test.ts | works |
| 7 | robot-1xbe | Home bootstraps Mr. Robot on first sign-in | Live: Mr. Robot present and answering. Test: home.test.ts | works |
| 8 | robot-btct | "New robot" form; the Robot runs a setup interview, names itself, writes its persona | Live: Flat Watcher interviewed the owner, set its name and colour (2026-10-07). Test: lifecycle.test.ts | works |
| 9 | robot-cobv | Setup ends in one Grant summary question; compare-and-swap approval | Live: approved web+routines; the Robot became active and created its routine. Test: lifecycle.test.ts | works |
| 10 | robot-vy9z | propose_grants as a question card; also in code mode | Tests: code-mode.test.ts, code-mode-chat.test.ts | works |
| 11 | robot-hpj1 | Robots are private by default | Test: lifecycle.test.ts (shared vs private) | works |
| 12 | robot-bld3 | "Shared with the Home" in advanced settings | Test: lifecycle.test.ts | works |
| 13 | robot-qo06 | Pause/Resume/Delete in advanced settings (two-step delete) | Test: lifecycle.test.ts | works |
| 14 | robot-hk2s | Mr. Robot tools robot_create, robot_configure and messaging | Test: messaging.test.ts (creates a Robot, Grants synced) | works |
| 15 | robot-70kf | Home syncs Mr. Robot's recipient Grants to every reachable Robot | Tests: lifecycle.test.ts, messaging.test.ts | works |
| 16 | robot-frf5 | One live DSH session per Robot in DO SQLite; chat is a projection of it | Live: same conversation in chat and trajectory. Test: robot-turn.test.ts | works |
| 17 | robot-q4b2 | Robot list (last line, time, unread), bubbles, routine cards, screen thumbnail | Live: list, bubbles, "Created routine" cards seen. Tests: chat-view.test.tsx, app.test.tsx | works |
| 18 | robot-jlzk | Composer with attachments stored in the Workspace | Test: workspace.test.ts (the Robot reads the attachment). Not exercised live | works (not tried live) |
| 19 | robot-h5v3 | DSH trajectory view (ported ui-trajectory) over the session events | Live: Mr. Robot's 4 Turns with the code program and nested call. Test: robot-trajectory.test.tsx | works |
| 20 | robot-0q6a | Rewind sheet on the trajectory page (per Turn) | Tests: rewind.test.ts; the sheet was opened live but not used on the owner's data | works (per Turn, not per record) |
| 21 | robot-8v1t | Rewind archives the old session; Undo restores it | Test: rewind.test.ts | works |
| 22 | robot-acr3 | Rewind note tells the Robot that external effects stand, listing tools used after the point | Test: rewind.test.ts | works |
| 23 | robot-i3et | react tool; 👍 on the member message, also from code mode | Tests: routines.test.ts, code-mode-chat.test.ts | works |
| 24 | robot-9qnj | Robot messages rendered with sender avatar and name | Tests: messaging.test.ts, chat-view.test.tsx | works |
| 25 | robot-om9f | Muse files seeded into the R2 Workspace | Live: Flat Watcher filled IDENTITY/AGENTS/MEMORY. Test: workspace.test.ts | works |
| 26 | robot-h1nm | SOUL.md change detected after a Turn and noticed in the chat | Live: "Flat Watcher changed SOUL.md." Test: workspace.test.ts | works |
| 27 | robot-mj7v | USER.md and PROACTIVE_PREFERENCES.md in the Member DO, in every prompt, read-only to Robots | Test: workspace.test.ts | works |
| 28 | robot-jpzp | propose_member_file_edit question | Test: workspace.test.ts | works |
| 29 | robot-zzif | Compaction instruction in advanced settings | Test: workspace.test.ts (compaction uses it) | works |
| 30 | robot-sw54 | Context budget slider up to the model's window | Tests: workspace.test.ts, code-mode.test.ts | works |
| 31 | robot-yrw7 | routine_* tools; cards in the chat | Live: "Create a routine…" made "Invoice check" on Claude. Test: routines.test.ts | works |
| 32 | robot-gbbt | once/interval/daily/weekly/cron in the owner's time zone | Test: schedule.test.ts, routines.test.ts | works |
| 33 | robot-qyd5 | Routine cards in the panel and the profile sheet with status | Live: panel showed Invoice check. Test: panel.test.tsx | works |
| 34 | robot-7j1a | Robots sleep in their DO; wake on routine, message, robot message, channel event | Tests: routines.test.ts, messaging.test.ts, channels.test.ts | works |
| 35 | robot-v1gb | Missed occurrences collapse to one run | Test: routines.test.ts | works |
| 36 | robot-makt | Wake-up queue in SQLite, one Turn at a time | Test: robot-turn.test.ts | works |
| 37 | robot-l9te | browser_* tools over Browser Rendering | Staging test on real Browser Rendering: open, observe, type, check, click, screenshot. Test: browser.test.ts | works |
| 38 | robot-t0vc | Cookies and storage saved in the Robot DO between sessions | Staging test: cookie carried into a new session. Test: browser.test.ts | works |
| 39 | robot-ksvy | CDP screencast relayed over the Robot WebSocket to the PWA | Staging test: frames from real Browser Rendering. Test: takeover.test.ts. Not watched live in the PWA | works (PWA view not tried live) |
| 40 | robot-g6qb | Takeover screen: taps, text, keys forwarded as CDP input | Staging test: tap and typing reach a real page. Test: takeover.test.ts | works |
| 41 | robot-doqx | browser_request_takeover; "needs you" push; the Robot waits | Test: takeover.test.ts | works |
| 42 | robot-j4ll | Hand back wakes the Robot with the page URL and a screenshot | Test: takeover.test.ts | works |
| 43 | robot-ueh0 | Prompt rule plus a guard: a click or Enter on a pay/order button (English and Polish labels) is refused with a pointer to a takeover | Test: browser.test.ts ("Kupuję i płacę" refused). Labels outside the pattern are not caught | works |
| 44 | robot-b49q | CAPTCHA vendor detection in observations with guidance; screenshots for image puzzles | Not tested against a real CAPTCHA | partial |
| 45 | robot-5ewr | Code mode default, Worker Loader isolate (ADR 0001) | Live: run_code calling routine_create. Test: code-mode.test.ts | works |
| 46 | robot-ax7s | Code mode switch in advanced settings | Test: code-mode.test.ts | works |
| 47 | robot-8pqy | DSH tool-fs over the R2 fs seam, plus glob/grep/delete | Test: workspace.test.ts | works |
| 48 | robot-o6lf | web_fetch from the Worker; web_search through DeepSeek search | Fetch: tests. Search needs a DeepSeek key (the Home has none); keyless engines refuse servers (DuckDuckGo answers a bot check) | partial |
| 49 | robot-0bde | secret_get for granted names only | Test: secrets.test.ts | works |
| 50 | robot-4zi6 | Secret values redacted before storage and masked in views and robot messages | Test: secrets.test.ts | works |
| 51 | robot-f9ln | Only granted tool groups and skills are registered | Tests: code-mode.test.ts, skills.test.ts | works |
| 52 | robot-0ms7 | No shell or container tool exists; dependency lint | Test: code-mode.test.ts; pnpm lint:deps | works |
| 53 | robot-7qpi | Skill library in the Home DO and R2 | Test: skills.test.ts. No library configured live | works (not tried live) |
| 54 | robot-qjvu | Git sync from GitHub (token optional), admin "Sync now" | Test: skills.test.ts (tarball fixture). Only GitHub is supported | works (GitHub only) |
| 55 | robot-lszy | propose_skill tool | Test: skills.test.ts | works |
| 56 | robot-jqfw | Skill proposal question; approval publishes | Test: skills.test.ts | works |
| 57 | robot-icrv | Per-robot skill Grants; only granted skills in the catalog | Test: skills.test.ts | works |
| 58 | robot-bsvs | robot_directory | Test: messaging.test.ts | works |
| 59 | robot-mv15 | robot_send and robot_reply through the outbox | Test: messaging.test.ts | works |
| 60 | robot-ppzu | Incoming robot message labelled with sender | Test: messaging.test.ts | works |
| 61 | robot-bjq5 | Recipients granted only through owner-approved Grants | Test: messaging.test.ts | works |
| 62 | robot-eiin | No tool creates helpers; only Mr. Robot creates top-level Robots | Test: code-mode.test.ts (tool catalog) | works |
| 63 | robot-82r5 | One model and effort per Robot from the live lists | Live: Mr. Robot switched to Claude Sonnet 5.5 and answered. Tests: real-adapters.test.ts, settings-flow.test.ts | works |
| 64 | robot-lzu3 | OpenAI device flow and Anthropic paste flow | Live: Claude subscription connected and running. ChatGPT adapter checked against the real service with the owner's DSH login (tool call returned); the ChatGPT sign-in in the PWA not tried live | works (ChatGPT sign-in not tried live) |
| 65 | robot-7v9s | DeepSeek, OpenRouter, Workers AI (and OpenCode Go) | Live: Workers AI and OpenCode Go (local live check). DeepSeek/OpenRouter through faked APIs (real-adapters.test.ts) | works (DeepSeek, OpenRouter not tried live) |
| 66 | robot-6nkv | Home default model in admin; a new Robot starts on it when usable | Tests: settings-flow.test.ts, home.test.ts | works |
| 67 | robot-6jqh | Token meter per Turn into Robot and Member counters | Live: panel shows tokens. Test: usage.test.ts | works |
| 68 | robot-8gag | Monthly limits per Robot and per Member | Test: usage.test.ts | works |
| 69 | robot-40nw | Robot blocks and notifies at the limit | Test: usage.test.ts | works |
| 70 | robot-ajrp | Manifest, service worker, icons | Not installed on an Android phone yet | works (not tried on a phone) |
| 71 | robot-9xoj | Web Push per device (VAPID) | Test: push.test.ts against a fake push service. No real phone received one yet | works (not tried on a phone) |
| 72 | robot-r2uz | Notifications switch in the profile sheet and settings | Tests: push.test.ts, panel.test.tsx | works |
| 73 | robot-bden | Quiet hours in the Member DO; PROACTIVE_PREFERENCES.md in every prompt | Test: push.test.ts | works |
| 74 | robot-vfqd | Channel seam with PWA adapter; contract suite | Test: channels.test.ts | works |
| 75 | robot-z3ud | Panel: screen, routines, links; profile sheet for simple settings | Live: panel and sheet. Test: panel.test.tsx | works |
| 76 | robot-vqtw | Advanced settings page (model, effort, budget, code mode, compaction, Grants, limit, prompt preview) | Live: model switched. Test: settings-flow.test.ts | works |
| 77 | robot-x26m | Admin fleet list with live state | Live: admin view. Test: admin.test.ts | works |
| 78 | robot-1rap | Admin: providers, model lists, members, skills, Grants, costs | Live: admin view, model refresh. Test: admin.test.ts | works |
| 79 | robot-bvme | Admin routines across Robots | Test: admin.test.ts | works |
| 80 | robot-ifp6 | One Durable Object with SQLite per Robot | Tests: all worker tests run on DOs | works |
| 81 | robot-h3vr | Alchemy stack, one account | Live deploys; Test: stack.test.ts | works |
| 82 | robot-scwl | Workspace in R2 under robots/<id>/ | Test: workspace.test.ts | works |
| 83 | robot-c8hq | DSH Cordis packages assembled per Robot (session, llm, tools, ptc, fs, web, skill, compaction, credentials) | pnpm lint:deps; all Turn tests | works (schedule seam not used, ADR 0002) |
| 84 | robot-naul | Effect for the edge API, Workspace, vault, OAuth, push, catalogs and the composition scope | DO classes are plain async classes (ADR 0002) | partial (by decision) |
| 85 | robot-0eew | Browser Rendering binding | Staging test | works |
| 86 | robot-p9jm | Turns run in the DO regardless of the client | Test: robot-turn.test.ts (socket closed mid-Turn, eviction resume) | works |
| 87 | robot-d994 | Live model lists per connected Provider, metadata from models.dev | Live: 13 Claude + 20 Workers AI models from the Providers. Test: live-catalog.test.ts | works |
| 88 | robot-3f4i | Admin "Model lists" with fetched time, "Refresh models" | Live: refresh returned both lists | works |
| 89 | robot-mx6s | A new Robot gets a usable model; refused with a link to Providers when none; saving an unusable model is refused | Test: settings-flow.test.ts | works |
| 90 | robot-mktj | Row menu: Pin, Mark as unread, Edit profile, Hide from sidebar | Live: menu used. Test: list-and-routines.test.ts | works |
| 91 | robot-lulc | Edit profile sheet: avatar colour, name, title, description, notifications, routines | Live: sheet used. The "wake on screen notifications" toggle is not built: a Robot's browser exists only during a Turn | partial |
| 92 | robot-l3gr | Routine detail: words + cron with TZ, status, next run, instructions, recent runs | Live: Invoice check detail. Tests: list-and-routines.test.ts, panel.test.tsx | works |
| 93 | robot-qhll | Pause/Resume/Delete in routine detail | Live: paused and deleted Invoice check. Test: list-and-routines.test.ts | works |
| 94 | robot-3ioa | Ported DSH ui-trajectory: turn ledger, nested subtools, Duration/Turns/Calls strip | Live: Mr. Robot trajectory. Test: robot-trajectory.test.tsx | works |
| 95 | robot-cmz9 | DSH record inspector (input, output, usage, timing) | Live: inspector on run_code. Images are not shown: Robots store no image attachments | partial (no images) |
| 96 | robot-gq88 | DSH search; paging older events through /events?before | Test: robot-trajectory.test.tsx (paging). Search not tried on a long session | works |
| 97 | robot-s54i | Code-mode program with nested calls in the trajectory | Live and robot-trajectory.test.tsx | works |
| 98 | robot-gr94 | Collapsed "Used …" lines and "Using … now" while working | Live: "Used a code program, routine create". Tests: code-mode-chat.test.ts, routines.test.ts | works |
| 99 | robot-n7th | Failed Turn shows as blocked with a plain last line; reason and Try again in the chat | Test: list-and-routines.test.ts, settings-flow.test.ts | works |
| 100 | robot-g6y0 | Settings button, panel links (Trajectory, Advanced settings, screen/takeover), profile and admin in the sidebar | Live: every screen reached by clicking | works |
