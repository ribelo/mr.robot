---
title: "Mr. Robot v1 — self-hosted robots on Cloudflare"
status: ready-for-agent
story-prefix: robot
---

# Mr. Robot v1

## Problem Statement

The owner wants small recurring chores — shopping on Allegro, issuing invoices, watching appointments, the things one forgets — done by agents that run without his computer, never argue about "product policy", and are reachable from his phone. Hosted products (Grok Bot, Muse) refuse instructions on policy grounds, allow no model choice, and cannot use his own subscriptions. His desktop DeepSeek Harness has the right building blocks (Cordis plugins, sessions, schedule, browser-use, PTC) but lives on a machine that sleeps.

## Solution

Mr. Robot: a self-hosted platform on Cloudflare where each **robot** is a persistent worker with one endless conversation, its own persona and memory files (Muse layout), its own routines, a headless browser the owner can watch and take over from the phone, and only the tools, skills and recipients the owner granted. The agent inside each robot is assembled from DeepSeek Harness (Cordis) packages; everything around it — Durable Objects, R2, Browser Rendering, scheduling, providers, API — is written in Effect v4 and deployed with Alchemy. The UI is a React PWA that looks like the Grok Bot screens: a simple chat per robot, a robot panel, a trajectory view, and an admin view.

The application starts empty; each person gets a personal chief robot, **Mr. Robot**, which can create and coordinate the others.

## User Stories

### Access and Home

1. As a person, I want to sign in with a one-time e-mail code through Cloudflare Access, so that I never manage a password for Mr. Robot itself ^robot-7v5x
2. As a person, I want to belong to a Home with other members, so that my partner and I use one deployment with separate private robots ^robot-q7rj
3. As a Home member, I want secrets (site passwords) to be mine by default and shareable with the Home, so that a shared utility login is entered once for everybody ^robot-vplt
4. As a Home member, I want model subscriptions and API keys to be mine by default and shareable with the Home, so that members without subscriptions can run robots on mine ^robot-dic7
5. As a Home admin, I want to invite and remove members, so that the Home stays under my control ^robot-d2uv

### Robots and their lifecycle

6. As a person, I want the application to start with no robots, so that every robot exists because someone asked for it ^robot-mn09
7. As a person, I want a personal chief robot named Mr. Robot created on first sign-in, so that I have one place to start from ^robot-1xbe
8. As a person, I want to create a robot by opening a new conversation in which the robot defines itself, so that I never fill in a form ^robot-btct
9. As a person, I want to approve only the robot's grants (tools, skills, recipients) in one summary at the end of its setup, so that the persona and documents are the robot's own business ^robot-cobv
10. As a robot, I want to propose additional grants later as a question the owner answers, so that I can grow my reach without taking it ^robot-vy9z
11. As a person, I want a robot that is private to me by default, so that a robot watching my medical appointments is not visible to the Home ^robot-hpj1
12. As a person, I want to share a robot with the Home, so that another member can talk to it and use it ^robot-bld3
13. As a person, I want to pause, resume and delete a robot, so that a misbehaving robot stops without deleting its history ^robot-qo06
14. As a person, I want Mr. Robot to be able to create, configure and message other robots on my behalf, so that I can delegate by talking to one robot ^robot-hk2s
15. As a person, I want Mr. Robot granted to every robot I can reach (mine and shared), so that it can coordinate them without extra approvals ^robot-70kf

### Conversation and session

