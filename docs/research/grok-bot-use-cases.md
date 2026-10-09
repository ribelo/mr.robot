# Grok Bot use cases, 56 roles: capability catalogue against Mr. Robot

Source: "GROK BOT USE CASES — The Deployment Playbook for Persistent AI Agents" (56 roles, six domains),
the xAI use case gallery, and the xAI Grok Bot guides. Read against GLOSSARY.md on 2026-10-09.

## Sources and what each one gives

| Source | Reachable | What it gives |
| --- | --- | --- |
| https://x.ai/bot/use-cases | yes | All 56 roles with category and a one-line description. Extracted 2026-10-09. |
| https://docs.x.ai/grok-bot/use-cases | yes | 8 starter roles with an owned outcome, systems to connect, and a first task with its boundary. |
| /tmp/grokbot-usecases.txt | yes (local) | The playbook synthesis: read-check-apply-write shape, five criteria, approval boundary, priority ladder, 30 beta examples. |
| https://x.ai/bot/guides (+ engineering, GTM, marketing, support, post-sales) | yes | Fleet, routine and connector practice; capabilities confirmed in live use. |
| https://genalphai.com/100-use-cases-for-grok-bot/ | yes | 100 use cases with apps touched and a human gate each; used to check gates, not to add roles. |
| https://www.grokbotwiki.com/bots/vendor-portal-operator | yes | Name and description of the one gallery role whose name the page did not render (Vendor Portal Operator). |
| Spice AI guide | **not found** | Searched spice.ai, spiceai.org, the Exa index and general web. spice.ai/blog fails to load; spiceai.org covers xAI models as a model provider only. No Spice AI Grok Bot use-case guide exists in reachable sources on 2026-10-09. |

## How to read the catalogue

- Domain is the table heading; categories are the nine official ones, grouped here in the playbook's six domains where they fit.
- Read / check / apply / write is the shape the playbook states: read a source, check a system, apply a rule, write a result.
  The eight documented roles follow their published task text; the rest are inferred from the published role description and the domain guides.
- The last column lists capability ids. Each id is defined and judged in the aggregate table at the end.
- Every published role stops at a human gate. "Gate" below is what the role itself holds back, not a product limit.

## General (6 roles) — General

| Role | Read / check / apply / write | Systems signed into | Trigger | Output channel | Approval gate | Capabilities required |
| --- | --- | --- | --- | --- | --- | --- |
| Chief of Staff | read: activity in Slack, mail, calendar, notes; check: each item against the priorities file; apply: rank and drop noise; write: source-linked digest with next steps | Slack, Gmail, Google Calendar, meeting notes, planning docs | schedule (daily) + message | digest card / push to owner | no sends, no meeting changes | slack-read, mailbox-read, calendar-read, docs-write, scheduled-wake, owner-notify, approval-gate, bot-to-bot, durable-state |
| Inbox Manager | read: whole mailbox; check: urgency, category, blocked threads; apply: label and file rules; write: triage, reply drafts, cleanup | Gmail (API), webmail fallback | schedule + event (new mail) | Gmail drafts + summary in chat | every send behind owner approval | mailbox-read, email-draft, email-send, browser-login, scheduled-wake, event-wake, approval-gate |
| Executive Assistant | read: channels, rooms, mail, calendar; check: what changed since last look; apply: priority rules; write: morning brief and on-join catch-up | Slack, Gmail, Google Calendar | schedule + event (owner joins a room) | brief card, push | no messages, no meeting changes | slack-read, mailbox-read, calendar-read, owner-notify, scheduled-wake, event-wake, docs-write |
| Daily Briefing Writer | read: news and social feeds; check: relevance to owner interests; apply: filter and dedupe; write: short brief | public web, X, news sites | schedule (daily) | push / brief card | none (internal output only) | web-research, social-read, scheduled-wake, owner-notify, docs-write |
| Status Report Writer | read: docs, meeting notes, Slack action items; check: open versus done; apply: one living list; write: morning digest and list update | Google Docs, Slack, meeting notes | schedule (daily) | digest in chat, living doc | comment only, no edits to other people's docs | docs-write, slack-read, scheduled-wake, owner-notify, durable-state |
| Presentation Designer | read: brief and brand system; check: master template and rules; apply: layout rules; write: editable deck | Google Slides or Figma, Google Drive | message | deck link and screenshot in chat | owner refines and presents | deck-editing, drive-upload, artefact-build, visual-capture, browser-login |

