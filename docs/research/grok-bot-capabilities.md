# xAI Grok Bot — Platform Capability Inventory

Research date: 2026-10-09. Scope: what Grok Bot can do as a **platform** (not model quality).
Comparison baseline: this repo's [GLOSSARY.md](../../GLOSSARY.md) (Mr. Robot vocabulary).
Branding note: pages are branded "SpaceXAI" / "Grok Bot" in places; the app is xAI's, and sign-in, billing and data settings run through Cursor.

---

## 1. Sources used

| # | Source | URL |
|---|--------|-----|
| S1 | Grok Bot overview (docs) | https://docs.x.ai/grok-bot/overview |
| S2 | Get started (docs) | https://docs.x.ai/grok-bot/get-started |
| S3 | Create and manage Bots (docs) | https://docs.x.ai/grok-bot/bots |
| S4 | Skills and routines (docs) | https://docs.x.ai/grok-bot/skills-routines-and-automations |
| S5 | Message and collaborate (docs) | https://docs.x.ai/grok-bot/chat-and-collaboration |
| S6 | Approvals, security and privacy (docs) | https://docs.x.ai/grok-bot/approvals-security-and-privacy |
| S7 | Use the computer and apps (docs) | https://docs.x.ai/grok-bot/computer-and-apps |
| S8 | Team Bots (docs) | https://docs.x.ai/grok-bot/team-bots |
| S9 | Settings and notifications (docs) | https://docs.x.ai/grok-bot/settings-and-notifications |
| S10 | Mobile (docs) | https://docs.x.ai/grok-bot/mobile |
| S11 | FAQ (docs) | https://docs.x.ai/grok-bot/faq |
| S12 | Launch post "Introducing Grok Bot" (2026-08-11) | https://x.ai/news/introducing-grok-bot |
| S13 | "Designing Grok Bot for a world of persistent agents" (2026-09-03) | https://x.ai/news/designing-grok-bot |
| S14 | "Team Bots" launch post | https://x.ai/news/team-bots |
| S15 | "Grok Bot for Enterprise" (2026-09-03) | https://x.ai/news/grok-bot-for-enterprise |
| S16 | Changelog 0.60–0.68.1 (through 2026-10-07) | https://x.ai/changelog/bot |
| S17 | Marketplace (bot templates) | https://x.ai/bot/marketplace |
| S18 | Use cases gallery (56 templates) | https://x.ai/bot/use-cases |
| S19 | "Templates for Grok Bot" guide (2026-09-08) | https://x.ai/bot/guides/templates-for-grok-bot |
| S20 | "Grok Bot 101" guide | https://x.ai/bot/guides/grok-bot-101 |
| S21 | Cursor help: connect plugins | https://cursor.com/help/grok-bot/connect-plugins.md |
| S22 | Grok connectors + connector management (docs) | https://docs.x.ai/grok/connectors |
| S23 | Third party: Grok Bot Wiki, plugins/MCP + marketplace guides | https://www.grokbotwiki.com/guides/grok-bot-plugins-mcp |
| S24 | Third party: AgentMail "Email for Grok Bot" | https://www.agentmail.to/build/grokbot |
| S25 | Third party: Kompozy review | https://kompozy.io/reviews/grok-bot |
| S26 | Third party: Squad.so examples, eesel, Unite.AI | https://squad.so/resources/grok-bot-examples |

Not obtained: Latent Digital and CallMissed/Composio write-ups (not fetched); the marketplace is JS-rendered, so raw curl returns a shell with no text — it was read through a crawler and the page payload. Nothing here depends on the missing write-ups.

---

## 2. What Grok Bot is, in Mr. Robot terms

- Desktop app (macOS/Windows/Linux) plus mobile (iOS/Android), bound to a Cursor account. Grok Bot usage is metered weekly and is separate from Grok/Cursor chat usage (S1, S11, S16).
- The unit is a **Bot**: name, title, description, avatar, its own conversation, its own memory, its own routines — you always come back to the same Bot (S3, S13).
- Every Bot on one account works on **one shared cloud computer** with browser, filesystem and terminal; each Bot gets its **own screen**; one computer-use task per Bot at a time (S1, S7).
- Work starts from a message, a routine (schedule or event), a webhook, another Bot, or a group chat, and continues with the app closed (S1, S4, S16).