16. As a person, I want one endless conversation per robot that is also its full session log, so that there are no separate sessions to manage ^robot-frf5
17. As a person, I want the simple chat view to look like the reference screens: robot list with last line and time, bubbles, routine cards, screen thumbnail, so that daily use is calm ^robot-q4b2
18. As a person, I want to send text and attach files in the chat, so that a robot can work on a document I give it ^robot-jlzk
19. As a person, I want to switch the same conversation to a trajectory view showing every turn, tool call, result and executed code, so that I can see what the robot actually did ^robot-h5v3
20. As a person, I want to rewind the conversation to an earlier point, so that a message I regret stops shaping the robot ^robot-0q6a
21. As a person, I want a rewind to be reversible and to keep the old log in the robot's archive, so that nothing is lost by accident ^robot-8v1t
22. As a robot, I want to know after a rewind that external effects (sent messages, cart contents) did not revert, so that I do not repeat or contradict them ^robot-acr3
23. As a person, I want a robot to react with a tick to a message it took as an instruction, so that short acknowledgements do not clutter the chat ^robot-i3et
24. As a person, I want messages from other robots shown with the sender's avatar and name inside the conversation, so that I see who said what ^robot-9qnj

### Robot persona, memory and documents

25. As a robot, I want SOUL.md, IDENTITY.md, AGENTS.md, TOOLS.md and MEMORY.md plus daily notes in my workspace, copied from the Muse layout, so that my persona and memory are files I own and edit ^robot-om9f
26. As a robot, I want to tell the owner when I change SOUL.md, so that they know who I am becoming ^robot-h1nm
27. As a person, I want USER.md and PROACTIVE_PREFERENCES.md kept per person and mounted read-only into each of my robots, so that every robot knows me and my notification wishes ^robot-mj7v
28. As a robot, I want to propose edits to USER.md and PROACTIVE_PREFERENCES.md, so that what I learn about the owner is not lost ^robot-jpzp
29. As a person, I want a per-robot compaction instruction, so that a robot keeps what matters for its job when its context is compacted ^robot-zzif
30. As a person, I want a per-robot context budget (from small to the model's maximum), so that a trivial robot stays cheap and a serious one keeps a long memory ^robot-sw54

### Routines and waking

31. As a person, I want a robot to create a routine when I say 'run this every week', so that scheduling is a sentence, not a form ^robot-yrw7
32. As a robot, I want to create, update and delete my own routines (one-shot, interval, daily, weekly, cron) in the owner's time zone, so that I can watch things over time ^robot-gbbt
33. As a person, I want routines listed in the robot panel with their next run, so that I can see and delete them ^robot-qyd5
34. As a person, I want a robot to sleep between turns and wake only for a routine, a message, a robot message or a channel event, so that an idle robot costs nothing ^robot-7j1a
35. As a person, I want a missed routine occurrence after downtime to run once, not once per missed slot, so that a robot does not catch up by spamming ^robot-v1gb
36. As a robot, I want at most one turn at a time with later wake-ups queued, so that routines and messages never interleave in my log ^robot-makt

### Browser

37. As a robot, I want to open pages, observe them, act (click, type, scroll, select) and take screenshots in a headless browser, so that I can use any website on the owner's behalf ^robot-l9te
38. As a robot, I want cookies and local storage kept per robot across wake-ups, so that I stay logged in ^robot-t0vc
39. As a person, I want a live view of the robot's browser in the panel, so that I can watch what it is doing ^robot-ksvy
40. As a person, I want to take over the robot's browser from my phone (see the screen, tap, type), so that I can log in or pass a 2FA step for it ^robot-g6qb
41. As a robot, I want to pause and ask the owner for a takeover when a page needs them, so that I do not guess at credentials or codes ^robot-doqx
42. As a robot, I want to resume after the owner hands the browser back, so that one login unblocks the rest of the job ^robot-j4ll
43. As a person, I want a robot to fill a cart or prepare an order and stop before payment, so that paying stays mine ^robot-ueh0
44. As a robot, I want to solve ordinary CAPTCHAs myself, so that routine sites do not need the owner ^robot-b49q

### Tools, code mode and workspace

45. As a robot, I want to work in code mode by default: write a program that calls my tools, so that multi-step work costs one turn ^robot-5ewr
46. As a person, I want a per-robot switch between code mode and direct tool calls, so that I can choose per robot ^robot-ax7s
47. As a robot, I want file tools (read, write, edit, glob, grep) over my own workspace, so that I can keep notes and artefacts ^robot-8pqy
48. As a robot, I want web fetch and web search, so that I can read the web without a browser when that is enough ^robot-o6lf
49. As a robot, I want secret.get(name) for the secrets granted to me, so that I can log in to sites without the owner typing ^robot-0bde
50. As a person, I want secret values masked in the trajectory and in robot messages, so that a password never shows in a log ^robot-4zi6
51. As a person, I want every tool and skill to be off for a robot until granted, so that a robot can do only what it was given ^robot-f9ln
52. As a person, I want no shell and no container in the first version, so that the surface stays small ^robot-0ms7

### Skills

53. As a Home admin, I want one skill library per Home, so that skills live in one place ^robot-7qpi
54. As a Home admin, I want the library synchronised from my skills Git repository, so that the robots use the same skills as my desktop harness ^robot-qjvu
55. As a robot, I want to write a new skill and propose it to the library, so that what I learn can be reused ^robot-lszy
56. As a person, I want to approve a robot-proposed skill before it enters the library, so that the library stays curated ^robot-jqfw
57. As a person, I want to grant skills to a robot one by one, so that not every robot knows everything ^robot-icrv

### Robot-to-robot messaging

58. As a robot, I want a directory of the robots I may message (name, description, availability), so that I know whom to ask ^robot-bsvs
59. As a robot, I want to send a work request to a granted recipient robot and receive its reply in my conversation, so that robots cooperate ^robot-mv15
60. As a robot, I want an incoming robot message to arrive as a clearly labelled message in my conversation, so that I can tell robots from people ^robot-ppzu
61. As a person, I want recipient grants approved by me, so that robots do not form their own networks ^robot-bjq5
62. As a person, I want no sub-robots: a robot cannot spawn helpers, only message granted peers, so that every actor is one I created ^robot-eiin

### Models and cost

63. As a person, I want to choose one model and thinking effort per robot, so that each robot runs on what fits its job ^robot-82r5
64. As a Home admin, I want to connect an OpenAI subscription and an Anthropic subscription by OAuth, so that robots run on my existing plans ^robot-lzu3
65. As a Home admin, I want to add DeepSeek, OpenRouter and Workers AI as providers, so that any model is available ^robot-7v9s
66. As a Home admin, I want a default model for new robots, so that creation needs no model decision ^robot-6nkv
67. As a person, I want token usage and cost per robot and per person, so that I know what each robot costs ^robot-6jqh
68. As a person, I want a monthly spend limit per robot and per person, so that a looping routine cannot drain a subscription ^robot-8gag
69. As a robot, I want to stop and tell the owner when I hit my limit, so that the owner raises it knowingly ^robot-40nw

### Notifications and channels

70. As a person, I want to install the web app on my phone as a PWA, so that I have an icon and full screen ^robot-ajrp
71. As a person, I want Web Push notifications when a robot finishes, needs me or is blocked, so that I hear about it while away ^robot-9xoj
72. As a person, I want per-robot notification on/off in its settings, so that noisy robots stay quiet ^robot-r2uz
73. As a person, I want robots to honour my quiet hours and preferences from PROACTIVE_PREFERENCES.md, so that I am not woken at night ^robot-bden
74. As a person, I want channels designed as a seam so that Discord can be added as an input/output to the same conversation, so that the next channel is an adapter, not a rewrite ^robot-vfqd

### Robot panel and admin

75. As a person, I want a robot panel with screen thumbnail, routines and simple settings (name, title, description, avatar, notifications), so that everyday adjustments are one tap away ^robot-z3ud
76. As a person, I want an advanced settings page per robot (model, effort, context budget, code mode, compaction instruction, tools, skills, recipients, secrets, spend limit), so that I can change what the robot was given ^robot-vqtw
77. As a Home admin, I want an admin view with all robots and their state (sleeping, working, waiting for me, paused, blocked), so that I see the whole fleet ^robot-x26m
78. As a Home admin, I want an admin view with providers, subscriptions, members, skills, grants and costs, so that administration is in one place ^robot-1rap
79. As a Home admin, I want all routines across robots in one list, so that I can see what wakes at night ^robot-bvme

### Platform

80. As an operator, I want every robot to run in its own Durable Object with its own SQLite, so that robots are isolated and hibernate independently ^robot-ifp6
81. As an operator, I want the whole system deployed with Alchemy to one Cloudflare account, so that infrastructure is code in the same repository ^robot-h3vr
82. As an operator, I want robot files in R2, so that workspaces survive everything ^robot-scwl
83. As an operator, I want the agent assembled from DeepSeek Harness Cordis packages, so that plugins and skills stay shareable with the desktop harness ^robot-c8hq
84. As an operator, I want the Cloudflare machinery written in Effect, so that infrastructure code is typed, testable and resource-safe ^robot-naul
85. As an operator, I want the browser provided by Cloudflare Browser Rendering, so that no machine of mine is involved ^robot-0eew
86. As an operator, I want a robot's turn to survive the client closing the tab, so that the phone can go to sleep ^robot-p9jm

## Implementation Decisions

### Vocabulary
See GLOSSARY.md. The words used below: Home, Member, Robot, Mr. Robot, Conversation, Trajectory, Turn, Wake-up, Routine, Grant, Grant proposal, Workspace, Persona files, Takeover, Channel, Provider, Spend limit.

### Topology on Cloudflare
- One **Robot Durable Object** per robot (name = robot id). Its SQLite holds: the DSH session event log, robot configuration and grants, routines and their receipts, browser session state (cookies, storage), usage counters, the archive of rewound logs. The DO owns the agent loop for its robot and hibernates between turns.
- One **Member Durable Object** per person: their robots list, private secrets, private provider credentials and subscriptions, push subscriptions, USER.md and PROACTIVE_PREFERENCES.md.
- One **Home Durable Object** per Home: members, Home-shared secrets and subscriptions, the skill library index, admin settings (default model, default spend limits).
- One **edge Worker**: Cloudflare Access verification, the HTTP/WebSocket API, static PWA assets, Web Push sending. It routes every call to the owning DO; it holds no state.
- **R2** for robot workspaces (one prefix per robot), the Home skill library, uploaded attachments.
- **Workers Secrets** hold only deploy-level secrets (the data-encryption key, VAPID keys, provider OAuth client ids). User-level secrets live in DO SQLite, encrypted with the deploy key. Plain text inside the Cloudflare boundary is accepted.
- Infrastructure is declared in Alchemy in this repository; every resource above is a declared resource.

### Waking robots
- The DSH schedule plugin is ported to **DO Alarms**: the Robot DO keeps its routine table in SQLite and sets the single DO alarm to the earliest next occurrence. The alarm handler records the occurrence, runs one turn, and re-arms. There is no long-lived process and no Cron Trigger per robot.
- Wake-up kinds: owner message, routine occurrence, robot message (request or reply), channel event, takeover returned. No heartbeat: an observation a robot wants to keep is a routine it creates.
- Admission: one active turn per robot; other wake-ups queue in order. A missed routine occurrence after downtime is consolidated into one run.
- Long turns: a turn is driven by the DO itself (not by the client request), so closing the PWA does not stop it. Turns are checkpointed in the session log after every tool result, so a DO eviction mid-turn resumes from the last event.

### The agent inside a robot
- Assembled from DSH Cordis packages: session + persistence, agent loop, system prompt, tools, llm, compaction, token meter, credentials, ptc-runtime (mode consumer), fs (seam), browser-use (seam), schedule (seam), web, skill, attachment. Node-bound implementations (fs-local, subprocess, shell, terminal, sandbox, session-persistence-jsonl) are not mounted.
- Mr. Robot provides its own Cordis plugins for the seams: session persistence over DO SQLite, fs over R2, browser-use over Browser Rendering, schedule over DO Alarms, credentials over the Member/Home DOs, PTC execution over an isolate (below), robot messaging tools, secret tool. Each such plugin is a thin Cordis adapter that calls an Effect service; Effect appears at the plugin boundary and nowhere inside the DSH packages. The Cordis root is owned by an Effect scope so plugin teardown follows the DO lifecycle.
- Each robot's configuration materialises as a **Cordis composition** built programmatically (the DSH "profile" idea without YAML files on disk): the set of plugins, the tool allow-list, model, effort, context budget and compaction instruction are derived from the robot's grants and settings when the DO boots the agent. Exporting that composition as a cordis.yml is possible for debugging but is not the source of truth.
- Code mode: PTC is the default; a per-robot switch selects direct tool calls instead. The PTC executor runs the model's program in an isolated JavaScript runtime with tools bound as RPC. Two candidates: Cloudflare Worker Loaders (dynamic isolates) and QuickJS compiled to Wasm (Wiser's choice). The first implementation ticket builds a throwaway prototype of both and picks one; the spec does not fix it.
- Rewind: DSH logs are append-only and never rewritten. A rewind creates a new session seeded from the event prefix up to the chosen point (DSH restored-session seed), makes it the robot's live session, and moves the previous log to the robot's archive with a rewind record. Undoing a rewind re-activates the archived log. The robot is told, in the seeded session, that external effects after the rewind point stand.
- Compaction uses the robot's own compaction instruction and context budget, both robot settings.