## Sales (10 roles) — Sales & Growth

| Role | Read / check / apply / write | Systems signed into | Trigger | Output channel | Approval gate | Capabilities required |
| --- | --- | --- | --- | --- | --- | --- |
| Sales Outbound | read: CRM view, intent sources, company sites; check: ICP fit and active sequences; apply: lead scoring; write: email and LinkedIn drafts plus review list | Salesforce, LinkedIn, Gmail, Sheets | schedule (nightly) + message | review list in chat, drafts in Gmail | do not send or enrol anyone | crm-read, browser-login, social-read, email-draft, sheets-rw, scheduled-wake, approval-gate, batch-approval, always-on-computer |
| Account Research Specialist | read: CRM plus live signals; check: fit and warmth; apply: tiering; write: research pack per account | Salesforce, web, LinkedIn, Google Docs/Drive | message + weekly schedule | pack in Drive, summary in chat | review before any outreach | crm-read, browser-login, web-research, docs-write, drive-upload, artefact-build |
| Prospecting Plan Builder | read: target list; check: contact data quality; apply: enrichment rules; write: week tracker with email and mobile | public web, Sheets, CRM | schedule (weekly) | sheet plus chat summary | no outreach sent | web-research, sheets-rw, crm-read, drive-upload, scheduled-wake |
| Meeting Prep Buddy | read: calendar, notes, CRM, call transcripts, Slack; check: last touch and open threads; apply: prep template; write: one-page pack | Google Calendar, Salesforce, Gong, Slack, Docs | event (15-35 min before a call) | prep card / push | read-only, no sends | calendar-read, crm-read, meeting-transcripts, slack-read, docs-write, scheduled-wake, owner-notify |
| Pipeline Analyst | read: CRM and sheets; check: stage age, activity, commit risk; apply: risk rules; write: Monday scoreboard | Salesforce, Sheets | schedule (weekly) | sheet and report in chat | no deal edits, owner presents | crm-read, sheets-rw, docs-write, scheduled-wake |
| CRM Operations Manager | read: CRM, org charts, meeting notes; check: duplicates, stale owners, empty fields; apply: hygiene rules; write: record changes | Salesforce/HubSpot, LinkedIn, Slack | schedule + event (after a meeting) | change list for bulk approval in chat | bulk field changes approved first | crm-read, crm-write, batch-approval, browser-login, scheduled-wake |
| Deal Desk Coordinator | read: past mail, CRM, call notes; check: stage and blockers; apply: internal note format; write: deal note, submit in CRM after approval | Salesforce, Gmail, Gong | message + event (deal review) | internal note, CRM record | submit in CRM needs approval | crm-write, mailbox-read, meeting-transcripts, approval-gate |
| Deck Updater | read: discovery notes or transcript; check: deck structure; apply: next-step rules; write: updated deck | Google Slides/PowerPoint/Figma, transcripts | event (during or after a call) | deck link | owner presents | deck-editing, meeting-transcripts, drive-upload |
| Sales Call Coach | read: recorded calls; check: discovery, objections, presence; apply: rubric and score; write: timestamped coaching | Gong | event (call ends) + schedule | coaching note / push | internal only | meeting-transcripts, docs-write, owner-notify, artefact-build |
| Renewal Desk Operator | read: usage, tickets, calls, CRM; check: 90-day window and terms; apply: renewal playbook; write: account pack, commercial note, legal nudge | CRM, helpdesk, Gong, Slack | schedule (per account, 90 days out) | pack in Drive, Slack or mail draft | terms and legal action need a human | crm-read, helpdesk-read, meeting-transcripts, docs-write, slack-post-dm, scheduled-wake |

## Marketing (13 roles) — Marketing & Communications

