---
title: "Mr. Robot v1.1 — a browser that works, logins, asks in the composer, editable skills and memory"
status: ready-for-agent
story-prefix: rb
parent: mr-robot-v1.md
---

# Mr. Robot v1.1

## Problem Statement

After the first morning with the deployed v1 the owner found the product unusable for its main purpose. The robot's browser is blocked by Allegro ("You have been blocked"): Cloudflare Browser Run signs every request with non-removable Web Bot Auth headers and always leaves from Cloudflare addresses, so sites with bot protection reject it by design. The takeover window shows "Waiting for the screen" while the panel thumbnail shows a page. Secrets are a bare name and value, cannot be edited, and do not say which site or account they belong to. Grant proposals and questions appear inside the message stream instead of where the owner types. Advanced settings cannot be reached from the robot menu, the model list cannot be searched, long tool and skill lists push the page apart, and a robot's memory files are only visible inside a prompt dump. The skill library was filled from a third-party repository the owner never chose, and skills cannot be edited. Mr. Robot starts without a compaction instruction. Exa, which the owner uses daily, is missing.

The goal stands: robots must work while the owner's computer is off (holiday, bills paid on time), cheaply, preferably free, and may use services outside Cloudflare when that is what works.

## Solution

The browser becomes a set of backends behind one seam, chosen per robot: the existing Browser Run stays; a new backend runs Chrome in a Cloudflare Container (no bot signature), first with plain Cloudflare egress and then optionally through the owner's Proton VPN on a Polish server; which one is the Home default is decided by recorded results on the owner's real sites. Takeover opens the browser on demand. Secrets become login entries with websites, per-robot grants, URL-bound filling that keeps passwords out of the robot's program, and autofill suggestions. Asks replace the composer. Settings, model search, list heights, a Files view for workspace and memory, editable global and robot-local skills, Mr. Robot defaults, and Exa as a grantable tool group complete the round. Work the owner described but deferred is recorded as postponed tickets.

## User Stories

### Browser that works without the owner's computer

1. As a person, I want a robot's browser to work while my computer is off, so that bills get paid while I am on holiday ^rb-d59c
2. As a person, I want to choose a robot's browser backend in its advanced settings (Browser Run, Container Chrome, Container Chrome via VPN), so that each robot uses what its sites accept ^rb-wgtd
3. As a Home admin, I want a Home default browser backend, so that new robots start on the one that works best ^rb-ybt4
4. As a robot, I want the same browser tools (open, observe, act, screenshot) whatever backend runs them, so that switching backend changes nothing in how I work ^rb-b3yf
5. As a robot, I want my cookies and storage to follow me across backends and wake-ups, so that a backend switch does not log me out ^rb-bcui
6. As a person, I want Chrome running in a Cloudflare Container without the Browser Run bot signature, so that sites that block signed Cloudflare bots let my robot in ^rb-wn96
7. As a person, I want the Container Chrome to optionally send its traffic through my Proton VPN on a Polish server, so that sites that require a Polish address or reject Cloudflare addresses work ^rb-j5ml
8. As a Home admin, I want to store the Proton VPN WireGuard configuration once for the Home, so that every robot set to the VPN backend uses it ^rb-rb1x
9. As a person, I want each backend's results on Allegro, eZUS, a bank login page and my invoicing service recorded, so that the default is chosen on evidence ^rb-690z
10. As a person, I want the existing Browser Run backend kept, so that nothing that works today is lost ^rb-4n0b
11. As a robot, I want to recognise a block page (bot check, 'you have been blocked') and report it with the backend that hit it, so that the owner can switch backend instead of guessing ^rb-kank
12. As a person, I want browser minutes per backend counted in usage and spend limits, so that browsing robots cannot run up a bill unseen ^rb-y50l

### Live view and takeover

13. As a person, I want the takeover window to open the robot's browser on demand at its last page when no turn is running, so that I never stare at 'Waiting for the screen' ^rb-keaw
14. As a person, I want the live view in the panel and the takeover window to show the same screen, so that what I see small is what I get large ^rb-yvct
15. As a person, I want takeover to work on every backend, so that a login or 2FA step can always be handed to me ^rb-hq0l

### Logins (replacing secrets)

