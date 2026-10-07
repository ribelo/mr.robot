# Mr. Robot v1: story verification

Checked 2026-10-07 against the deployed app (mrrobot-edge-live-ribelo-ffe667mhzh4ttltx.r-krzywaznia-2c4.workers.dev), the worker and PWA test suites, and the staging Browser Rendering test (`pnpm --filter @mr-robot/worker test:integration`).

Grading rule: **works** needs a live check on the deployment or a test on the real path (real Durable Objects, real R2, real Browser Rendering, real provider). A story that depends on an outside system the tests fake (model, push service, OAuth, Git, browser) and that was not seen live is **partial (stub-only)**. **not done**: required work is missing.

"Live" means exercised on the deployment as the owner: by clicking, or through the app's API from the signed-in tab with a test Robot "Verifier" on Claude Sonnet 5.5 (2026-10-07 00:50–01:10).

Totals: 95 works, 5 partial, 0 not done.

## Partial or not done

- 5 robot-d2uv, partial (not tried live): home.test.ts, admin.test.ts, takeover.test.ts (real DOs); not tried live (one-person Home)
- 12 robot-bld3, partial (not tried live): lifecycle.test.ts (real DOs); not tried live (one-person Home)
- 64 robot-lzu3, partial (ChatGPT sign-in not tried live): Live: Claude connected and running. ChatGPT: adapter checked against the real service with the owner's DSH login; the sign-in in the PWA not tried
- 65 robot-7v9s, partial (DeepSeek not tried against the real service): Live: Workers AI (Turns on the deployment). Against the real services from this machine: OpenCode Go, and OpenRouter (2026-10-07, the adapter got a real tool call from openai/gpt-4o-mini). DeepSeek only against a faked API: no DeepSeek key exists here or in the Home
- 70 robot-ajrp, partial (not tried on a phone): Manifest, service worker and icons served; not installed on a phone

## Broken until the review, fixed 2026-10-06/07

These were marked done but did not hold:
- No Turn could run on Claude, ChatGPT, OpenRouter or OpenCode Go (effort metadata used `label` instead of `name`); only Workers AI ran. Now: real-adapters.test.ts and live Claude Turns.
- The model list was typed in; now each Provider's live list (63, 87–89).
- A Robot could be created on a model without a credential and fail its first Turn (89).
- The PWA crashed on load after an update (hook order); now covered by app.test.tsx.
- In code mode, the default, routine cards, reactions and Grant questions did not appear in the chat (10, 23, 31).
- Rewinding to before a Turn left that Turn's message in the inbox, so it was delivered again (20).
- web_search needed a DeepSeek key; now works without one (48).
- Switching a Robot to Claude after Workers AI tool calls failed every Turn (tool id format); DSH's skill catalog showed as a chat bubble.
- After a deploy a pending takeover lost its browser; messages during a takeover started Turns.
- Compaction never completed at small budgets (checkpoint cap 400 tokens).
- Robots never saw their screenshots (the tool returned a file path); the CAPTCHA advice to read an image puzzle from a screenshot could not work.
- The spend-limit notice printed $0.0105 of $0.0001 as "0.01 of 0.00"; now shows the digits.

## End-to-end check after the last deploy (2026-10-07 03:20–03:45)

Done as the owner would, on the live app: created "Plant Keeper" from "New robot" (brief: water the plants); interview on Workers AI gpt-oss-120b; approved its Grants; switched to Claude Sonnet 5.5, which created the Sunday 10:00 schedule; switched back to Workers AI, which listed it; opened the routine detail (schedule, cron with time zone, next run, instructions) and the trajectory by clicking; rewound the last Turn from the Rewind sheet. Then deleted the Robot (archive kept). Bugs found and fixed during the run:
- Workers AI refused every Turn after a tool call (assistant content null; it needs "").
- gpt-oss-120b writes programs as "async()=>{...}", which only defined a function; such programs now run.
- A new Robot started on the first Workers AI model even when the person had connected Claude; it now prefers a Provider they connected.