| Role | Read / check / apply / write | Systems signed into | Trigger | Output channel | Approval gate | Capabilities required |
| --- | --- | --- | --- | --- | --- | --- |
| Paid Media | read: ad platforms, analytics, budget sheet; check: pacing, CAC, anomalies; apply: reallocation rules; write: Slack recommendation | Google Ads, Meta, LinkedIn Ads, Sheets, Slack | schedule (nightly) | Slack draft and chat card | no budget changes without approval | ads-read, ads-write, sheets-rw, slack-post-dm, browser-login, scheduled-wake, approval-gate |
| Paid Media Creative Strategist | read: creative performance; check: early winners and fatigue; apply: test hypotheses; write: next-test proposal | ad platforms, analytics | schedule | proposal in chat or doc | no live changes | ads-read, docs-write, scheduled-wake |
| LinkedIn Campaign Manager | read: campaigns, forms, UTM data; check: funnel consistency; apply: offer and UTM rules; write: campaign drafts | LinkedIn Ads, forms, Sheets | message + schedule | drafts in chat | draft for approval | ads-read, form-submit, sheets-rw, browser-login, approval-gate |
| SEO / AEO Auditor | read: SERPs, AI answers, site crawl, competitors; check: lost and gained ground; apply: audit rubric; write: optimisation plan | browser, search consoles, analytics | schedule (weekly) | report in chat or Docs | owner implements fixes | web-research, analytics-query, docs-write, scheduled-wake |
| Social Media Manager | read: own post history and launch news; check: what is worth posting; apply: voice rules; write: queued post drafts | X, LinkedIn, Slack | schedule + event (launch) | draft queue plus push | owner presses publish | social-read, social-post, browser-login, scheduled-wake, approval-gate |
| Compelling Events Monitor | read: leadership posts, awards, launches, hiring signals; check: relevance; apply: engagement rules; write: digest with comment and repost drafts | LinkedIn, X, news sites | schedule (daily) | digest push | owner posts | social-read, web-research, scheduled-wake, owner-notify |
| Competitive Intelligence Analyst | read: competitor sites, launches, ad libraries, own site; check: what is new and gaining traction; apply: significance rules; write: shift brief | public web, ad libraries, own analytics | schedule (overnight) | brief in chat or Docs | internal only, changes only suggested | web-research, ads-read, docs-write, scheduled-wake, visual-capture, durable-state |
| Community Operations Manager | read: applications and community DMs; check: fit and cadence; apply: screening rules; write: triage, nurture drafts | Discord, Slack, application forms | schedule + event (new application or DM) | DM drafts, batch approval in chat | owner sends, applicants batch-approved | community-dm, form-submit, batch-approval, approval-gate, scheduled-wake |
| Event Guest Screener | read: event applications; check: ICP fit; apply: scoring; write: approved list and invites | invite tool, CRM, web | event (application submitted) | batch approval in chat, invite tool | batch approve, then invite | form-submit, batch-approval, crm-read, event-wake, browser-login |
| Internal Communications Manager | read: docs, Slack, meetings; check: audience and channel; apply: voice rules; write: copy for review | Google Docs, Slack, Notion | message + event | draft in chat or doc | review only, never sends | docs-write, slack-read, approval-gate |
| Marketing Calendar Owner | read: Notion and regional calendars; check: gaps and conflicts; apply: cadence rules; write: calendar updates and weekly status | Notion, Sheets, Slack | schedule (weekly) | doc or sheet plus Slack summary | owner confirms dates | docs-write, sheets-rw, slack-post-dm, scheduled-wake |
| Newsletter Writer | read: launches, wins, calendar; check: what is new; apply: format and voice; write: issue draft | Google Docs, CMS, calendar | schedule (monthly) | issue draft plus push | marketing edits and sends | docs-write, social-read, scheduled-wake, owner-notify, approval-gate |
| Merch Fulfillment Operator | read: replies and redemption form; check: eligibility; apply: approve or reject; write: vendor order form, approval ping | forms, Gmail, vendor portal | event (form submission) + schedule (daily) | chat approval ping, vendor mail | owner approves each submission | form-submit, mailbox-read, email-send, event-wake, approval-gate, scheduled-wake, sheets-rw |

## Customer Success & Support (4 roles) — Customer Success & Support