16. As a person, I want login entries with name, username, password, website addresses and notes, so that a robot knows which password belongs to which site and account ^rb-gq50
17. As a person, I want to add, edit, reveal and delete login entries in my settings, so that the vault is mine to maintain ^rb-4dxe
18. As a person, I want each login entry granted per robot, so that the invoice robot never reaches my Allegro account ^rb-2myk
19. As a Home member, I want a login entry to be private or shared with the Home, so that the electricity account is entered once for the household ^rb-ob2g
20. As a robot, I want to list the login entries granted to me that match the current page, so that I pick the right account like a password manager's autofill ^rb-vpes
21. As a robot, I want to fill a granted login into the current page without the password passing through my program, so that the password never appears in my code, conversation or trajectory ^rb-e1ic
22. As a person, I want a login to be usable only on pages whose address matches the entry's websites, so that a granted password cannot be typed into a different site ^rb-1dzv
23. As a person, I want autofill suggestions for matching login entries in the takeover window, so that I log in for the robot with one tap ^rb-o52a
24. As a person, I want existing secrets migrated to login entries without losing grants, so that nothing breaks ^rb-36g4

### Composer and asks

25. As a person, I want a robot's pending asks (grant proposals, questions, setup approval, member-file edits) to appear in place of the composer, so that a decision is where I would type and cannot scroll away ^rb-dat4
26. As a person, I want to answer an ask and get the composer back, so that the conversation continues where it was ^rb-r0oj
27. As a person, I want several pending asks shown one at a time with a count, so that none is hidden ^rb-f5um
28. As a person, I want the composer's add button vertically centred, so that the composer looks right ^rb-qo0r
29. As a person, I want the robot's thinking shown at full message width, so that it is readable ^rb-14cp

### Settings and navigation

30. As a person, I want Advanced settings in the robot's list menu next to Edit profile, so that I reach it from where I start ^rb-zrac
31. As a person, I want to search the model list by name and provider, so that I find a model among hundreds ^rb-kzmf
32. As a person, I want the tools and skills lists in advanced settings to have a fixed maximum height with their own scroll, so that one long list does not push everything else away ^rb-woko
33. As a person, I want the prompt preview without a second copy of the tools list, so that the page shows each thing once ^rb-gi08

### Robot files and memory

34. As a person, I want a Files view per robot that lists its workspace (SOUL.md, IDENTITY.md, AGENTS.md, TOOLS.md, MEMORY.md, daily notes, its skills, its other files), so that I can see what the robot remembers ^rb-1miy
35. As a person, I want to open and edit any of those files, so that I can correct a robot's memory or persona ^rb-q5eb
36. As a person, I want the robot told when I edited one of its files, so that it does not overwrite my change from stale context ^rb-xwks

### Skills

37. As a Home admin, I want the skill library empty by default with no sync source configured, so that robots start without skills I did not choose ^rb-a70a
38. As a person, I want global skills (the Home's) and local skills (one robot's) kept apart, so that a robot's own know-how does not leak into everyone's ^rb-dkt1
39. As a robot, I want to create and edit my own local skills freely, so that I can improve how I work ^rb-kkqu
40. As a robot, I want global skills granted to me to be read-only, so that I cannot change what other robots rely on ^rb-krq2
41. As a robot, I want to propose one of my local skills for the global library, so that a good skill can be shared after the owner approves ^rb-lqwr
42. As a person, I want to open, edit, create and delete any skill, global or local, in the UI, so that every skill is editable ^rb-5ku3
43. As a Home admin, I want a sync source to be optional and its skills editable after import, with my edits kept across syncs, so that a source repository never overwrites my changes ^rb-t937

### Mr. Robot

44. As a person, I want Mr. Robot to hold every tool, every login I can reach and every skill without grants, so that the chief of staff can do anything I can ^rb-b0rs
45. As a person, I want Mr. Robot to edit global skills without approval, so that it can maintain the library ^rb-axxy
46. As a person, I want Mr. Robot only to propose grants for other robots and me to approve them, so that the grant gate is not bypassed through Mr. Robot ^rb-598m
47. As a person, I want Mr. Robot created with a sensible compaction instruction, so that it keeps what a chief of staff needs after compaction ^rb-yagl

### Exa and grants

48. As a robot, I want Exa web search, page crawling and code context as a grantable tool group, so that I can research without a browser ^rb-cfvy
49. As a Home admin, I want to store an Exa API key as a Home credential, so that granted robots can use Exa ^rb-x8i3
50. As a person, I want Exa's billable agent runs to be a separate grant, so that a robot cannot start expensive research by accident ^rb-a0x0
51. As a person, I want Exa calls counted in usage and spend limits, so that I see what research costs ^rb-pb26
52. As a person, I want every tool, login and skill off for a new robot until granted, with grants added step by step during setup and later, so that robots do not burn paid services they do not need ^rb-qm74