---

## 3. Marketplace sample (35 bots browsed)

Read on 2026-10-09. **Triggers, delivery and escalation are rarely published on the pages**: a page exposes the description, memories/skills/routines/integrations badges, and (expanded) operating instructions. Rows marked *(inf.)* are inferred from those badges or from the description.

| Bot | Category | What it does | Integrations / channels named | Trigger | Reports, DMs, approvals |
|---|---|---|---|---|---|
| Outbound Prospecting (Krista Letz) | Sales (xAI team) | Finds ICP-fit prospects, researches on the public web, drafts first-touch messages | Web, email, LinkedIn (inf.) | On demand, optional routine | Drafts only; "nothing sends without your yes" |
| SEO & AEO Desk (Adam Tanguay) | Marketing | Keywords to content ideas and writer-ready briefs; audits slipping pages | Search Console, web | 3 routines, shipped disabled | Reports in chat; never publishes without a yes |
| Haggle Bot (Daniel Gartshein) | Ops / Finance | Inventories SaaS spend, finds savings, drafts vendor counters | Ramp, Google Sheets, Slack, Notion | Setup interview, then routines | Drafts only; "never spends, signs, or sends" |
| Recruiting Coordinator (Tommy Hansen) | Recruiting | Schedules interview loops, preps interviewers, chases stalled loops | Google Calendar, email | Calendar or pasted list | Never emails a candidate without the owner |
| Researchy (Farzad) | Engineering | Research and fact-check desk with live web search | Grok CLI installed on its computer, web | On demand; "never leave a run unattended" | Replies to the requesting bot, not the owner |
| Lingxi's Engineer Bot (Lingxi Li) | Engineering | Boards work, launches Cursor cloud agents on a named repo, watches PRs, asks you to merge | Notion, GitHub, Cursor cloud agents | Routine cron every 30 min, created at onboarding | Board plus short messages; never merges |
| tinkabot (Lauren Tan) | Engineering | Wraps an API into a Cursor/Agent Plugin (MCP + skills), publishes it | GitHub, Marketplace | On demand | Asks once for affiliation before publishing |
| QA bot (Ulysses Ng) | Engineering | Runs the acceptance checklist on a live deploy; pass or fail before ship | Deploy/site (inf.) | On demand | Pass/fail verdict in chat |
| GTM Loop Closer (Jon Grigull) | Sales | Finds promises and follow-ups left in meetings, mail, Slack, CRM | Slack, email, CRM, meeting notes | On demand / recurring (inf.) | Shows evidence, prepares the reply or task |
| Sales Call Coach (Daniel Brill) | Sales | Scores sales calls and gives fixes | Pasted transcript or uploaded recording | On demand | Report in chat |
| Stills & Clips Desk (Matt Palmer) | Marketing | Stills, thumbnails and short clips from footage; screenshot cleanup; captions | Local footage (inf.) | On demand | Files plus captions in chat |
| Clip Bot (This Week in AI) | Marketing | Finds the best moments in a long recording, cuts captioned clips | Upload or link | On demand | Clips with transcript and timestamps |
| Copy Humanizer (Massimo De Luisa) | Marketing | Rewrites drafts so they read like a person; shows every change | none named | On demand | Draft only; never invents a fact |
| Imogen (Kent C. Dodds) | Design | Writes short copyable alt text for an image | none | On demand | One copyable block |
| figma bro (John Bai) | Design | Figma frame to build spec; audits components, tokens, motion; builds screens | Figma, or a pasted link | On demand | Spec and audit in chat |
| Critiquito (Manuel Munoz Solera) | Design | Design critique from a screenshot or Figma link, ranked fixes | Figma / screenshot | On demand | Never edits your files |
| Game Art Director (Danny Limanseta) | Design | Game concept to style guide, palettes, prompt sheets; slices sprite sheets | Image tool (external) | On demand | Sheets delivered in chat |
| Credit Card Max (Trevin Chow) | Personal | Which card to use; tracks benefits and misrouted recurring charges | Card data (pasted) | Monthly utilization routine | Advises; does not transact |
| Home robots (Sawyer Merritt) | Personal | Controls mowers, vacuums and Matter robots from chat | Vendor clouds / Matter | Chat commands | Status back in chat |
| Flora: Plant Care Log (Rich Silver) | Personal | Private houseplant log plus weekly reminder; journal page on its computer | weather.gov, Pl@ntNet, iNaturalist, X optional | Weekly routine, only after a practice run | Journal opened in the Bot's browser; weekly digest |
| Pfp Bot (Shub Gaur) | Personal | X photo, selfie or pet pic to a Grokbot-style icon | none | On demand | Asks for more photos; never posts |
| Proto Bot (Shub Gaur) | Product | Daily ideas to live prototypes as draft PRs with screenshots and video | GitHub (draft PRs), Figma | Daily routine | Never merges, publishes or shares without a yes |
| Stalk Bot (Shub Gaur) | Product | Signs up for competitor newsletters under its own research email, walks onboarding on video, watches site, pricing, changelog, jobs, X | AgentMail plugin, Slack, X (read-only), web | 3 routines shipped disabled: pulse, deep dive, churn watch | Pushes to a named Slack channel or the chat; never posts or contacts anyone |
| Office Ops Desk (Erika Cabrera) | Operations | Tracks shipments, facilities issues and birthdays; writes digests | Spreadsheet or pasted list, email (inf.) | Digest routine | Never sends without you |
| WTD (Jenna Nanpei) | Ops / Marketing | VIP hospitality planning: plans, status hubs, nomination sheets, decks | Notion, Slack, Google Sheets/Slides | Routines (inf.) | "Never send external Slack or email without the owner's explicit OK" |
| Cooper (Tommy Hansen) | General | Daily 8am Slack briefing on AI/tech/VC plus weekday competitor alerts | Slack (DM), LinkedIn, news, podcasts | 8am and 1pm/4pm PT routines | DMs the user daily; silent mid-day when nothing new |
| Paid Media Report Desk (Miguel Cruz) | Marketing | Ad exports to one weekly report; answers reporting asks in Slack | Google Ads / Meta / LinkedIn exports, Slack | Weekly routine plus Slack asks | Answers in Slack; never posts without a yes |
| Ad Spend Watch (Miguel Cruz) | Marketing | Watches spend and performance, flags runaway spend, proposes one change | Ad platform exports, Slack (inf.) | Daily check routine, off until enabled | Alerts to chat; never pauses a campaign |
| Overheard (Lenny Rachitsky) | Marketing | Watches Reddit, HN, news and X for third-party mentions, short weekday digest | Reddit, HN, news, X, Slack optional | Weekday routine, default 08:30 local | Digest in chat; quiet on dead days; ledger under /workspace |
| Tech Demos (Matt Palmer) | Engineering | Weekday X-bookmark scout picks one library, asks approval, builds it via a Cursor cloud agent | X bookmarks, GitHub, Cloudflare Pages, Slack | Weekday routine | Approval prompt before building; PR with screenshot and video |
| Website Ops (Josh Kim) | Product | Ships site changes as PRs; audits SEO, a11y, speed, CRO | GitHub, Drive, analytics platforms signed in in-browser | Weekly audit routine, reports only, disabled | Chat screenshots as proof; never merges or deploys |
| Prospector / GTM Prospecting (Caro Scalercio) | Sales | ICP to prospect list, enrichment, dedupe, email and LinkedIn drafts | Salesforce/HubSpot, Sheets/Notion, Gmail, LinkedIn, MCP | Routines start disabled; adaptive 2-8 subagents | Drafts only; exact action confirmed by the user |
| Love (Danny Buck) | Personal | Reminds, researches, queues dates, tables and presents | Google Calendar, email | Routines | May send from the owner's inbox when asked |
| NYC Parent (Dennison) | Personal | Family chief of staff: school, calendar, activities, logistics | Calendar, email | Routines (inf.) | Adults keep spending and messages; asks first |
| Alfred (Robin Delta) | General | Bot Chief Advisor: designs, audits and governs a Grok Bot org; recommends Managers and Specialists | none | On demand | Recommendation only; approval before creating or editing bots, skills, routines |