### Robot specification
Stored in the Robot DO, shown in the advanced settings page:
- Identity: name, title, description, avatar colour.
- Owner (Member), sharing: private | shared with Home (use and talk). "Use only, no influence" sharing is out of scope for v1 because a robot changes itself.
- Model + thinking effort; context budget; code mode on/off; compaction instruction.
- Grants: tools, skills, recipients (robot ids), secrets. Every item is off until granted.
- Notification settings: on/off, which members to notify, channel list.
- Spend limit (monthly), inherited from Home defaults unless overridden.
- Routines: owned and edited by the robot; the owner can delete.
Persona and memory are **not** fields: they are files in the workspace (SOUL.md, IDENTITY.md, AGENTS.md, TOOLS.md, MEMORY.md, memory/YYYY-MM-DD.md), seeded from the Muse templates and edited by the robot. USER.md and PROACTIVE_PREFERENCES.md belong to the Member and are mounted read-only into every robot of that member; a robot proposes edits as a question.

### Creation and grants
- "New robot" creates a Robot DO in setup state and opens its conversation; the setup interview is model-driven. The robot drafts its own persona files and proposes a grant set. Setup ends with **one summary** the owner approves; approval activates the robot. Only grants are approved; persona, documents and routines are not.
- Later grant changes: the robot creates a **grant proposal** (exact tool/skill/recipient/secret list with purpose); the owner answers; the stored proposal is applied, never prose. The owner may also change grants directly in advanced settings.
- Mr. Robot is created per Member on first sign-in, with recipient grants to every robot the Member can reach (own and Home-shared), kept in sync as robots are created or shared. It may create robots through the same creation flow; the owner still approves grants.