| Role | Read / check / apply / write | Systems signed into | Trigger | Output channel | Approval gate | Capabilities required |
| --- | --- | --- | --- | --- | --- | --- |
| Account Health | read: usage, engagement, support, billing, CRM; check: risk thresholds and renewal dates; apply: scoring; write: ranked watch list | CRM, product analytics, helpdesk, billing | schedule (weekly, before QBR) | watch list in chat or Docs | no customer contact, no CRM edits | crm-read, helpdesk-read, analytics-query, docs-write, scheduled-wake |
| Account Manager | read: transcripts, notes, CRM, Slack; check: promises and next steps; apply: account plan; write: call prep and follow-up drafts | CRM, Gong, Slack, Gmail, calendar | schedule (pre-call) + event (call ends) | prep pack, mail and Slack drafts | final yes on anything with the owner's name | meeting-transcripts, crm-read, slack-read, docs-write, email-draft, calendar-read |
| Enablement Fulfillment Specialist | read: request for recordings; check: asset library; apply: packaging rules; write: one-pager in Drive, reply draft with links | Zoom assets, Google Drive, Gmail | message + event | Drive upload, reply draft | owner sends the reply | drive-upload, artefact-build, email-draft, docs-write |
| Ticket Triage Specialist | read: support queue; check: severity, product area, expertise; apply: routing rules; write: classification and reply drafts, silent when clean | Intercom/Zendesk, Slack | schedule (cadence) + event (new ticket) | routed queues, draft replies | drafts only, no resolution | helpdesk-read, helpdesk-write, scheduled-wake, event-wake |

## Recruiting & People (4 roles) — Recruiting & People

| Role | Read / check / apply / write | Systems signed into | Trigger | Output channel | Approval gate | Capabilities required |
| --- | --- | --- | --- | --- | --- | --- |
| Talent Scout | read: role brief, sourcing sites, GitHub, ATS; check: must-haves and existing candidates; apply: scoring; write: outreach drafts and scheduling prep | LinkedIn, job boards, GitHub, ATS, calendar, mail | schedule + message | candidate list, drafts, proposed times | no contact, schedule after approval | ats-read-write, browser-login, social-read, email-draft, calendar-read, scheduled-wake, batch-approval |
| Hiring Screener | read: applications and work samples; check: defined bar; apply: rubric; write: ATS-ready review | ATS, Google Drive | event (application arrives) | review record, chat summary | humans interview and decide | ats-read-write, doc-ocr, docs-write, batch-approval |
| Calendar Coordinator | read: calendars and rules; check: time zones, back-to-backs, holds; apply: scheduling rules; write: invites, holds, reminders | Google Calendar, mail, Slack | event (request) + schedule | invites, chat messages | proposed times approved by the people | calendar-read, calendar-write, mailbox-read, slack-post-dm, event-wake |
| Onboarding Manager | read: new-hire plan and docs; check: day-one questions; apply: routing rules; write: checklist and routed answers | Notion/Docs, Slack, HR system | event (new hire) + message | checklist in chat, routed asks | internal only | docs-write, slack-post-dm, bot-to-bot, durable-state |

## Operations & Finance (5 roles) — Operations & Finance

| Role | Read / check / apply / write | Systems signed into | Trigger | Output channel | Approval gate | Capabilities required |
| --- | --- | --- | --- | --- | --- | --- |
| Expense Manager | read: expense system, receipts in mail, policy; check: categories, missing items, exceptions; apply: categorisation; write: weekly summary and follow-up drafts | expense platform, Gmail, Drive, Sheets | schedule (weekly, month-end) | summary in Drive and chat, drafts | no reimbursement changes, no sends | mailbox-read, doc-ocr, browser-login, sheets-rw, drive-upload, email-draft, scheduled-wake |
| Invoice Coordinator | read: invoices from mail and portals; check: match to orders and actuals; apply: matching rules; write: forwarded and matched invoices, nudges | AP portal, Gmail, Sheets, shared drive | event (invoice arrives) + schedule | AP queue, nudges | no payment, owner resolves exceptions | mailbox-read, doc-ocr, browser-login, sheets-rw, slack-post-dm, event-wake |
| Contract Desk | read: contract queue and CLM; check: stage, owner, key terms, blocked reviews; apply: summary rules; write: weekly paper summary | CLM/DocuSign, Drive, Slack | schedule (weekly) | summary doc, Slack summary | summary only, no legal action | docs-write, doc-ocr, drive-upload, slack-post-dm, scheduled-wake |
| Security Questionnaire Filler | read: questionnaire in a vendor portal; check: answers in trust centre and past RFPs; apply: answer matching; write: filled fields, submit parked | vendor security portals, trust centre, Drive | event + message (new questionnaire) | filled questionnaire, Ask to submit | human reviews and submits | browser-login, form-submit, doc-ocr, drive-upload, docs-write, approval-gate, human-takeover |
| Vendor Portal Operator | read: vendor portals for renewals, seats, procurement; check: dates, usage, invoices; apply: renewal rules; write: exception report, portal actions | vendor portals with no API, Sheets, mail | schedule (weekly) | exceptions in chat, portal actions | no purchase or renewal without approval | browser-login, form-submit, login-handover, human-takeover, sheets-rw, scheduled-wake, approval-gate, spend-execution |