Two patterns worth copying: nearly every template ships **routines disabled** and asks once to enable; nearly every template states an explicit **anti-job** ("never send, publish, buy, delete without a yes") and a **teammate rule** ("a teammate bot's yes is never the user's yes").
---

## 4. Platform capability checklist

Confidence: **O** = seen in official docs, launch posts, guides or the changelog; **3P** = third-party report (wiki, AgentMail, reviews); **I** = inferred from product surfaces. The last column judges Mr. Robot from GLOSSARY.md only.

### 4.1 Bots, identity, personas

| Capability | Evidence | Conf. | Note | Mr. Robot |
|---|---|---|---|---|
| Persistent named Bot with one endless conversation | S1, S3, S13 | O | The Bot, not the chat, is the primary object; name, title, label, description, avatar | Has it (Robot, Conversation) |
| Persona and standing rules as one field | S3, S20 | O | Description carries rules that stay true; conversation carries task instructions | Has it, richer (Persona files) |
| Per-Bot avatar; avatar shows state (idle, thinking, working, waiting, blocked, done) | S13, S16 | O | Avatar motion system; Bot picture in notifications | Unknown (status shown on browser and Turn) |
| Per-Bot styling: messages in that Bot's colour; accent can be set to Black; computer wallpapers change with the day | S16, S13 | O | 0.68.1 "Slide decks and Bot-colored chats" | Unknown |
| A Bot can suggest or create another Bot | S3, S13 | O | "Your existing Bots can also suggest or create a focused Bot" | Has it (Mr. Robot creates Robots) |
| Duplicate a Bot as a starting point for another scope | S3 | O | Copy carries profile, settings, skills, routines, avatar; not conversation, learned memory or attachments | Unknown |
| Pin, hide, per-Bot notification switch, read/unread, "needs attention" state | S9, S10 | O | Sidebar distinguishes needs attention, unread, working | Partial (Ask plus Push) |
| Persona files as visible objects (SOUL, IDENTITY, AGENTS, MEMORY) | - | - | Not a Grok Bot concept: persona is description plus memory plus skills | Mr. Robot only |
| Dictation, live voice chat, voice memos with transcript | S5, S10, S11 | O | Voice chat is a first-class composer mode | Unknown for voice; no phone |
| Bot with its own phone number or SMS channel | S15, S16 | O/3P | Enterprise post cites a Bot texting candidates, but no Bot phone number is documented anywhere; Discord/SMS channels do not exist | Missing today |