### Robot-to-robot messaging
- Directory tool lists robots the sender may message (recipient grant ∩ reachable), with name, description, availability. No histories or files are exposed.
- A request carries recipient, requested work, optional attachment handles, idempotency key; the platform binds sender and causal chain. The reply goes through a single-use reply handle and needs no reverse grant.
- Delivery is a durable outbox in the sender DO and an intake queue in the recipient DO; the message appears in the recipient conversation as a labelled robot message and starts an unattended turn. Limits: a chain cap and a per-robot queue cap.
- No sub-robots: the DSH subagent packages are not mounted.

### Browser
- Provider: Cloudflare Browser Rendering, one browser session per robot, kept alive while a turn needs it and closed afterwards; cookies and storage exported to the Robot DO on close and restored on open.
- Tools (port of Leash primitives to Effect): open, observe (accessibility/DOM summary), act (click, type, select, scroll, key), screenshot, wait. JEV decision models are a later spec.
- Live view: the panel subscribes to a CDP screencast relayed by the Robot DO over WebSocket; a thumbnail is the last screenshot.
- Takeover: the owner's device claims the tab; input events are forwarded; the robot's turn is suspended with a "waiting for takeover" state and a push notification; handing back resumes the turn with a note of what the owner did (URL and a screenshot after return).
- Payments and bank 2FA stay with the owner: the robot prepares (cart, order form) and stops; the owner finishes in their own app.