## Implementation Decisions

### Vocabulary
GLOSSARY.md applies. New words: **Browser backend** (Browser Run, Container Chrome, Container Chrome via VPN; later Host browser), **Login entry** (replaces Secret), **Ask** (any pending decision the robot puts to its owner: grant proposal, question, setup approval, member-file edit), **Global skill** / **Local skill**, **Files view**.

### Browser backends
- One browser-use seam, several backends. The robot's tools, its cookie/storage state, screenshots, live view and takeover are defined once above the seam; a backend only supplies a CDP-speaking Chrome and reports its own usage (minutes, egress) for cost accounting.
- Backend choice: robot setting, defaulting to a Home setting. Changing it takes effect on the next browser open; cookies and storage carry over.
- **Browser Run** stays as implemented. Known limit, documented in the UI: requests carry Cloudflare's Web Bot Auth signature and come from Cloudflare addresses; Cloudflare may later offer a way to mark user-delegated agents, which would be adopted when it exists.
- **Container Chrome**: a Cloudflare Container image with headless Chrome exposing CDP, one container per robot browser session, driven from the Robot DO; sleeps when the browser closes. No Web Bot Auth headers; egress is Cloudflare's.
- **Container Chrome via VPN**: the same image with a userspace WireGuard client (wireproxy) exposing a local SOCKS5 proxy, Chrome started with that proxy; the WireGuard configuration of the owner's Proton VPN (Polish server) is a Home credential. No privileged container needed.
- Block detection: the observe step classifies bot-check and block pages and reports them with the backend name; the robot tells the owner and suggests another backend instead of retrying.
- Evidence: an integration run per backend against Allegro (open listing, add to cart, stop before payment), eZUS login page, one bank login page, the owner's invoicing service; results (passes / blocked / challenged) recorded in the tracker; the Home default is set from them.
- The paid residential-proxy services (Steel, Browserbase) are not built in this round; the seam must not preclude them.

### Live view and takeover
- Opening the takeover window or the live view when no browser session is open starts one on the robot's backend at the last page and restores state; it closes again after the owner hands back and no turn needs it. Takeover suspends wake-ups as today.

### Login entries
- A login entry: name, username, password, one or more website addresses, notes, scope (private or Home), owner. Stored encrypted as secrets are today. Existing secrets migrate to entries (name and password kept, username and websites empty) with their grants.
- Grants are per robot per entry (Mr. Robot excepted).
- Robot tools: list the granted entries matching the current page (name, username, websites — never the password); fill an entry into the current page's username and password fields. Filling happens inside the browser backend, so the password is never returned to the robot's program, never enters the conversation or trajectory. Fill is refused when the current page's address does not match one of the entry's websites (registrable domain match).
- A raw-value read remains only for entries explicitly marked "allow reading" (API keys and the like), masked in the trajectory as now.
- Takeover window: a key button lists matching entries the robot is granted and fills the chosen one.
- UI: a Logins section in the Member's settings with add, edit, reveal, delete, scope and per-robot grant view.

### Asks in the composer
- Every pending ask is rendered in place of the composer, oldest first, with a count when there are several; answering returns the composer. The stream keeps a one-line record of the ask and its answer. Typing is still possible from the ask surface ("reply instead").
- Fixes: composer add button vertically centred; thinking blocks use the full message width.

### Settings and navigation
- Robot list menu: Pin, Mark as unread, Edit profile, Advanced settings, Hide from sidebar.
- Model control becomes a searchable combobox grouped by provider, filtering by model name and provider.
- Tools and skills lists in advanced settings: fixed maximum height, internal scroll.
- Prompt preview drops the duplicated tools list (tools are shown once, in the Tools section).

### Files view
- Per robot, reached from the panel and the robot menu: a tree of the robot's workspace with Persona files and MEMORY.md pinned at the top, daily notes, local skills, other files; open, edit, save. A save by the owner is delivered to the robot as a note at its next turn.

### Skills
- Global skills belong to the Home library; local skills live in the robot's workspace. The library starts empty and no sync source is configured; the anthropics/skills source set on the live deployment is removed together with its skills.
- Robots: read granted global skills (read-only), create and edit their own local skills, propose a local skill for the global library (an ask). Mr. Robot: reads all, edits global skills without approval.
- UI: every skill (global and local) opens in an editor; create and delete for both.
- An optional Git sync source may be configured by the admin; imported skills are editable, and a skill edited in Mr. Robot is marked as locally changed and not overwritten by later syncs.