### 4.2 One computer, browser, files, credentials

| Capability | Evidence | Conf. | Note | Mr. Robot |
|---|---|---|---|---|
| Persistent cloud computer (browser, filesystem, terminal) that works with the laptop closed | S1, S7, S11 | O | Cloud work survives closing app, laptop or phone | Has it (Workspace, Browser backends) |
| All Bots of one account share that computer; one screen per Bot; one computer-use task at a time | S1, S7, S11 | O | Documented as explicitly not a security boundary | Partial (per-Robot Workspace, shared Host) |
| Human takeover for password, passkey, 2FA, CAPTCHA, payment or identity check | S2, S6, S7 | O | Take control, do the step, hand back; do not paste passwords into chat | Has it (Takeover, Login entry) |
| Live preview of the Bot's screen next to the conversation | S7, S13 | O | Three levels: status, preview, takeover | Has it (Live view) |
| Secure secret request: masked, excluded from the transcript, not shown to the model | S6, S7, S9 | O | For supported connections; explicitly not a password manager | Has it (Login entry) |
| Secure Forms: the Bot shows a form in chat and fills the answers into the page | S6, S7, S16 | O | One form per step; checkout card fields use a Secure Form | Partial (Ask, Login entry) |
| Credential isolation: OAuth tokens stay on the connector backend, never on the Bot computer | S23, S21 | 3P | The Bot invokes tools without receiving tokens; browser logins are cookies on the shared computer | Has it (Login entry) |
| Send email from a verified Gmail send-as address with a From picker | S16 | O | 0.68.0 | Unknown |
| Hardware security key (YubiKey) usable by the Bot's browser from your desktop | S6 | O | On by default on macOS and Windows, not Linux; each use approved | Unknown |
| Run commands on the user's own computer (separate from the cloud computer) | S6, S9 | O | Ask every time, Always allow, Never allow; per computer; admin can cap | Has it (Host tools) |
| Route the Bot computer's traffic through the user's desktop (local egress) | S9 | O | Admin can turn off Allow Local Egress | Partial (Browser via VPN) |
| Update, reset and recover the computer; reset rebuilds from the last snapshot | S7, S9 | O | Recovery is offered only from the error state | Unknown |
| Computer screen is 1920 x 1200 | S16 | O | Raised from 1280 x 800 | Unknown |
| Shared file workspace at /workspace, durable across updates | S7 | O | Templates keep state in files rather than memory (Overheard ledger) | Has it (Workspace in R2) |
| Slide decks (PowerPoint or Google Slides), Sheets, Docs, Figma outputs | S16, S21 | O | 0.68.1 slide decks with sample slides | Unknown |
| Read-only X access without an X account; X plugin for DMs, bookmarks and home timeline | S7 | O | Built-in read-only search, reading posts and mentions | Missing |
| MCP servers: remote HTTPS (OAuth only, no secret headers) and command/stdio servers on the Bot's computer | S23, S8 | 3P | Local-machine MCP is not attached; custom-MCP OAuth redirect issues were still open on 2026-10-07 | Missing (granted skills and connectors only) |