## Product (5 roles) — Product

| Role | Read / check / apply / write | Systems signed into | Trigger | Output channel | Approval gate | Capabilities required |
| --- | --- | --- | --- | --- | --- | --- |
| Beta Adoption Watcher | read: usage and feature data; check: who is active; apply: thresholds; write: follow-up list | product analytics, CRM, Slack | schedule (daily) | list in Slack or chat | no customer contact | analytics-query, crm-read, slack-post-dm, scheduled-wake, durable-state |
| Call FAQ Miner | read: call recordings; check: repeated questions; apply: clustering; write: answers with timestamps and links | Gong/Zoom, Docs | schedule (weekly) | enablement doc, Slack summary | internal only | meeting-transcripts, docs-write, slack-post-dm, scheduled-wake |
| Docs Auditor | read: help centre, internal notes, shipped changes; check: stale pages; apply: diff rules; write: rewrite drafts | CMS/help centre, GitHub, Docs | schedule (weekly) | drafts in doc, ticket or chat | docs owner publishes | repo-access, docs-write, web-research, scheduled-wake, artefact-build |
| Feature Request Tracker | read: Slack, calls, tickets; check: who asked and how often; apply: clustering and tags; write: living list tied to customers | Slack, Gong, helpdesk, Sheets | schedule + event | living sheet/doc and digest | internal only | slack-read, meeting-transcripts, helpdesk-read, sheets-rw, scheduled-wake, durable-state |
| Product Feedback Analyst | read: feedback from Slack, tickets, calls, forms; check: evidence and urgency; apply: clustering and priority; write: routing recommendations | Slack, helpdesk, calls, Sheets | schedule (weekly) | prioritised report, Ask for routing | routing approved by a human | slack-read, helpdesk-read, meeting-transcripts, docs-write, approval-gate, scheduled-wake |

## Engineering (5 roles) — Engineering & Systems

| Role | Read / check / apply / write | Systems signed into | Trigger | Output channel | Approval gate | Capabilities required |
| --- | --- | --- | --- | --- | --- | --- |
| Bug Reproduction | read: bug report or thread; check: staging with a fresh account; apply: repro steps; write: repro pack with steps, screenshots, console and network notes | issue tracker, staging app, browser, devtools | event (new report) + message | issue attachment, chat card | no production data, no code fix | helpdesk-read, ui-testing, visual-capture, browser-login, login-handover, artefact-build, event-wake |
| Product Performance | read: dashboards, traces, flamegraphs; check: anomaly window; apply: hypothesis rules; write: writeup with screenshots and links | Datadog/Grafana/New Relic, analytics, GitHub | event (release or alert) + schedule | report in chat or Docs | no alert or production changes | observability-read, browser-login, visual-capture, docs-write, repo-access, scheduled-wake |
| Cloud Agent Orchestrator | read: agent runs and task board; check: progress, stuck runs, CI; apply: retry and escalate rules; write: kickoff, follow-ups, summary | cloud agent API, Notion board, GitHub, Slack | schedule (every 30 min) + event | board update, chat summary | merge rules; owner gets escalations | cloud-agent-orchestration, repo-access, bot-to-bot, parallel-runs, scheduled-wake, durable-state, owner-notify |
| Playtest Operator | read: build and test checklist; check: the UI path on a computer; apply: test steps; write: findings pack with captures | product UI, desktop apps, capture tools | event (new build) + message | findings pack in chat or issue | no production changes | ui-testing, visual-capture, artefact-build, always-on-computer |
| Prototype Builder | read: ask and brand; check: environment; apply: stack choice; write: code, run it, return screenshot and live URL | dev machine, GitHub, hosting | message | screenshot and URL in chat | owner reviews, not production | cloud-agent-orchestration, repo-access, ui-testing, visual-capture, drive-upload |

## Life & Leverage (4 roles) — Life & Leverage