### Tools and workspace
- fs over R2: read, write, edit, glob, grep inside the robot's prefix. Attachments uploaded in the chat land in the workspace.
- web fetch and web search via the DSH web seam with HTTP providers.
- secret.get(name) resolves granted secrets from Member or Home scope; values are masked in the trajectory and in outgoing robot messages.
- No shell, no terminal, no container in v1.

### Skills
- One library per Home in R2. Sources: (1) a Git repository synchronised by the admin (the owner's desktop skill repository), (2) skills written by robots and proposed to the library, approved by a Member. Visibility per skill: Home or private to the author's owner.
- Skills are granted per robot; the DSH skill seam loads only granted skills into the robot's catalog.

### Providers, usage, limits
- Providers: OpenAI subscription (OAuth), Anthropic subscription (OAuth), DeepSeek API, OpenRouter, Workers AI. Credentials live in the Member DO and may be shared with the Home; the Home default model applies to new robots.
- The DSH token meter reports per turn; the Robot DO accumulates per robot, the Member DO per person. Monthly spend limits per robot and per person; crossing one puts the robot into "blocked: limit" and notifies the owner; raising the limit unblocks.

### Channels and notifications
- Channel is a seam: an adapter turns external events into wake-ups and robot output into outbound messages, always on the same conversation. v1 ships the PWA channel and Web Push. Discord is the first adapter after v1.
- Web Push: VAPID keys in Workers Secrets, subscriptions per Member device; events: finished, needs you (takeover, grant proposal, question), blocked (limit, failure).
- PROACTIVE_PREFERENCES.md is read by the robot before composing a notification; the platform also enforces quiet hours stored on the Member.

### Access and tenancy
- Cloudflare Access in front of the edge Worker; identity from verified Access claims; e-mail OTP so any address works. A Member is created on first sign-in and joins the Home named in the deployment configuration; the first Member is admin. A second Home is possible later; v1 deploys one.

### UI
- React PWA, rebuilt (not the DSH web shell), talking to the edge Worker over HTTP and WebSocket. Views: robot list; conversation (simple chat); conversation in trajectory mode with rewind; robot panel (screen, routines, simple settings); advanced settings; admin (fleet state, routines across robots, providers and subscriptions, members, skills, grants, usage and limits); takeover screen.
- Visual reference: the six Grok Bot screenshots stored under docs/reference/ in this repository.

## Testing Decisions

A good test drives the system through a boundary a user or an operator sees and asserts on observable behaviour: what the conversation shows, what the DO stored, what the browser was told, what push was sent. No test asserts on plugin internals or on the shape of Cordis events.

Seams, highest first:
1. **Robot DO API** (the seam that matters): a test boots a Robot DO in a workers test runtime with a stub LLM provider and a stub browser provider, sends messages, fires alarms, and reads the conversation, routines, grants and workspace back. Covers: creation, approval and lifecycle (robot-mn09, robot-btct, robot-cobv, robot-vy9z, robot-qo06), conversation and rewind (robot-frf5, robot-q4b2, robot-jlzk, robot-h5v3, robot-0q6a, robot-8v1t, robot-acr3, robot-i3et, robot-9qnj), persona and documents (robot-om9f, robot-h1nm, robot-mj7v, robot-jpzp, robot-zzif, robot-sw54), routines and waking (robot-yrw7, robot-gbbt, robot-qyd5, robot-7j1a, robot-v1gb, robot-makt), tools, code mode and secrets (robot-5ewr, robot-ax7s, robot-8pqy, robot-o6lf, robot-0bde, robot-4zi6, robot-f9ln, robot-0ms7), skill granting (robot-icrv), messaging (robot-bsvs, robot-mv15, robot-ppzu, robot-bjq5, robot-eiin), model choice and limits (robot-82r5, robot-6jqh, robot-8gag, robot-40nw), robot isolation and turn survival (robot-ifp6, robot-p9jm).
2. **Edge Worker API**: Access claims, Members, Home, sharing, Mr. Robot bootstrap, providers, skill library, admin views and notifications: robot-7v5x, robot-q7rj, robot-vplt, robot-dic7, robot-d2uv, robot-1xbe, robot-hpj1, robot-bld3, robot-hk2s, robot-70kf, robot-7qpi, robot-qjvu, robot-lszy, robot-jqfw, robot-lzu3, robot-7v9s, robot-6nkv, robot-ajrp, robot-9xoj, robot-r2uz, robot-bden, robot-vfqd, robot-vqtw, robot-x26m, robot-1rap, robot-bvme.
3. **Browser provider** against a real Browser Rendering session in a staging deployment, marked as integration: open/observe/act/screenshot, cookie persistence, takeover handshake, CAPTCHA (robot-l9te, robot-t0vc, robot-ksvy, robot-g6qb, robot-doqx, robot-j4ll, robot-ueh0, robot-b49q, robot-0eew).
4. **PWA** component tests only for the conversation renderer, the robot panel and the trajectory/rewind controls (robot-q4b2, robot-h5v3, robot-0q6a, robot-z3ud); the rest is covered through the API.
5. **Infrastructure**: an Alchemy plan test asserting the declared resources (robot-h3vr, robot-scwl); robot-c8hq, robot-naul are architecture constraints checked by dependency lint (no Node-bound DSH package mounted; no Effect import inside the DSH packages), not by behaviour tests.

Prior art: DSH package tests that mount a Cordis context with a stub llm provider; Wiser's robot coordinator tests for the grant/approval compare-and-swap.

## Out of Scope

- Shell, terminal, containers (Cloudflare Containers / Sandbox SDK).
- JEV decision models for the browser.
- Discord and any channel other than PWA + Web Push (the seam is in scope; adapters are not).
- "Use-only" sharing of a robot (sharing without the ability to influence it).
- Heartbeat ticks.
- Groups (one conversation with several robots).
- Sub-robots / subagents.
- Native Android application; PWA only.
- Billing, multi-Home tenancy, per-Home isolation of deployments.
- Google Drive and other connectors as skills.

## Further Notes

- The owner's rules for this project: no time estimates, no feasibility caveats; decisions are reported, his to reverse.
- Reference material: Muse workspace templates (SOUL.md, IDENTITY.md, AGENTS.md, TOOLS.md, MEMORY.md, USER.md, PROACTIVE_PREFERENCES.md) from the public leak repository; Wiser's robot protocol (setup fields, grant proposals, directed messaging, outbox) as design precedent; dsh-cloud as proof that the DSH tree assembles inside a Worker with a DO SQLite session log; Leash for browser primitives and the takeover model.
- First implementation ticket: the PTC isolate prototype (Worker Loaders vs QuickJS-wasm) and a Robot DO that runs one turn against a stub LLM, persisting the DSH session log in SQLite.