### 4.3 Delegation, groups, chief and manager powers

| Capability | Evidence | Conf. | Note | Mr. Robot |
|---|---|---|---|---|
| Bot-to-bot message: sender wakes a receiver, receiver replies later, the handoff is visible in the conversation | S5, S12, S14 | O | Asynchronous between turns | Has it (Robot message, durable outbox) |
| Handoffs shown as first-class transcript events ("6 messages with Kenny, Tyler and Jenny") | S13 | O | Event cards in the transcript | Partial (labelled message) |
| Group chats of two to six Bots with shared context and per-Bot memory | S5, S13 | O | @everyone, per-Bot mention, reply-to-Bot; each thread is its own conversation | Missing (1:1 only) |
| Chief-of-staff Bot that routes work to specialists | S12, S13, S20, S17 | O | Recommended pattern; Alfred is a Marketplace template for designing such an org | Has it (Mr. Robot) |
| Manager role on a shared Bot (managers change setup for everyone) | S8 | O | Owner keeps publish, unpublish and delete | Partial (Home admin) |
| "Primary pinned Bot" and delegation depth (Single, 2-3 subagents, 4-8 worker army) | S17 (Prospector page) | O | Subagents inherit scoped connector visibility and cannot send, write or widen scope; sequential fallback if unavailable | Unknown |
| Bot-to-group handoff messages are text-only today | S5 | O | A Bot must DM an image to another Bot | Unknown |
| Capability and context split: tools and skills live at account level, memory and routines at Bot level | S13 | O | Explicit design statement | Similar (Grants per Robot) |
| Team Bot: one Bot the whole team talks to, private per-person chats, team memory, owner plus managers | S8, S14 | O | The owner cannot read teammates' chats | Partial (one Home) |
| Team Bot has its own Slack app and handle; teammates DM or @mention it; it posts as itself | S8, S14 | O | Each teammate links their Slack account to Cursor first; unlinked users get a private Link Account button | Unknown (Slack connector planned) |
| Slack DM is one conversation; a channel @mention opens a thread the Bot then follows | S8 | O | Slack channels share one computer for that Bot | Unknown |
| Slack approval card in a thread that only the requester can answer | S16 | O | "Review an action card only you can answer" | Partial (Ask in Conversation) |
| Slack channel listener routine to answer every channel message | S8, S4 | O | Named as the way to listen broadly | Unknown |

### 4.4 Triggers, schedules, events, webhooks

| Capability | Evidence | Conf. | Note | Mr. Robot |
|---|---|---|---|---|
| Routine: schedule with time zone, owning Bot, prompt, enable or pause, test run, run history | S4, S9 | O | Up to 50 routines per Bot, 20 most recent run records each, schedules at least 5 minutes apart | Has it (Routine) |
| Routines belong to the person who created them, never to the team | S8 | O | "No routine runs for the whole team at once" | Similar (per Robot) |
| Event triggers from account integrations (for example a Slack message or a GitHub notification) | S4 | O | Separate connection flow from plugins; narrow matching rules advised | Partial (Channel events) |
| Webhook routines with their own Webhook URL and Webhook key | S16 | O | The request body reaches the Bot; changelog 0.60 | Missing |
| Tag @bot on X to start a task from a post or reply, with a public confirmation reply | S1 | O | Needs an X account linked to Grok; not all regions | Missing |
| A test run performs real work (navigates, changes files, calls tools) | S4 | O | Keep write actions behind approval | Has it (Routine runs a Turn) |
| Unattended-usage control: the app may ask whether to keep routines running after a long absence and pause them | S4 | O | Good cost and risk control to copy | Unknown |
| Mobile can pause, resume and delete routines; editing the schedule or instruction and test runs need desktop | S10 | O | | Unknown |
| No model picker: Cursor manages model selection | S9 | O | A Bot can still install and drive a CLI on its own computer (Researchy installs Grok CLI) | Opposite (Providers per Member) |