| Role | Read / check / apply / write | Systems signed into | Trigger | Output channel | Approval gate | Capabilities required |
| --- | --- | --- | --- | --- | --- | --- |
| Apartment Scout | read: listings; check: price, pets, commute; apply: filters; write: shortlist, tour mails, applications | listing sites, Gmail, forms | schedule + event (new listing) | shortlist in chat, mail to agents | owner picks; bookings and applications approved | web-research, form-submit, mailbox-read, email-send, scheduled-wake, approval-gate, human-takeover |
| Subscription Cleaner | read: receipts and newsletter mail; check: active subscriptions and use; apply: kill rules; write: kill list and unsubscribes | Gmail, subscription portals | schedule (monthly) | kill list in chat | unsubscribe only what is approved | mailbox-read, browser-login, batch-approval, approval-gate, scheduled-wake |
| Travel Coordinator | read: flights, hotels, owner rules; check: price, policy, expiry; apply: comparison; write: options, itinerary, calendar entry | airline and hotel sites, calendar, mail | message + event | options and itinerary in chat | confirm before booking (owner pays) | browser-login, form-submit, spend-execution, calendar-write, docs-write, human-takeover |
| Personal Site Builder | read: description and brand; check: domain and hosting; apply: template; write: site, deploy, live URL | hosting, DNS, code repo | message | live URL and screenshot | owner reviews before public launch | cloud-agent-orchestration, repo-access, web-research, visual-capture, human-takeover |

## Aggregate: capabilities the 56 roles need

Counts are roles that need the capability, from the tables above. Judgement is against GLOSSARY.md and the v1–v1.5 tickets.