### Mr. Robot
- Holds every tool, every login entry the Member can reach, every skill, without grants. For other robots it can only propose grants (tools, logins, skills, recipients); the Member approves.
- Default compaction instruction, set at creation and editable:

> Keep, in this order: (1) every open commitment you or the owner made, with its deadline and who is waiting; (2) every robot you created or coordinate, what it is for, and anything you asked of it that has not come back; (3) decisions the owner made and his stated preferences, in his words where possible; (4) the state of each running errand (what is done, what is next, what is blocked and on whom); (5) facts you will need again (accounts, addresses, amounts, dates). Drop chit-chat, retries, tool output you already acted on, and anything already written to MEMORY.md or a robot's files — point to the file instead.

### Exa
- A Mr. Robot plugin provides the Exa tools with the same names and schemas as the owner's desktop plugin (web search, crawling, code context; the agent-run tools as a separate, billable grant), calling the Exa API with the key stored as a Home credential. Two grants: Exa research, Exa agent runs.
- Every Exa call records its cost in usage; counts towards spend limits.

### Grants (restated)
- Every tool, login entry and skill is off for a new robot until granted; setup proposes a minimal set and the robot asks for more as it needs it. Only Mr. Robot is exempt.

## Testing Decisions

Good tests drive the system through the Robot DO API or the edge API and assert on what a user or the robot observes; no assertions on plugin internals.

1. **Robot DO API** (stub LLM, stub browser backend): backend selection and state carry-over (rb-wgtd, rb-ybt4, rb-b3yf, rb-bcui, rb-4n0b), block reporting (rb-kank), usage per backend and Exa (rb-y50l, rb-pb26), takeover opening a browser on demand (rb-keaw, rb-yvct, rb-hq0l), login entries, grants, URL-bound fill, no password in program/trajectory, migration (rb-gq50, rb-4dxe, rb-2myk, rb-ob2g, rb-vpes, rb-e1ic, rb-1dzv, rb-o52a, rb-36g4), asks lifecycle (rb-dat4, rb-r0oj, rb-f5um), file edits and the robot note (rb-1miy, rb-q5eb, rb-xwks), skills global/local permissions and promotion (rb-a70a, rb-dkt1, rb-kkqu, rb-krq2, rb-lqwr, rb-5ku3, rb-t937), Mr. Robot rights and grant proposals (rb-b0rs, rb-axxy, rb-598m, rb-yagl), Exa grants (rb-cfvy, rb-x8i3, rb-a0x0, rb-qm74).
2. **Browser backend integration**, run manually or nightly against the real sites because results depend on others' bot protection: Container Chrome with and without VPN, Browser Run (rb-d59c, rb-wn96, rb-j5ml, rb-rb1x, rb-690z).
3. **PWA component tests** only for the composer with asks, the model combobox, list heights and the file/skill editor (rb-qo0r, rb-14cp, rb-zrac, rb-kzmf, rb-woko, rb-gi08). Phone/PWA testing waits until the web app is usable.
Prior art: the v1 Robot DO tests with stub LLM and stub browser; the staging Browser Rendering run script.

## Out of Scope

Recorded as postponed tickets in this round's tracker, so nothing is lost:
- TOTP codes as a list beside logins (generation is simple; getting the seeds out of existing apps is the work). Polish banks and government use app confirmation or SMS, so it is not urgent.
- Host tools from the owner's computer, as Grok Bot does when its desktop app runs: a connector in this repository registering the computer as a second execution place beside the cloud "box" (box_read, box_write … and host_read, host_write, host_run/bash on the connected computer), usable when the computer is on; it could drive Leash for a real home browser.
- Live screen streaming for a Leash-driven host browser (Leash has no streaming today).
- Paid residential-proxy browser services (Steel, Browserbase) as backends, if Container Chrome via VPN fails on required sites.
- Phone/PWA verification, until the web app is usable.
Items deferred in v1 (Discord, JEV, use-only sharing, groups, containers for shell work) stay deferred as recorded in mr-robot-v1.md.

## Further Notes

- Fact base for the browser decision (2026-10-07): Browser Run requests carry non-removable Signature, Signature-Input and Signature-agent (Web Bot Auth) headers and cf-biso headers and originate from Cloudflare ranges without proxy or rotation; Cloudflare Containers bill per 10 ms with 375 vCPU-minutes and 25 GiB-hours a month included in Workers Paid and 1 TB egress included; Steel bills $0.10 per browser hour and $10/GB residential proxy without subscription; Browserbase starts at $20 a month.
- Priority set by the owner: the browser first; without it robots are pointless.