### 4.5 Memory, context, skills

| Capability | Evidence | Conf. | Note | Mr. Robot |
|---|---|---|---|---|
| Per-Bot memory: stable preferences, role context, summaries of prior work | S1, S3, S11 | O | Shared computer files, group messages and handoffs move context between Bots | Has it (MEMORY.md, daily notes) |
| Memory is documented as not authoritative; re-check sources for consequential calls | S3, S11 | O | Mature stance worth copying | Similar (Trajectory as source of truth) |
| Team Bot two-tier memory: team memory read by everyone plus private notes per person | S8 | O | The Bot writes to team memory only when told the team should know | Partial (Member, Robot, Home scopes) |
| One private skill library shared by all your Bots | S4 | O | "Private skills are one library shared by all your Bots" | Has it (Skill library, global and local) |
| Install skills from the Marketplace; reference one with a slash command | S4 | O | Packaged skills ship beside connectors | Has it (Skill library) |
| Teach-by-demonstration: record up to 10 minutes of visible computer interaction into a draft skill | S4, S11 | O | No microphone audio; rollout is gradual; not available on mobile | Missing |
| Per-Bot skill and per-tool enablement | S9 | O | Installed plugins can have individual tools switched off | Partial (Grants per Robot) |
| Correct or remove memory by telling the Bot | S3, S8 | O | | Has it (Persona edits) |
| Member-scope files injected as a baseline (USER.md, PROACTIVE_PREFERENCES.md) | - | - | Grok Bot has no equivalent; personal context lives in per-person notes | Mr. Robot only |

### 4.6 Approvals, safety, audit, human handoff

| Capability | Evidence | Conf. | Note | Mr. Robot |
|---|---|---|---|---|
| Approval cards showing target, scope and values, with Allow once, Always allow and Deny | S6 | O | Same controls on iPhone | Has it (Ask, Grant proposal) |
| Auto Review: a model-based reviewer evaluates tool calls and computer actions before they run | S6, S20 | O | Rules are written in natural language, for example "Ask first before sending any external email" | Partial (Grants are binary) |
| Rule precedence: Ask first wins; personal rules can only be stricter than admin rules | S6, S9 | O | Admin rules show as locked, "Required by your admin" | Unknown |
| Team enforcement: cross-team connector policy, Team Rules, Auto-review enforcement, MCP allowlist (Enterprise) | S8, S9, S23 | O/3P | | Unknown |
| Approvals from unattended work expire after about 10 minutes; the card shows Expired | S6 | O | May offer "Always allow this in the future" without running the expired action | Unknown |
| Approval, secret, login and draft requests do not appear in group chats | S5 | O | Group conversations have a narrower approval surface | Unknown |
| Editable email or Slack draft card with Send or Discard before anything goes out | S5, S7, S13 | O | Formatted email from a draft card since 0.68.1 | Partial (Robot output is text) |
| A missing secret or key is requested in the owner's or a manager's own chat | S8 | O | Other teammates are told who adds it | Has it (Grant proposal) |
| Secrets encrypted at rest; value replaced with [REDACTED] in command output, file reads and plugin calls | S8 | O | Up to 25 secrets per Team Bot, at least 8 characters, at most 4096 bytes | Has it (Login entry) |
| Trajectory: one transcript mixing tool activity, computer use, created files, questions, approvals, voice memos | S5, S13 | O | Plus hover on the avatar for the current action and per-routine run history | Has it (Trajectory) |
| Search across messages, Bots, group chats, files and routines | S5, S10 | O | Cmd/Ctrl+K; availability can vary during rollout | Unknown |
| Audit logs: Bot creation, access changes, computers, group chats, templates, skills, plugins, routines, sharing, deletion | S16, S8, S15 | O | Enterprise; Action Recording writes members' actions to the team audit log | Partial (Trajectory, archive) |
| Stop now or redirect a running Bot by sending a message | S5, S16 | O | A direct message takes priority; Stop ends a stuck step in about 30 seconds; completed actions are not undone | Has it (steering a Turn) |
| In-app error notices above the composer with Copy request ID | S9 | O | | Unknown |
| "No access by default": a Bot reaches only the accounts you sign it into | S15 | O | Mirrored by template anti-jobs | Similar (everything off until granted) |