| # | Capability | Roles needing | Mr. Robot | Reason |
| --- | --- | --- | --- | --- |
| 1 | scheduled-wake | 36 | yes | A Routine is a schedule with a prompt on a Durable Object alarm (GLOSSARY). |
| 2 | docs-write | 27 | yes | Docs and Sheets tools read and edit text and cells in place (v1.5/04, done). |
| 3 | browser-login | 18 | yes | Browser backends plus per-Robot Login entries; login filled into matching pages (GLOSSARY; v1.1/05). |
| 4 | approval-gate | 16 | yes | Everything is off until granted; Ask puts a decision in the composer and stored grant proposals are applied exactly (GLOSSARY). |
| 5 | crm-read | 11 | partial | No CRM connector. A Robot reaches a CRM only through its browser and a Login entry, so reads are screen-driven. |
| 6 | sheets-rw | 11 | yes | Sheets cells are read and edited in place; CSV export and import also exist (v1.5/04). |
| 7 | mailbox-read | 10 | yes | Gmail tools: search, read a thread, list and open attachments, label, archive (v1.5/03, done). |
| 8 | drive-upload | 9 | yes | Drive tools: list, search, download, upload, folders, move, share (v1.5/04, done). |
| 9 | meeting-transcripts | 9 | no | No Zoom, Gong, Granola or Meet connector; the Google set is Gmail, Calendar, Drive, Docs, Sheets, Contacts (v1.5). |
| 10 | owner-notify | 9 | yes | Web Push events: finished, needs you (takeover, grant proposal, question), blocked (v1). |
| 11 | slack-post-dm | 9 | partial | Send, reply in thread and mark read exist behind a separate write grant, still in progress (v1.5/06). |
| 12 | web-research | 9 | yes | Exa plugin (search, crawl, agent runs) plus the DSH web seam, granted per Robot (v1.1/11). |
| 13 | event-wake | 8 | yes | A Channel event wakes a Robot. The seam exists; v1 ships PWA and Web Push, Discord is in progress (GLOSSARY; v1.5/05). |
| 14 | form-submit | 8 | partial | The browser acts and types, and takeover handles CAPTCHA, but bot checks already blocked one shop (v1/08; v1.1/02). |
| 15 | slack-read | 8 | partial | Slack read tools are built, but the ticket is in progress and live use waits on the owner's pasted session (v1.5/06). |
| 16 | artefact-build | 7 | yes | The Workspace in R2 plus code mode gives the Robot files and programs to build reports and packs. |
| 17 | batch-approval | 7 | partial | An Ask carries one decision; no bulk approve or reject surface for a list of items is described. |
| 18 | durable-state | 7 | yes | Workspace, persona files, daily notes and the three memory scopes survive across Turns (GLOSSARY). |
| 19 | visual-capture | 7 | yes | The browser screenshot primitive, the panel thumbnail and a CDP screencast for the live view (v1/08, v1/09). |
| 20 | calendar-read | 6 | yes | Calendar tools: list calendars, list and search events, free-busy (v1.5/03, done). |
| 21 | email-draft | 6 | yes | Gmail draft tool exists; drafts can wait for the owner in the mailbox (v1.5/03). |
| 22 | helpdesk-read | 6 | partial | No ticketing connector; browser and Login entry only. |
| 23 | social-read | 6 | partial | No X or LinkedIn connector; public reading works, logged-in reading needs the browser plus a Login entry. |
| 24 | doc-ocr | 5 | partial | Attachments land in the Workspace and the model reads files, but no OCR pipeline for scans is described. |
| 25 | human-takeover | 5 | yes | Takeover suspends the Turn while the Member drives the tab; used for login, 2FA and payment stops (v1/09, v1.1/04). |
| 26 | repo-access | 5 | partial | No GitHub connector; a Host shell can clone and run git, and the skill library syncs from a Git repository. |
| 27 | ads-read | 4 | partial | No ad-platform connector; browser and Login entry only. |
| 28 | analytics-query | 3 | no | No warehouse or BI tool, and no credential model for SQL clients; only the Host shell could run one. |
| 29 | bot-to-bot | 3 | yes | Robot message with recipient Grants; Mr. Robot may create Robots and holds recipient Grants to them (GLOSSARY). |
| 30 | cloud-agent-orchestration | 3 | partial | Mr. Robot can create Robots and a Host runs shell, but there is no cloud-agent or CI API and no per-run transcript watching. |
| 31 | email-send | 3 | yes | Gmail send, reply and forward exist and sit behind a separate grant from reading (v1.5/03, story 12). |
| 32 | ui-testing | 3 | yes | Open, observe, act and wait exist in the browser seam; the Host browser adds a real desktop Chrome (v1/08, v1.2/03). |
| 33 | always-on-computer | 2 | yes | The Turn is driven by the Durable Object, so closing the PWA does not stop the work (v1, Long turns). |
| 34 | ats-read-write | 2 | partial | No ATS connector; browser and Login entry only. |
| 35 | calendar-write | 2 | yes | Calendar tools: create, update, delete, respond to invitations (v1.5/03). |
| 36 | crm-write | 2 | partial | Same screen-driven path; writes are possible but have no field-level guard beyond Grants and the approval habit. |
| 37 | deck-editing | 2 | partial | No Slides, PowerPoint or Figma connector; the Robot edits files in Drive or the deck in a browser. |
| 38 | login-handover | 2 | yes | Login entry holds user and password; TOTP seeds give codes; the Robot's program never sees the password (v1.1/05, v1.1/12). |
| 39 | spend-execution | 2 | no | By design: the Robot prepares a cart or an order and stops; payment and bank 2FA stay with the owner (v1, line 218). |
| 40 | ads-write | 1 | partial | Possible through the browser, but nothing in the platform enforces the budget-change gate. |
| 41 | community-dm | 1 | partial | The Discord bot reads and sends messages, files and DMs and acts as a Channel, but the ticket is in progress (v1.5/05). |
| 42 | helpdesk-write | 1 | partial | Reply drafting would run through the browser; no ticket API and no draft-only mode. |
| 43 | observability-read | 1 | partial | No Datadog/Grafana connector; browser and Login entry only. |
| 44 | parallel-runs | 1 | no | One Turn at a time per Robot, and the DSH subagent packages are not mounted (GLOSSARY; v1, non-goals). |
| 45 | social-post | 1 | partial | Posting is browser work; nothing in the platform holds a post in a draft queue behind approval. |

Counts: 22 capabilities yes, 19 partial, 4 no, out of 45 distinct capabilities across 56 roles.

## What this says about Mr. Robot

- The platform covers the agent half well: browser with logins and takeover, mail, calendar, Drive, Docs and Sheets, Slack and Discord, routines, robot-to-robot messages, push, approvals and memory.
- The largest gaps are outside the Google, Slack and Discord set: CRM, ATS, helpdesk, ad platforms, observability and analytics have no connector, so every such role falls back to the browser and a Login entry.
- Three capability clusters are simply absent: meeting transcripts (Gong, Zoom, Granola), warehouse or BI queries, and parallel agent runs.
- Draft-first is strong where the platform owns the system (Gmail drafts, Ask before send) and weak where it does not (social posts, ads, portals) because nothing holds a third-party draft.
- Delivery risk is in batch work: several roles approve or reject a list, and Ask carries one decision at a time.