Suites on that build: worker 124, web 11, infra 1, dependency lint, and the staging Browser Rendering test (13 checks) all pass.

## All stories

| # | Story | Implemented | Verified | Status |
|---|---|---|---|---|
| 1 | robot-7v5x | Cloudflare Access (e-mail PIN) in front of the Worker; the Worker verifies the Access JWT | Live: signed in with an e-mail code, /api/me returned the Member | works |
| 2 | robot-q7rj | Home DO with Members and the Robot registry | Live: one Member (owner). A second Member only in home.test.ts (real DOs) | works (second Member not tried live) |
| 3 | robot-vplt | Secrets sealed in the Member DO, Home-shared ones in the Home DO | Live: secret "verifier-pin" stored and read by a Robot; sharing with another Member only in secrets.test.ts | works (sharing not tried live) |
| 4 | robot-dic7 | Provider credentials per Member with "shared with the Home" | Live: Claude subscription connected and used. Sharing to another Member: providers.test.ts only | works (sharing not tried live) |
| 5 | robot-d2uv | Admin invite/remove; removal pauses their Robots and closes their views | home.test.ts, admin.test.ts, takeover.test.ts (real DOs); not tried live (one-person Home) | partial (not tried live) |
| 6 | robot-mn09 | Empty Home except each Member's Mr. Robot | Live: first sign-in showed only Mr. Robot | works |
| 7 | robot-1xbe | Mr. Robot bootstrapped on first sign-in | Live | works |
| 8 | robot-btct | "New robot" form; setup interview; the Robot names itself and writes its persona | Live: Flat Watcher and Verifier interviews on Claude | works |
| 9 | robot-cobv | One Grant summary at the end of setup; compare-and-swap approval | Live: approved twice, Robots became active with exactly the proposed Grants | works |
| 10 | robot-vy9z | propose_grants as a question, also from code mode | Live: Verifier proposed the skills group mid-conversation; rejecting it was delivered as "Rejected" and the Robot acknowledged | works |
| 11 | robot-hpj1 | Robots private by default | lifecycle.test.ts (real DOs) | works |
| 12 | robot-bld3 | "Shared with the Home" in advanced settings | lifecycle.test.ts (real DOs); not tried live (one-person Home) | partial (not tried live) |
| 13 | robot-qo06 | Pause/Resume/Delete | Live: paused and resumed Verifier; a message sent while paused waited and ran on resume. Delete: lifecycle.test.ts | works |
| 14 | robot-hk2s | Mr. Robot tools robot_create, robot_configure, messaging | Live: Mr. Robot created a gym-tracking Robot with robot_create (it started its interview; its recipient Grant was added) and answered a robot message with robot_reply | works |
| 15 | robot-70kf | Mr. Robot's recipient Grants follow reachable Robots | Live: Mr. Robot listed in Verifier's directory after granting; sync in lifecycle.test.ts | works |
| 16 | robot-frf5 | One live DSH session per Robot; chat is its projection | Live: chat and trajectory of the same session | works |
| 17 | robot-q4b2 | Robot list with last line, time, unread; bubbles; routine cards; screen thumbnail | Live: all seen | works |
| 18 | robot-jlzk | Attachments stored in the Workspace and readable by the Robot | Live: invoice-77.txt uploaded, Verifier read amount and date on Claude | works |
| 19 | robot-h5v3 | DSH trajectory view | Live: Mr. Robot's trajectory with code program and nested call | works |
| 20 | robot-0q6a | Rewind to before a Turn | Live: Verifier rewound to before Test 6 and remembered only up to Test 5 (fixed tonight: the message used to come back) | works |
| 21 | robot-8v1t | Archive and Undo | Live: undo restored the conversation | works |
| 22 | robot-acr3 | Rewind note: external effects stand, tools used after the point | Live note injected; rewind.test.ts checks its text | works |
| 23 | robot-i3et | 👍 reaction for a plain instruction | Live: Verifier reacted 👍 to "From now on, write test reports in bullet points." | works |
| 24 | robot-9qnj | Robot messages with sender name and avatar | Live: Mr. Robot's chat shows "Verifier" with its avatar | works |
| 25 | robot-om9f | Muse files seeded in R2 | Live: Verifier listed and edited them | works |
| 26 | robot-h1nm | SOUL.md change noticed in the chat | Live: "Flat Watcher changed SOUL.md." | works |
| 27 | robot-mj7v | USER.md and PROACTIVE_PREFERENCES.md per person, read-only to Robots | Live: Verifier's edit of USER.md was refused | works |
| 28 | robot-jpzp | propose_member_file_edit question | Live: the USER.md proposal question appeared | works |
| 29 | robot-zzif | Compaction instruction | Live: Verifier at an 8k budget compacted with its instruction and still answered correctly (Flat 30 price). Two fixes found live: the checkpoint cap was 400 tokens so every summary was cut off; the checkpoint showed as a chat bubble | works |
| 30 | robot-sw54 | Context budget slider | Live: compaction triggered at the 8k budget on Workers AI | works |
| 31 | robot-yrw7 | A routine from chat | Live: "Invoice check" and "Live check" created on Claude, cards shown | works |
| 32 | robot-gbbt | DSH schedule records (after, at, every, daily, weekly, cron) in the owner's time zone | Live: daily, weekly and a one-shot through schedule_create; routines.test.ts | works |
| 33 | robot-qyd5 | Routines with next run in the panel | Live | works |
| 34 | robot-7j1a | Sleep between Turns; wake on routine, message, robot message, channel event | Live: message, robot-message and routine wakes (one-shot "Fire check" fired at 01:10 and replied "routine fired") | works |
| 35 | robot-v1gb | Missed occurrences run once | routines.test.ts (real DO alarm) | works |
| 36 | robot-makt | One Turn at a time, queue | robot-turn.test.ts (real DO); live: Verifier's request and Mr. Robot's reply queued and ran in order | works |
| 37 | robot-l9te | browser_* tools | Live: Verifier opened example.com and took a screenshot on Claude; staging test on real Browser Rendering | works |
| 38 | robot-t0vc | Cookies and storage kept between sessions | Staging test (real Browser Rendering) | works |
| 39 | robot-ksvy | Live view of the Robot's screen in the PWA | Live: the waiting browser streamed example.com to the PWA takeover screen (fixed live: after a deploy the DO lost the browser; it now reattaches) | works |
| 40 | robot-g6qb | Takeover input | Live: Take over, tapped a link in the streamed page, the real browser navigated to iana.org | works |
| 41 | robot-doqx | Takeover request suspends the Robot and pushes "needs you" | Live: takeover request suspended Verifier; a message sent meanwhile now waits for the hand-back (fixed live: it used to start a Turn). "Needs you" push: push.test.ts; push itself proven live (71) | works |
| 42 | robot-j4ll | Hand back resumes with URL and screenshot | Live: Hand back woke Verifier, which reported the new URL iana.org/help/example-domains | works |
| 43 | robot-ueh0 | Prompt rule plus a guard: a click on a pay/order button (English and Polish), or on "Finish"/"Confirm" on a checkout page, is refused with a pointer to a takeover | Live on saucedemo.com: Verifier logged in, filled the cart and checkout, was refused at "Finish" and asked for a takeover. browser.test.ts. Also found: a hung click stalled the Turn; browser actions now fail after 30 s | works |
| 44 | robot-b49q | CAPTCHA vendor detection with guidance | Live: Verifier on DuckDuckGo's bot check named it a CAPTCHA and stopped; the staging test checks that a real site's own bot check is reported (DuckDuckGo, 2026-10-07) | works |
| 45 | robot-5ewr | Code mode default, Worker Loader isolate | Live: every Verifier and Mr. Robot Turn ran as code programs on Claude | works |
| 46 | robot-ax7s | Direct tool calls switch | Live: with code mode off Verifier called routine_list directly | works |
| 47 | robot-8pqy | DSH tool-fs over R2, glob, grep, delete | Live: write, read, glob in Verifier's Workspace | works |
| 48 | robot-o6lf | web_fetch; web_search via DeepSeek with a key, else Bing in Browser Rendering | Live: Verifier's search returned otodom.pl results without any search key | works |
| 49 | robot-0bde | secret_get for granted names only | Live: granted secret read; ungranted refusal in secrets.test.ts | works |
| 50 | robot-4zi6 | Secrets redacted before storage and masked | Live: the PIN appears nowhere in Verifier's stored events or trajectory, only [secret:verifier-pin] | works |
| 51 | robot-f9ln | Only granted tools and skills | Live: Verifier's prompt preview lists exactly its granted tools | works |
| 52 | robot-0ms7 | No shell or container tool | Live prompt preview; pnpm lint:deps | works |
| 53 | robot-7qpi | Home skill library | Live: library synced from github.com/anthropics/skills (19 skills) | works |
| 54 | robot-qjvu | Git sync (GitHub tarball) | Live: real GitHub tarball sync | works |
| 55 | robot-lszy | propose_skill | Live: Verifier proposed "test-report" | works |
| 56 | robot-jqfw | Skill proposal approval publishes | Live: approving published it to the Home library | works |
| 57 | robot-icrv | Per-robot skill Grants | Live: Verifier granted only internal-comms saw and loaded only that skill | works |
| 58 | robot-bsvs | robot_directory | Live: Verifier listed Mr. Robot | works |
| 59 | robot-mv15 | robot_send / robot_reply through the outbox | Live: request and "pong" reply round trip | works |
| 60 | robot-ppzu | Incoming robot message labelled | Live | works |
| 61 | robot-bjq5 | Recipients only by Grant | Live: Verifier could message Mr. Robot only after the Grant; refusal in messaging.test.ts | works |
| 62 | robot-eiin | No helper creation; only Mr. Robot creates top-level Robots | Live prompt preview: no create tool for Verifier | works |
| 63 | robot-82r5 | One model and effort per Robot from live lists | Live: Mr. Robot and Verifier on Claude Sonnet 5.5 | works |
| 64 | robot-lzu3 | ChatGPT device flow, Claude paste flow | Live: Claude connected and running. ChatGPT: adapter checked against the real service with the owner's DSH login; the sign-in in the PWA not tried | partial (ChatGPT sign-in not tried live) |
| 65 | robot-7v9s | DeepSeek, OpenRouter, Workers AI, OpenCode Go | Live: Workers AI (Turns on the deployment). Against the real services from this machine: OpenCode Go, and OpenRouter (2026-10-07, the adapter got a real tool call from openai/gpt-4o-mini). DeepSeek only against a faked API: no DeepSeek key exists here or in the Home | partial (DeepSeek not tried against the real service) |
| 66 | robot-6nkv | Home default model | settings-flow.test.ts (real DOs); not changed live | works |
| 67 | robot-6jqh | Token meter per Robot and Member | Live: Verifier's tokens grew from 330,767 to 345,032 input across a Turn; cost 0 on the subscription | works |
| 68 | robot-8gag | Monthly limits | Live: Verifier on Workers AI with a $0.0001 limit blocked after one Turn with a notice | works |
| 69 | robot-40nw | Block and notify at the limit | Live: blocked state, a message sent while blocked waited, and ran after the limit was raised | works |
| 70 | robot-ajrp | Installable PWA | Manifest, service worker and icons served; not installed on a phone | partial (not tried on a phone) |
| 71 | robot-9xoj | Web Push | Live: a real Chrome subscription (FCM) registered on the deployment received "Verifier: Done." when a Turn finished | works (Chrome desktop; not on a phone) |
| 72 | robot-r2uz | Per-robot notifications switch | Live: with notifications off for Verifier a finished Turn sent no push | works |
| 73 | robot-bden | Quiet hours; PROACTIVE_PREFERENCES.md in every prompt | Live: quiet hours until 02:00 held a push from 01:56 and delivered it at 02:00:00 | works |
| 74 | robot-vfqd | Channel seam with PWA adapter | channels.test.ts contract suite; the PWA is the only Channel | works |
| 75 | robot-z3ud | Panel and profile sheet | Live | works |
| 76 | robot-vqtw | Advanced settings incl. prompt preview | Live: model changed, prompt preview read | works |
| 77 | robot-x26m | Admin fleet with live state | Live admin view | works |
| 78 | robot-1rap | Admin: providers, model lists, members, skills, Grants, costs | Live admin view and model refresh | works |
| 79 | robot-bvme | Admin routines across Robots | admin.test.ts; live list showed the routines | works |
| 80 | robot-ifp6 | One DO with SQLite per Robot | Live and all worker tests | works |
| 81 | robot-h3vr | Alchemy stack, one account | Live deploys | works |
| 82 | robot-scwl | Workspace in R2 under robots/<id>/ | Live file tools | works |
| 83 | robot-c8hq | DSH Cordis packages per Robot, including DSH schedule ported onto the Robot's alarm (agent/schedule.ts): DSH's schedule_* tools, records and recurrence | pnpm lint:deps; live: Verifier made a one-shot with schedule_create and the alarm delivered it ("seam fired"); a Routine stored before the port converted in place | works |
| 84 | robot-naul | Effect programs over services in all three Durable Objects (Member, Home, and the Robot's state, views, creation, alarm, browser tools); the DO classes adapt RPC and the alarm; typed failures mapped at the edge. Plain code only at the boundaries: the Turn driver into DSH's agent loop, WebSockets, the CDP driver | Worker suite 129, web 11, infra 1, staging 13 on the converted build; live smoke after deploy (list, admin, create with interview, panel, events, delete) | works |
| 85 | robot-0eew | Browser Rendering binding | Live and staging | works |
| 86 | robot-p9jm | Turns survive the client going away | robot-turn.test.ts (real DO, socket closed mid-Turn); live: tab hung during a Turn, the Turn finished server-side | works |
| 87 | robot-d994 | Live model lists per connected Provider | Live: 13 Claude + 20 Workers AI models from the Providers | works |
| 88 | robot-3f4i | Admin refresh with fetched time | Live | works |
| 89 | robot-mx6s | Never created on a model without a credential; refuse unusable model | settings-flow.test.ts (real DOs, faked OpenRouter list); live: the model list offers only connected Providers | works |
| 90 | robot-mktj | Row menu: Pin, Mark as unread, Edit profile, Hide from sidebar | Live | works |
| 91 | robot-lulc | Edit profile sheet incl. "Wake on screen notifications" | Live end to end: with the switch on, Verifier left a page open that showed a notification 90 s later; the minute check woke it with "Notification on screen: Order 1042: Out for delivery". Three bugs found and fixed on the way (a check before the notification lost it; pages opened after reattaching were not watched; tabs). Staging covers both cases | works |
| 92 | robot-l3gr | Routine detail with cron + TZ, runs | Live | works |
| 93 | robot-qhll | Pause/Resume/Delete routine | Live | works |
| 94 | robot-3ioa | DSH trajectory ledger and strip | Live | works |
| 95 | robot-cmz9 | DSH record inspector; browser screenshots are DSH image attachments served from the Workspace, shown as thumbnails and sent to Claude and ChatGPT as images (other providers get a text placeholder) | Live: a Robot on Claude described the Cloudflare homepage from its screenshot (orange logo, cookie banner); the inspector showed the image. Tests: browser.test.ts, provider-images.test.ts | works |
| 96 | robot-gq88 | Search and paging | Live: searching "pong" in Mr. Robot's trajectory narrowed it to the Turn with Verifier's message and highlighted it in the strip; paging in robot-trajectory.test.tsx | works |
| 97 | robot-s54i | Code program with nested calls | Live | works |
| 98 | robot-gr94 | Collapsed tool activity and "Using … now" | Live: "Used a code program, routine create" lines | works |
| 99 | robot-n7th | Failure as blocked state with plain line and Try again | list-and-routines.test.ts, settings-flow.test.ts (real DOs); the earlier live failure now shows the plain line | works |
| 100 | robot-g6y0 | Every screen reachable by clicking | Live: all screens reached from the list, header, panel, sidebar | works |