### 4.7 Cost, plans, accounts, admin

| Capability | Evidence | Conf. | Note | Mr. Robot |
|---|---|---|---|---|
| Weekly included usage, separate from Grok and Cursor chat usage; on-demand usage billed from model and token cost | S1, S11, S16 | O | | Similar (Spend limit) |
| Monthly on-demand limit the user can set; usage and spend banners with Upgrade, Set Spend Limit, Request Upgrade | S16 | O | Chat warns near the weekly limit | Has it (Spend limit) |
| Usage accounting in teams: a teammate's messages count against the teammate, routines against their creator, unlinked Slack posts against the owner | S8 | O | | Unknown |
| Plans: paid Cursor individual, Cursor Teams; link SuperGrok, SuperGrok Plus or Heavy; Enterprise rolling out with a waitlist | S1, S11, S15 | O | Public pricing reporting has conflicted (S25) | n/a |
| Several accounts on one desktop (Switch account, Add account) | S9, S11 | O | | Has it (Members) |
| Admin controls: assign Team Bots by group, delete a Team Bot, disable plugins, cap local execution, disable public template sharing, allow or deny local egress | S8, S9, S16 | O | "Required by your admin" is not user-toggleable | Partial (Home admin) |
| SSO through the organization's sign-in | S2 | O | | Has it (Cloudflare Access) |
| App languages: more than 20 with Follow System on desktop, a shorter list on mobile | S9, S11, S16 | O | 0.68.0 added Marathi, Tamil, Telugu, Swahili, Hausa | Unknown |

### 4.8 Marketplace, templates, installation, sharing, APIs

| Capability | Evidence | Conf. | Note | Mr. Robot |
|---|---|---|---|---|
| Official Marketplace of Bot templates by category, each with an Add button | S17 | O | Rows: Featured, From Grok Bot Team, Engineering, Sales, Marketing, Design, Personal, Recruiting and People, Product, Operations | n/a |
| Use-case gallery of 56 templates with filters | S18 | O | General 6, Sales 10, Marketing 13, CS/Support 4, Recruiting 4, Ops/Finance 5, Product 5, Engineering 5, Life 4 | n/a |
| Template is a recipe, not a clone: name, description, avatar, instructions, relevant memories, skills, routines, first-party plugins | S3, S19 | O | Excludes computer, files, logins and conversation history; also excludes MCP servers, custom code and scripts | Partial (skills only, no Robot export) |
| Install flow: preview on x.ai, Add to Grok Bot, review context and integrations, Add Bot, re-authenticate plugins | S19, S23 | O | One click; needs the app; adding accepts the third-party bot terms | Unknown |
| Share your own Bot: Create template, choose Public link or Team-only, Copy link, Update template | S3, S19 | O | Enterprise defaults to Team-only; admins can disable public sharing | Missing |
| Known template gap: skills shown in the preview do not arrive on import (reported 2026-08-29, acknowledged, still reported 2026-10-04) | S23 | 3P | Workaround: ask the new Bot to recreate each skill | n/a |
| Plugin install from an in-chat Connect card; mention a connector with @ | S7, S21 | O | Marketplace was renamed Connect apps across 0.60-0.67; GitHub became built in through the Cursor GitHub account | Similar (Connectors and Connections) |
| Plugins are account-wide: every Bot can use every connected account; Gmail is one mailbox at a time, some plugins allow a second account | S21, S23 | O | Documented warning: "An installed plugin is available to every bot" | Opposite (per-Robot Grants) |
| Plugin scope capped by the connected account: it cannot raise access or change sharing | S21 | O | | Has it (Grant scope) |
| Connector catalog: Gmail with Calendar, Drive (Docs, Sheets, Slides), OneDrive, Outlook, Teams, SharePoint, Salesforce, Box, Canva, Gamma, GitHub, Linear, Meltwater, Notion, S&P Global, Vercel, plus custom MCP | S22 | O | Grok Business and Enterprise admins must provision connectors before members can use them | Partial (Google, Slack, Discord planned) |
| Known plugin defects as of 2026-10-07: custom-MCP redirect_uri failures, Zoom OAuth 4700, Vercel redirect invalid | S23 | 3P | | n/a |
| Per-Bot email identity through the AgentMail plugin: one inbox per Bot, real inbound mail, custom domain, 24 email tools | S24 | 3P | Not an xAI product, listed in the plugin browser; native Gmail shares one mailbox across the fleet | Missing (Mr. Robot has no per-Robot address either) |
| Event triggers currently cover Slack, GitHub and Teams events, not email | S24 | 3P | Workaround: a polling routine or an AgentMail webhook posting into Slack | Unknown |
| Inbound-only automation surface: webhook routines receive requests; no documented public API to create or manage Bots programmatically | S16, S1-S11 | I | Not found in any doc reviewed | Partial (inbound only as well) |
| Community directories of public template links (grokbotwiki, grokdir, squad.so lists) | S23, S26 | 3P | Listings are not tested endorsements | n/a |

---

## 5. Notable capabilities Mr. Robot does not have

Ranked by how much they would change Mr. Robot. Each line names the source.

1. **Group chats of Bots** (2-6 Bots, shared visible context, per-Bot memory, @everyone) - the coordination surface Mr. Robot lacks; approvals, secrets, logins and drafts are deliberately excluded there (S5).
2. **Webhook triggers on Routines** - own Webhook URL and key, request body handed to the Bot, inbound without a Channel adapter (S16).
3. **Auto Review** - a model-based reviewer that evaluates tool calls and computer actions before they run, with natural-language Ask-first and Allow-automatically rules, and admin rules personal rules cannot loosen (S6, S9).
4. **Teach-by-demonstration** - record up to 10 minutes of computer work, get a draft skill (S4).
5. **A Bot's own email address** - AgentMail plugin creates one inbox per Bot with real inbound mail and a custom domain; Stalk Bot signs up for competitor newsletters with it (S24, S17).
6. **Voice** - dictation, live voice chat and Bot voice memos with transcripts (S5, S11).
7. **Per-Bot visual identity** - Bot-coloured messages, animated stateful avatars, computer wallpapers (S13, S16).
8. **Team Bots as one shared object** - one Bot all teammates talk to, private per-person chats, team memory, its own Slack app, owner plus managers (S8, S14).
9. **Enterprise audit logs** covering bots, computers, group chats, templates, skills, plugins, routines, sharing and deletion (S16, S8).
10. **Template sharing and a 56-template gallery** - a Bot as a shareable recipe, installable by link (S17-S19).
11. **Secure Forms** - the Bot shows a form in chat and fills page fields (including checkout) without the value reaching the model (S6, S16).
12. **Local egress routing** and hardware security key passthrough from the user's desktop (S9, S6).
13. **Slide-deck, Google Slides and Figma outputs** from the Bot's computer (S16).
14. **Account-level tools and skills against Bot-level memory and routines** as an explicit, documented split (S13).

Deliberately the other way: Grok Bot has **no** per-Bot isolation (one computer per account, account-wide plugins), **no** per-Bot model or provider choice, and **no** persona-file set. Mr. Robot's Grants, Providers, Login entry and Persona files are stricter than Grok Bot's model by design.

---

## 6. Confidence and limits of this inventory

- Official docs cover the platform model broadly (computer, approvals, routines, team bots); the changelog is the only source for several newer surfaces (webhook routines, Bot-coloured chats, slides, audit-log coverage).
- Marketplace pages rarely publish trigger, delivery or escalation detail, so the sample table leans on description text and on the memories/skills/routines/integrations badges; anything inferred is marked *(inf.)*.
- Third-party facts (token isolation, MCP limits, AgentMail, known plugin defects, template skill bug) are attributed to S23-S26 and were not independently reproduced here.
- Open questions not answered by any source reviewed: whether a Bot can hold its own phone number or send SMS; whether an outbound public API exists for creating Bots; whether Discord or WhatsApp channels are planned. Marked as no-evidence rather than no.

