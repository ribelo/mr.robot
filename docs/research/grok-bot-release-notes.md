# xAI Grok Bot — Complete Release Notes, 0.17.0 to 0.71.2

Research date: 2026-10-20. Scope: every release note xAI publishes for Grok Bot, oldest to newest, one row per changelog line and in the source's own words, plus what shipped after 0.68.1, which is where [grok-bot-capabilities.md](grok-bot-capabilities.md) stops. The earlier inventory's S16 is this file's S1.

Branding: the changelog, the docs and the news posts title themselves "SpaceXSI"; "SpaceXAI" from the brief does not appear on any page read here. Sign-in, billing and data settings run through Cursor.

State of the changelog when read (2026-10-20 18:24 CEST): header "Latest v0.71.2 · Oct 14, 2026"; 51 entries from 0.17.0 (2026-08-12) to 0.71.2 (2026-10-14); 566 lines in total (130 New, 161 Improved, 275 Fixed); 57 version numbers named (51 entries plus 6 folded into two of them). No entry after 0.71.2.

---

## 1. Sources

| # | Source | URL | What it gave |
|---|--------|-----|--------------|
| S1 | Grok Bot changelog (rendered page) | https://x.ai/changelog/bot | All 51 entries with anchors #v0.17.0 to #v0.71.2, the two printed dates per entry, and the New / Improved / Fixed headings |
| S2 | Grok Bot changelog feed (RSS 2.0) | https://x.ai/changelog/bot/rss.xml | The same 51 entries as HTML bodies plus pubDate; the copy the tables below were built from, and the source of every date |
| S3 | Docs: developer Release Notes | https://docs.x.ai/developers/release-notes#grok-bot | The only Grok Bot item outside the changelog: "August 11 — Grok Bot — Grok Bot is now available. Durable AI teammates that work on a persistent cloud computer, with messaging, approvals, connectors, and routines." |
| S4 | Docs: Tag @bot on X | https://docs.x.ai/grok-bot/tag-on-x | Requirements, availability and reply meanings for @bot tagging on X; corroborates one S13 item |
| S5 | "Introducing Grok Bot" | https://x.ai/news/introducing-grok-bot | 2026-08-11 launch post, beta |
| S6 | "Grok Bot is now included with more plans" | https://x.ai/news/grok-bot-more-plans | 2026-08-26 |
| S7 | "Grok Bot now works with X" | https://x.ai/news/grok-bot-and-x | 2026-08-29 |
| S8 | "Designing Grok Bot for a world of persistent agents" | https://x.ai/news/designing-grok-bot | 2026-09-03 |
| S9 | "Grok Bot for Enterprise" | https://x.ai/news/grok-bot-for-enterprise | 2026-09-03 |
| S10 | "Setting Grok Bot loose on procurement" | https://x.ai/news/grok-bot-procurement | 2026-09-04 |
| S11 | "How SpaceXSI is using Grok Bot to scale customer support" | https://x.ai/news/grok-bot-customer-support | 2026-09-22 |
| S12 | "Team Bots: shared AI teammates that learn as they work" | https://x.ai/news/team-bots | 2026-09-28 |
| S13 | "What's new in Grok Bot — Oct 18, 2026", Matt Palmer, first-party video | https://x.com/mattyp/status/2112550158885917122 | The week of 2026-10-18, which has no changelog entry; transcript at [grok-bot-whats-new-2026-10-18-transcript.md](grok-bot-whats-new-2026-10-18-transcript.md) |

One claim, one source: every row in section 4 names the entry anchor it came from. S2 is the machine-readable copy of S1 and carries the same wording; dates come from S2 pubDate and agree with the header date S1 prints for each entry. S5 to S12 are official news posts but not versioned release notes; they are cited only in section 5 and only for context. S13 is a first-party video, not the changelog.

---

## 2. How this file is built

- One row per changelog line. The wording is copied, not summarised: nothing is merged, split or re-scoped. The changelog renders a trailing badge as a pill after the sentence (Teams, Enterprise) and the feed serialises the same badge as " (Teams)"; rows keep the feed form because it is the text copy. Every line was checked against the page, and all 566 appear there verbatim apart from that badge form.
- The Type column is the changelog's own heading: New, Improved or Fixed. An entry without a New section (0.67.0) has none here either.
- Version is the version in the entry anchor; Date is the entry date in ISO form. The page prints it twice per entry ("October 14, 2026" and "Oct 14, 2026"); the feed gives it as a pubDate at 00:00 GMT. No entry carries a time of day.
- When the source folds several builds into one entry, the entry says so in its "Also includes" line and the lines are not attributed per build, because the source does not say which line shipped in which one.
- Rows are numbered 1 to 566 across the whole file, oldest first, so a row can be cited by number. Version headings run oldest to newest, as the brief asks.
- Nothing here is inferred. Where the changelog is silent, section 7 records the gap instead of filling it.

---

## 3. Version index

| Version | Date | Entry title | New | Improved | Fixed | Rows |
|---|---|---|---|---|---|---|
| — | 2026-08-11 | Grok Bot is now available (launch note, S3, outside the changelog) | — | — | — | — |
| [0.17.0](https://x.ai/changelog/bot#v0.17.0) | 2026-08-12 | More routine triggers and pull request links | 1 | 3 | 5 | 1–9 |
| [0.18.0](https://x.ai/changelog/bot#v0.18.0) | 2026-08-12 | Cancel Trial in Usage & Billing | 1 | — | — | 10–10 |
| [0.19.0](https://x.ai/changelog/bot#v0.19.0) | 2026-08-14 | Manage Plan, scrolling, and Bot naming | 4 | 4 | 3 | 11–21 |
| [0.20.0](https://x.ai/changelog/bot#v0.20.0) | 2026-08-14 | Dictation, formatting, and clearer errors | 2 | 3 | 1 | 22–27 |
| [0.21.0](https://x.ai/changelog/bot#v0.21.0) | 2026-08-19 | App languages, emoji, and webhook routines | 6 | 3 | 3 | 28–39 |
| [0.22.0](https://x.ai/changelog/bot#v0.22.0) | 2026-08-20 | Team setup and translation fixes | — | — | 2 | 40–41 |
| [0.24.0](https://x.ai/changelog/bot#v0.24.0) | 2026-08-21 | Setting links, team sign-in, and voice input | 4 | 2 | 3 | 42–50 |
| [0.25.0](https://x.ai/changelog/bot#v0.25.0) | 2026-08-25 | Multi-select questions and on-demand limits | 5 | 2 | 5 | 51–62 |
| [0.26.0](https://x.ai/changelog/bot#v0.26.0) | 2026-08-25 | App menu, right-to-left typing, and updates | 1 | 3 | 3 | 63–69 |
| [0.27.0](https://x.ai/changelog/bot#v0.27.0) | 2026-08-25 | Pro and SuperGrok access, and webhook data | 1 | 2 | 1 | 70–73 |
| [0.28.0](https://x.ai/changelog/bot#v0.28.0) | 2026-08-26 | Russian, Turkish, Italian, and Swedish | 1 | 1 | 1 | 74–76 |
| [0.29.0](https://x.ai/changelog/bot#v0.29.0) | 2026-08-27 | Computers in Settings and phone replies | 2 | 1 | 1 | 77–80 |
| [0.30.0](https://x.ai/changelog/bot#v0.30.0) | 2026-08-28 | Template sharing, Link purchases, and languages | 8 | 2 | 2 | 81–92 |
| [0.31.0](https://x.ai/changelog/bot#v0.31.0) | 2026-09-01 | Onboarding, team invites, and HTML previews | 6 | 2 | 4 | 93–104 |
| [0.32.0](https://x.ai/changelog/bot#v0.32.0) | 2026-09-01 | International typing and team setup | — | 1 | 1 | 105–106 |
| [0.33.0](https://x.ai/changelog/bot#v0.33.0) | 2026-09-01 | Group Access, team trials, and Link cards | 3 | — | 5 | 107–114 |
| [0.34.0](https://x.ai/changelog/bot#v0.34.0) | 2026-09-01 | Pull request previews and Bots in sections | 2 | 1 | 3 | 115–120 |
| [0.35.0](https://x.ai/changelog/bot#v0.35.0) | 2026-09-02 | Longer tasks, purchases, and shared Bots | — | 2 | 3 | 121–125 |
| [0.36.0](https://x.ai/changelog/bot#v0.36.0) | 2026-09-02 | Copy links, routine chats, and Always allow | 1 | 1 | 2 | 126–129 |
| [0.37.0](https://x.ai/changelog/bot#v0.37.0) | 2026-09-03 | Setup choices, sharing menu, and follow-ups | 2 | 1 | 7 | 130–139 |
| [0.38.0](https://x.ai/changelog/bot#v0.38.0) | 2026-09-03 | Group Access and sidebar names | — | 1 | 1 | 140–141 |
| [0.39.0](https://x.ai/changelog/bot#v0.39.0) | 2026-09-03 | Vietnamese, Indonesian, and greetings | 1 | 4 | 4 | 142–150 |
| [0.40.0](https://x.ai/changelog/bot#v0.40.0) | 2026-09-03 | Enterprise access, languages, and Support menu | 3 | 3 | — | 151–156 |
| [0.41.0](https://x.ai/changelog/bot#v0.41.0) | 2026-09-04 | Bots in the Marketplace and plugin setup | 2 | 2 | 3 | 157–163 |
| [0.44.0](https://x.ai/changelog/bot#v0.44.0) | 2026-09-06 | Chat forms, timestamps, and AutoFill | 3 | 2 | 4 | 164–172 |
| [0.45.0](https://x.ai/changelog/bot#v0.45.0) | 2026-09-08 | Email and Slack drafts, and admin Auto-review | 2 | 1 | 4 | 173–179 |
| [0.46.0](https://x.ai/changelog/bot#v0.46.0) | 2026-09-09 | Usage & Billing and chat renaming | 1 | 1 | 5 | 180–186 |
| [0.48.0](https://x.ai/changelog/bot#v0.48.0) | 2026-09-09 | Multiple accounts and a new Marketplace | 3 | 2 | 2 | 187–193 |
| [0.49.0](https://x.ai/changelog/bot#v0.49.0) | 2026-09-11 | Repository access, search, and file links | 2 | 4 | 3 | 194–202 |
| [0.50.0](https://x.ai/changelog/bot#v0.50.0) | 2026-09-11 | Route web traffic through your computer | 1 | — | 1 | 203–204 |
| [0.51.0](https://x.ai/changelog/bot#v0.51.0) | 2026-09-14 | First Bot setup, routines, and scrolling | 3 | 1 | 3 | 205–211 |
| [0.52.0](https://x.ai/changelog/bot#v0.52.0) | 2026-09-15 | GitHub connection and routine pausing | 1 | 2 | 6 | 212–220 |
| [0.53.0](https://x.ai/changelog/bot#v0.53.0) | 2026-09-15 | 1Password, file uploads, and time zones | 2 | 2 | 5 | 221–229 |
| [0.54.0](https://x.ai/changelog/bot#v0.54.0) | 2026-09-16 | Search, HEIC photos, and 1Password | 1 | 2 | 4 | 230–236 |
| [0.55.0](https://x.ai/changelog/bot#v0.55.0) | 2026-09-16 | Setup Checklist and form filling | — | 2 | 3 | 237–241 |
| [0.56.0](https://x.ai/changelog/bot#v0.56.0) | 2026-09-17 | GitHub, spreadsheets, and clearer approvals | — | 4 | 5 | 242–250 |
| [0.57.0](https://x.ai/changelog/bot#v0.57.0) | 2026-09-18 | Projects and richer link previews | 1 | 6 | 4 | 251–261 |
| [0.58.0](https://x.ai/changelog/bot#v0.58.0) | 2026-09-22 | New languages, sidebar, and accessibility | 2 | 4 | 8 | 262–275 |
| [0.59.0](https://x.ai/changelog/bot#v0.59.0) | 2026-09-25 | Team Secrets and a centered layout | 2 | 4 | 5 | 276–286 |
| [0.60.0](https://x.ai/changelog/bot#v0.60.0) | 2026-09-26 | Outlook drafts and more reliable replies | 1 | 3 | 6 | 287–296 |
| [0.61.0](https://x.ai/changelog/bot#v0.61.0) | 2026-09-26 | Team Bots | 10 | — | 1 | 297–307 |
| [0.62.0](https://x.ai/changelog/bot#v0.62.0) | 2026-09-28 | Quotes, lists, and spell check | 4 | 4 | 7 | 308–322 |
| [0.63.0](https://x.ai/changelog/bot#v0.63.0) | 2026-09-29 | Slack approvals and faster browsing | 2 | 4 | 8 | 323–336 |
| [0.64.0](https://x.ai/changelog/bot#v0.64.0) | 2026-09-30 | Team Bot managers and refreshed avatars | 2 | 3 | — | 337–341 |
| [0.65.0](https://x.ai/changelog/bot#v0.65.0) | 2026-09-30 | Team Bot voice chat and automatic updates | 1 | 3 | 1 | 342–346 |
| [0.66.0](https://x.ai/changelog/bot#v0.66.0) | 2026-10-02 | Proactivity, primary Bot and more reliable updates | 1 | 1 | 3 | 347–351 |
| [0.67.0](https://x.ai/changelog/bot#v0.67.0) | 2026-10-02 | Connect Apps and new working status | — | 6 | 9 | 352–366 |
| [0.68.0](https://x.ai/changelog/bot#v0.68.0) | 2026-10-05 | New languages and computer removal | 4 | 6 | 5 | 367–381 |
| [0.68.1](https://x.ai/changelog/bot#v0.68.1) | 2026-10-07 | Slide decks and Bot-colored chats | 5 | 4 | 7 | 382–397 |
| [0.70.2](https://x.ai/changelog/bot#v0.70.2) | 2026-10-11 | Bot email addresses, X search, and in-chat apps | 14 | 22 | 31 | 398–464 |
| [0.71.2](https://x.ai/changelog/bot#v0.71.2) | 2026-10-14 | Smarter notifications and larger file attachments | 6 | 24 | 72 | 465–566 |

Rows are numbered in this order, so the index doubles as a range map.

The numbering is not contiguous. 0.23.0, 0.42.0, 0.43.0 and 0.47.0 have no entry on the page or in the feed (section 7); 0.69.0 to 0.70.1 are named inside the 0.70.2 entry and 0.71.0 to 0.71.1 inside the 0.71.2 entry, so their lines are counted there.

---

## 4. Release notes, oldest to newest

### v0.17.0 — 2026-08-12 — More routine triggers and pull request links

Source: S1 · https://x.ai/changelog/bot#v0.17.0 · S2 pubDate 2026-08-12.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 1 | 0.17.0 | 2026-08-12 | New | Members with a Standard seat on a self-serve team can use Grok Bot through a linked SuperGrok Heavy subscription. (Teams) | S1 #v0.17.0 |
| 2 | 0.17.0 | 2026-08-12 | Improved | Your Bot can create routines that start from a Microsoft Teams message, a Linear issue, a Sentry alert, or a PagerDuty incident. | S1 #v0.17.0 |
| 3 | 0.17.0 | 2026-08-12 | Improved | Auto-review asks before your Bot runs a task you didn't ask for. | S1 #v0.17.0 |
| 4 | 0.17.0 | 2026-08-12 | Improved | Pull request links open where you or your team chose, or on GitHub if neither has chosen. | S1 #v0.17.0 |
| 5 | 0.17.0 | 2026-08-12 | Fixed | The account row in the sidebar opens the account menu, even during setup. | S1 #v0.17.0 |
| 6 | 0.17.0 | 2026-08-12 | Fixed | Your Bot stops showing that it's working once a background task finishes. | S1 #v0.17.0 |
| 7 | 0.17.0 | 2026-08-12 | Fixed | A connector that stops responding times out after three minutes, so your Bot can carry on. | S1 #v0.17.0 |
| 8 | 0.17.0 | 2026-08-12 | Fixed | Update Grok Bot's Computer finishes and keeps file permissions and shortcuts. | S1 #v0.17.0 |
| 9 | 0.17.0 | 2026-08-12 | Fixed | Choosing a shape or color keeps a picture you added until you press Set avatar. | S1 #v0.17.0 |

### v0.18.0 — 2026-08-12 — Cancel Trial in Usage & Billing

Source: S1 · https://x.ai/changelog/bot#v0.18.0 · S2 pubDate 2026-08-12.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 10 | 0.18.0 | 2026-08-12 | New | You can end a free trial early with Cancel Trial in Usage & Billing, which removes any remaining trial credits. | S1 #v0.18.0 |

### v0.19.0 — 2026-08-14 — Manage Plan, scrolling, and Bot naming

Source: S1 · https://x.ai/changelog/bot#v0.19.0 · S2 pubDate 2026-08-14.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 11 | 0.19.0 | 2026-08-14 | New | Settings has Manage Plan, showing the upgrade options for your account. | S1 #v0.19.0 |
| 12 | 0.19.0 | 2026-08-14 | New | When your included usage runs out, you can upgrade to Ultra or link a SuperGrok Heavy subscription. | S1 #v0.19.0 |
| 13 | 0.19.0 | 2026-08-14 | New | A Scroll to bottom button appears above the message field when you scroll up. | S1 #v0.19.0 |
| 14 | 0.19.0 | 2026-08-14 | New | Settings has Use hardware acceleration under General → System, on by default on a Mac, with Restart to Apply. | S1 #v0.19.0 |
| 15 | 0.19.0 | 2026-08-14 | Improved | Settings, search, and confirmations say Bot instead of Agent. | S1 #v0.19.0 |
| 16 | 0.19.0 | 2026-08-14 | Improved | The message field stays at the bottom of the chat, even when the chat is empty. | S1 #v0.19.0 |
| 17 | 0.19.0 | 2026-08-14 | Improved | Start a computer update from Settings with Update Grok Bot's Computer. | S1 #v0.19.0 |
| 18 | 0.19.0 | 2026-08-14 | Improved | Requests to run a command on your computer hide the command until you choose Show the command. | S1 #v0.19.0 |
| 19 | 0.19.0 | 2026-08-14 | Fixed | Help Center opens the Grok Bot docs. | S1 #v0.19.0 |
| 20 | 0.19.0 | 2026-08-14 | Fixed | ⌘V pastes into a terminal on your Bot's computer. | S1 #v0.19.0 |
| 21 | 0.19.0 | 2026-08-14 | Fixed | Allow, Never, and Deny now clear a stuck request to run commands on your computer. | S1 #v0.19.0 |

### v0.20.0 — 2026-08-14 — Dictation, formatting, and clearer errors

Source: S1 · https://x.ai/changelog/bot#v0.20.0 · S2 pubDate 2026-08-14.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 22 | 0.20.0 | 2026-08-14 | New | Press or hold ⌘D (Ctrl+D on Windows and Linux) to dictate into the message field, and Send message sends the transcript as soon as it's ready. | S1 #v0.20.0 |
| 23 | 0.20.0 | 2026-08-14 | New | Rename a plugin's default account with Edit default account. | S1 #v0.20.0 |
| 24 | 0.20.0 | 2026-08-14 | Improved | Your Bot's computer can hold Shift, Ctrl, Alt, or Command while it clicks, drags, and scrolls. | S1 #v0.20.0 |
| 25 | 0.20.0 | 2026-08-14 | Improved | When a reply fails, Grok Bot explains what happened in plain language. | S1 #v0.20.0 |
| 26 | 0.20.0 | 2026-08-14 | Improved | Your Bot cancels, archives, and unarchives Cloud Agents as soon as you ask. | S1 #v0.20.0 |
| 27 | 0.20.0 | 2026-08-14 | Fixed | Replies show underline, subscript, superscript, and highlight formatting. | S1 #v0.20.0 |

### v0.21.0 — 2026-08-19 — App languages, emoji, and webhook routines

Source: S1 · https://x.ai/changelog/bot#v0.21.0 · S2 pubDate 2026-08-19.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 28 | 0.21.0 | 2026-08-19 | New | Pick the app's language under Appearance, including Simplified and Traditional Chinese, Japanese, Korean, Hindi, Spanish, Portuguese, French, German, and Polish. | S1 #v0.21.0 |
| 29 | 0.21.0 | 2026-08-19 | New | Type : in the message box to pick an emoji, or finish a short name with : to insert it. | S1 #v0.21.0 |
| 30 | 0.21.0 | 2026-08-19 | New | Routines can start from a webhook, with their own Webhook URL and Webhook key. | S1 #v0.21.0 |
| 31 | 0.21.0 | 2026-08-19 | New | Download an attachment from the message menu, or use Download all when a message has several. | S1 #v0.21.0 |
| 32 | 0.21.0 | 2026-08-19 | New | Enterprise admins can save Team Setup scripts on the dashboard that run on every member's Bot computer. (Enterprise) | S1 #v0.21.0 |
| 33 | 0.21.0 | 2026-08-19 | New | Enterprise admins can set a network access policy for their team's Bots from the dashboard. (Enterprise) | S1 #v0.21.0 |
| 34 | 0.21.0 | 2026-08-19 | Improved | Dictation follows your system language, and Enter stops a recording. | S1 #v0.21.0 |
| 35 | 0.21.0 | 2026-08-19 | Improved | Updating or recreating your Bot's computer explains that files and logins stay while installed apps and packages are removed. | S1 #v0.21.0 |
| 36 | 0.21.0 | 2026-08-19 | Improved | Plugins opens with your plugins, category filters, and a Team Plugins section. | S1 #v0.21.0 |
| 37 | 0.21.0 | 2026-08-19 | Fixed | Files search finds files on your Bot's computer, and says Search unavailable when it can't run. | S1 #v0.21.0 |
| 38 | 0.21.0 | 2026-08-19 | Fixed | Grok Bot reconnects to your computer after sleep or a dropped connection, so actions on it keep working. | S1 #v0.21.0 |
| 39 | 0.21.0 | 2026-08-19 | Fixed | When your sign-in expires, Grok Bot asks you to sign in again. | S1 #v0.21.0 |

### v0.22.0 — 2026-08-20 — Team setup and translation fixes

Source: S1 · https://x.ai/changelog/bot#v0.22.0 · S2 pubDate 2026-08-20.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 40 | 0.22.0 | 2026-08-20 | Fixed | Setting up Grok Bot on the dashboard uses the team you selected. (Teams) | S1 #v0.22.0 |
| 41 | 0.22.0 | 2026-08-20 | Fixed | Spanish and French translations of plugin counts, routine schedules, and alert statuses read correctly. | S1 #v0.22.0 |

### v0.24.0 — 2026-08-21 — Setting links, team sign-in, and voice input

Source: S1 · https://x.ai/changelog/bot#v0.24.0 · S2 pubDate 2026-08-21.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 42 | 0.24.0 | 2026-08-21 | New | Hover a settings or plugin title and choose Copy link to share a direct link to it. | S1 #v0.24.0 |
| 43 | 0.24.0 | 2026-08-21 | New | Right-click a video and choose Save video… to keep it. | S1 #v0.24.0 |
| 44 | 0.24.0 | 2026-08-21 | New | If you belong to more than one team, sign-in asks you to pick one. | S1 #v0.24.0 |
| 45 | 0.24.0 | 2026-08-21 | New | Onboarding and the access screen show the email you're signed in with, with Log out. | S1 #v0.24.0 |
| 46 | 0.24.0 | 2026-08-21 | Improved | Voice input detects the language you speak instead of assuming your app or system language. | S1 #v0.24.0 |
| 47 | 0.24.0 | 2026-08-21 | Improved | Sign out explains that it removes the account and its local data from this computer, and your Bots and chats return when you sign in again. | S1 #v0.24.0 |
| 48 | 0.24.0 | 2026-08-21 | Fixed | Today and Yesterday update after midnight, and attachments stay on the day you sent them. | S1 #v0.24.0 |
| 49 | 0.24.0 | 2026-08-21 | Fixed | Links into Grok Bot open the right page instead of only bringing the window forward. | S1 #v0.24.0 |
| 50 | 0.24.0 | 2026-08-21 | Fixed | If you message your Bot while a routine is running, the routine runs again afterward. | S1 #v0.24.0 |

### v0.25.0 — 2026-08-25 — Multi-select questions and on-demand limits

Source: S1 · https://x.ai/changelog/bot#v0.25.0 · S2 pubDate 2026-08-25.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 51 | 0.25.0 | 2026-08-25 | New | When your Bot asks a question that allows several answers, select the ones you want and press Submit. | S1 #v0.25.0 |
| 52 | 0.25.0 | 2026-08-25 | New | On an individual plan, set your monthly on-demand limit to None, Fixed, or Unlimited in Usage & Billing. | S1 #v0.25.0 |
| 53 | 0.25.0 | 2026-08-25 | New | A GitHub routine can watch a single pull request, including when it closes, and removes itself once the pull request merges or closes. | S1 #v0.25.0 |
| 54 | 0.25.0 | 2026-08-25 | New | Download a diagram in the chat as a PNG image. | S1 #v0.25.0 |
| 55 | 0.25.0 | 2026-08-25 | New | Click a Bot mentioned in a conversation to open it. | S1 #v0.25.0 |
| 56 | 0.25.0 | 2026-08-25 | Improved | When your included usage runs out, team members can upgrade to a Premium seat, alongside Ultra and SuperGrok Heavy. | S1 #v0.25.0 |
| 57 | 0.25.0 | 2026-08-25 | Improved | A Bot you delete disappears from the sidebar as soon as you confirm, and you're told if deleting fails. | S1 #v0.25.0 |
| 58 | 0.25.0 | 2026-08-25 | Fixed | Text you paste into the message box stays plain, and anything you type right after sending is kept. | S1 #v0.25.0 |
| 59 | 0.25.0 | 2026-08-25 | Fixed | Messages that start with a link show the rest of their text, and the link stays clickable. | S1 #v0.25.0 |
| 60 | 0.25.0 | 2026-08-25 | Fixed | Grok Bot uses the team you selected for rules, Usage & Billing, and Computers, and switches to a team you can still use if yours is gone. | S1 #v0.25.0 |
| 61 | 0.25.0 | 2026-08-25 | Fixed | Privacy Mode keeps a conversation off your Bot's computer when it must not be stored. | S1 #v0.25.0 |
| 62 | 0.25.0 | 2026-08-25 | Fixed | Your Bot's computer finishes restoring its files, including ones with long names. | S1 #v0.25.0 |

### v0.26.0 — 2026-08-25 — App menu, right-to-left typing, and updates

Source: S1 · https://x.ai/changelog/bot#v0.26.0 · S2 pubDate 2026-08-25.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 63 | 0.26.0 | 2026-08-25 | New | The app menu has Settings…, Check for Updates, and Restart to Update when an update is ready. | S1 #v0.26.0 |
| 64 | 0.26.0 | 2026-08-25 | Improved | Typing in Arabic, Hebrew, and other right-to-left languages starts on the right, and replies that mix directions lay out each paragraph correctly. | S1 #v0.26.0 |
| 65 | 0.26.0 | 2026-08-25 | Improved | Unread Bots appear first in the search palette. | S1 #v0.26.0 |
| 66 | 0.26.0 | 2026-08-25 | Improved | Update Grok Bot's Computer explains when an update only touches the software your Bots run on, so installed apps stay. | S1 #v0.26.0 |
| 67 | 0.26.0 | 2026-08-25 | Fixed | Grok Bot uses the team you picked at sign-in the first time it loads your teams. | S1 #v0.26.0 |
| 68 | 0.26.0 | 2026-08-25 | Fixed | Alerts, feedback, and About open on top of Settings. | S1 #v0.26.0 |
| 69 | 0.26.0 | 2026-08-25 | Fixed | When an update is required, the Update required screen covers the whole window. | S1 #v0.26.0 |

### v0.27.0 — 2026-08-25 — Pro and SuperGrok access, and webhook data

Source: S1 · https://x.ai/changelog/bot#v0.27.0 · S2 pubDate 2026-08-25.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 70 | 0.27.0 | 2026-08-25 | New | Cursor Pro subscribers can now use Grok Bot, as can SuperGrok and X Premium+ subscribers who link their account. | S1 #v0.27.0 |
| 71 | 0.27.0 | 2026-08-25 | Improved | Admin setup on the dashboard shows Enabled once your team finishes setting up Grok Bot. (Teams) | S1 #v0.27.0 |
| 72 | 0.27.0 | 2026-08-25 | Improved | Routines started by a webhook receive the request body, so your Bot can act on what was sent. | S1 #v0.27.0 |
| 73 | 0.27.0 | 2026-08-25 | Fixed | If a chat can't load, Grok Bot says so and offers Retry. | S1 #v0.27.0 |

### v0.28.0 — 2026-08-26 — Russian, Turkish, Italian, and Swedish

Source: S1 · https://x.ai/changelog/bot#v0.28.0 · S2 pubDate 2026-08-26.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 74 | 0.28.0 | 2026-08-26 | New | Grok Bot is available in Russian, Turkish, Italian, and Swedish, and follows your computer's language. | S1 #v0.28.0 |
| 75 | 0.28.0 | 2026-08-26 | Improved | Settings and plugin links your Bot writes show the real name of the setting or plugin. | S1 #v0.28.0 |
| 76 | 0.28.0 | 2026-08-26 | Fixed | Signing in stops waiting after five minutes, so you can try again. | S1 #v0.28.0 |

### v0.29.0 — 2026-08-27 — Computers in Settings and phone replies

Source: S1 · https://x.ai/changelog/bot#v0.29.0 · S2 pubDate 2026-08-27.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 77 | 0.29.0 | 2026-08-27 | New | Settings has a Computer section listing your computers, where you choose Always allow, Ask every time, or Never allow for actions on each one. | S1 #v0.29.0 |
| 78 | 0.29.0 | 2026-08-27 | New | Notifications from the Grok app on your phone show your Bot's reply. | S1 #v0.29.0 |
| 79 | 0.29.0 | 2026-08-27 | Improved | You can drag the details pane wider, up to the chat's minimum width. | S1 #v0.29.0 |
| 80 | 0.29.0 | 2026-08-27 | Fixed | Your Bot's computer starts when you belong to more than one team. | S1 #v0.29.0 |

### v0.30.0 — 2026-08-28 — Template sharing, Link purchases, and languages

Source: S1 · https://x.ai/changelog/bot#v0.30.0 · S2 pubDate 2026-08-28.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 81 | 0.30.0 | 2026-08-28 | New | Share a Bot as a template: choose whether your team or anyone can use it, and others add their own copy from the link. | S1 #v0.30.0 |
| 82 | 0.30.0 | 2026-08-28 | New | When your Bot wants to buy something, a card shows the amount for you to Allow or Deny, then Link completes the payment. | S1 #v0.30.0 |
| 83 | 0.30.0 | 2026-08-28 | New | Team admins choose whether members can share templates publicly or only within the team. (Teams) | S1 #v0.30.0 |
| 84 | 0.30.0 | 2026-08-28 | New | Action Recording on the dashboard records members' Grok Bot actions to your team's audit log. (Enterprise) | S1 #v0.30.0 |
| 85 | 0.30.0 | 2026-08-28 | New | Grok Bot is available in Arabic, Ukrainian, Dutch, Greek, Afrikaans, and Hebrew, with right-to-left layouts for Arabic and Hebrew. | S1 #v0.30.0 |
| 86 | 0.30.0 | 2026-08-28 | New | Command-Shift-V, or Ctrl-Shift-V, pastes text into the message box without formatting. | S1 #v0.30.0 |
| 87 | 0.30.0 | 2026-08-28 | New | You can approve a task on one computer from another computer where you're signed in. | S1 #v0.30.0 |
| 88 | 0.30.0 | 2026-08-28 | New | Enterprise usage settings show a Personal Usage chart of your spend against last month and your limit. (Enterprise) | S1 #v0.30.0 |
| 89 | 0.30.0 | 2026-08-28 | Improved | Jump to lists matching Bots above actions and messages. | S1 #v0.30.0 |
| 90 | 0.30.0 | 2026-08-28 | Improved | Send Feedback lets you ask for a response. | S1 #v0.30.0 |
| 91 | 0.30.0 | 2026-08-28 | Fixed | Pasting an image attaches it as a file, and the cursor stays in view after you paste a long message. | S1 #v0.30.0 |
| 92 | 0.30.0 | 2026-08-28 | Fixed | Your Bot's browser switches to the tab it picks and reloads pages that fail to open. | S1 #v0.30.0 |

### v0.31.0 — 2026-09-01 — Onboarding, team invites, and HTML previews

Source: S1 · https://x.ai/changelog/bot#v0.31.0 · S2 pubDate 2026-09-01.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 93 | 0.31.0 | 2026-09-01 | New | Onboarding asks what you'll be working on most and suggests Bots for that kind of work. | S1 #v0.31.0 |
| 94 | 0.31.0 | 2026-09-01 | New | Team admins can invite their whole team to Grok Bot, or pick specific groups and members. (Teams) | S1 #v0.31.0 |
| 95 | 0.31.0 | 2026-09-01 | New | A Setup Checklist on the dashboard walks admins through plugins, Slack, GitHub, sign-in, and inviting teammates. (Teams) | S1 #v0.31.0 |
| 96 | 0.31.0 | 2026-09-01 | New | Opening an HTML file your Bot made shows a preview, with Source for the code, and links in it open in your browser. | S1 #v0.31.0 |
| 97 | 0.31.0 | 2026-09-01 | New | A Cloud Agent's open button lets you choose Open in Web or Open in Cursor, and remembers your choice. | S1 #v0.31.0 |
| 98 | 0.31.0 | 2026-09-01 | New | When a firewall or VPN blocks your Bot's computer, Grok Bot says it can't reach it and offers Retry. | S1 #v0.31.0 |
| 99 | 0.31.0 | 2026-09-01 | Improved | You can create more than 50 Bots. | S1 #v0.31.0 |
| 100 | 0.31.0 | 2026-09-01 | Improved | Hourly, interval, and daily routines run on a schedule counted from when you create them. | S1 #v0.31.0 |
| 101 | 0.31.0 | 2026-09-01 | Fixed | Files you attach and dictation stay with the Bot you started them in, even if you switch Bots. | S1 #v0.31.0 |
| 102 | 0.31.0 | 2026-09-01 | Fixed | A Cloud Agent your Bot started isn't launched twice when a launch is retried, and your Bot hears when it finishes. | S1 #v0.31.0 |
| 103 | 0.31.0 | 2026-09-01 | Fixed | On Linux, links that open Grok Bot launch the app. | S1 #v0.31.0 |
| 104 | 0.31.0 | 2026-09-01 | Fixed | Images you attach show thumbnails on Windows. | S1 #v0.31.0 |

### v0.32.0 — 2026-09-01 — International typing and team setup

Source: S1 · https://x.ai/changelog/bot#v0.32.0 · S2 pubDate 2026-09-01.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 105 | 0.32.0 | 2026-09-01 | Improved | The team page offers Set up Grok Bot until your team turns it on, then links to a getting started guide and usage. (Teams) | S1 #v0.32.0 |
| 106 | 0.32.0 | 2026-09-01 | Fixed | Typing on your Bot's computer follows your input method, so Korean, Japanese, Chinese, and accented letters come through as you composed them. | S1 #v0.32.0 |

### v0.33.0 — 2026-09-01 — Group Access, team trials, and Link cards

Source: S1 · https://x.ai/changelog/bot#v0.33.0 · S2 pubDate 2026-09-01.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 107 | 0.33.0 | 2026-09-01 | New | Enterprise admins can let every team member use Grok Bot or limit it to specific groups with Group Access. (Enterprise) | S1 #v0.33.0 |
| 108 | 0.33.0 | 2026-09-01 | New | Enterprise admins can start a Grok Bot trial for their team from the dashboard, and Bot settings show when the trial ends. (Enterprise) | S1 #v0.33.0 |
| 109 | 0.33.0 | 2026-09-01 | New | When you approve a purchase, Pay with lets you choose a saved card from your Link wallet. | S1 #v0.33.0 |
| 110 | 0.33.0 | 2026-09-01 | Fixed | Numbered lists keep their numbering when a paragraph sits between items, and line breaks in messages and tables show up. | S1 #v0.33.0 |
| 111 | 0.33.0 | 2026-09-01 | Fixed | A chat that fails to load after a connection problem tries again on its own. | S1 #v0.33.0 |
| 112 | 0.33.0 | 2026-09-01 | Fixed | When you're not on a team, Grok Bot follows your account's privacy setting. | S1 #v0.33.0 |
| 113 | 0.33.0 | 2026-09-01 | Fixed | Moving a Bot into another sidebar section keeps it there. | S1 #v0.33.0 |
| 114 | 0.33.0 | 2026-09-01 | Fixed | A notice tells you when routines were paused while you were away. | S1 #v0.33.0 |

### v0.34.0 — 2026-09-01 — Pull request previews and Bots in sections

Source: S1 · https://x.ai/changelog/bot#v0.34.0 · S2 pubDate 2026-09-01.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 115 | 0.34.0 | 2026-09-01 | New | Pull request links in messages show the number, title, and whether it's open, draft, merged, or closed. | S1 #v0.34.0 |
| 116 | 0.34.0 | 2026-09-01 | New | Your Bot can create a new Bot inside one of your sidebar sections. | S1 #v0.34.0 |
| 117 | 0.34.0 | 2026-09-01 | Improved | Each routine on a shared Bot describes what it does instead of repeating its name. | S1 #v0.34.0 |
| 118 | 0.34.0 | 2026-09-01 | Fixed | The New Bot shortcut closes Search first, so the two no longer stack. | S1 #v0.34.0 |
| 119 | 0.34.0 | 2026-09-01 | Fixed | A Bot's avatar updates in the sidebar as soon as it changes. | S1 #v0.34.0 |
| 120 | 0.34.0 | 2026-09-01 | Fixed | Approving an expired purchase asks for a fresh one, and a new purchase replaces one still waiting for an answer. | S1 #v0.34.0 |

### v0.35.0 — 2026-09-02 — Longer tasks, purchases, and shared Bots

Source: S1 · https://x.ai/changelog/bot#v0.35.0 · S2 pubDate 2026-09-02.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 121 | 0.35.0 | 2026-09-02 | Improved | Your Bot keeps working through long jobs and page-by-page browsing instead of stopping early. | S1 #v0.35.0 |
| 122 | 0.35.0 | 2026-09-02 | Improved | Team admins can send a link that opens Invite Your Team to Grok Bot. (Teams) | S1 #v0.35.0 |
| 123 | 0.35.0 | 2026-09-02 | Fixed | Purchases you decline stay Declined, and unanswered ones are marked Expired. | S1 #v0.35.0 |
| 124 | 0.35.0 | 2026-09-02 | Fixed | Opening a shared Bot again shows its latest version, including its integrations. | S1 #v0.35.0 |
| 125 | 0.35.0 | 2026-09-02 | Fixed | Routines, feedback, and notifications stay on the team you selected. | S1 #v0.35.0 |

### v0.36.0 — 2026-09-02 — Copy links, routine chats, and Always allow

Source: S1 · https://x.ai/changelog/bot#v0.36.0 · S2 pubDate 2026-09-02.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 126 | 0.36.0 | 2026-09-02 | New | Right-click a pull request in the chat to copy its link. | S1 #v0.36.0 |
| 127 | 0.36.0 | 2026-09-02 | Improved | A routine's runs open in their own chat, and Close Chat brings you back. | S1 #v0.36.0 |
| 128 | 0.36.0 | 2026-09-02 | Fixed | Always allow under Execution on this computer now lets your Bot use your computer without asking. | S1 #v0.36.0 |
| 129 | 0.36.0 | 2026-09-02 | Fixed | Hide from sidebar hides every Bot you've selected. | S1 #v0.36.0 |

### v0.37.0 — 2026-09-03 — Setup choices, sharing menu, and follow-ups

Source: S1 · https://x.ai/changelog/bot#v0.37.0 · S2 pubDate 2026-09-03.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 130 | 0.37.0 | 2026-09-03 | New | Setup asks which tools you use every day, including Cursor. | S1 #v0.37.0 |
| 131 | 0.37.0 | 2026-09-03 | New | Enterprise admins see how many days are left in their Grok Bot trial on the dashboard Overview. (Enterprise) | S1 #v0.37.0 |
| 132 | 0.37.0 | 2026-09-03 | Improved | Share as template, Update template, and View template details are in the share menu in the chat header. | S1 #v0.37.0 |
| 133 | 0.37.0 | 2026-09-03 | Fixed | Your Bot's activity stays visible when you send a follow-up while it's still working. | S1 #v0.37.0 |
| 134 | 0.37.0 | 2026-09-03 | Fixed | Chats you've already read stay read after an update. | S1 #v0.37.0 |
| 135 | 0.37.0 | 2026-09-03 | Fixed | A Bot added from a template shows its name only once in the sidebar. | S1 #v0.37.0 |
| 136 | 0.37.0 | 2026-09-03 | Fixed | Allow once works even when Execution on this computer is set to Never allow. | S1 #v0.37.0 |
| 137 | 0.37.0 | 2026-09-03 | Fixed | Only one security-key prompt opens at a time, and closing it keeps it closed. | S1 #v0.37.0 |
| 138 | 0.37.0 | 2026-09-03 | Fixed | Auto-review can ask you to approve Mac automation commands. | S1 #v0.37.0 |
| 139 | 0.37.0 | 2026-09-03 | Fixed | Grok Bot works when your team limits who can use Cloud Agents. | S1 #v0.37.0 |

### v0.38.0 — 2026-09-03 — Group Access and sidebar names

Source: S1 · https://x.ai/changelog/bot#v0.38.0 · S2 pubDate 2026-09-03.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 140 | 0.38.0 | 2026-09-03 | Improved | Manage Group Access sits next to the switch that turns Grok Bot on, and group limits you save apply as soon as it's back on. (Enterprise) | S1 #v0.38.0 |
| 141 | 0.38.0 | 2026-09-03 | Fixed | The sidebar keeps your name when your profile can't be loaded. | S1 #v0.38.0 |

### v0.39.0 — 2026-09-03 — Vietnamese, Indonesian, and greetings

Source: S1 · https://x.ai/changelog/bot#v0.39.0 · S2 pubDate 2026-09-03.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 142 | 0.39.0 | 2026-09-03 | New | Grok Bot is available in Vietnamese and Indonesian. | S1 #v0.39.0 |
| 143 | 0.39.0 | 2026-09-03 | Improved | A new Bot greets you in the language Grok Bot is set to. | S1 #v0.39.0 |
| 144 | 0.39.0 | 2026-09-03 | Improved | The Language list shows each language's name both in your current language and in its own. | S1 #v0.39.0 |
| 145 | 0.39.0 | 2026-09-03 | Improved | Plugin categories appear in your language. | S1 #v0.39.0 |
| 146 | 0.39.0 | 2026-09-03 | Improved | Reopening your Bot's computer keeps showing the last screen until it reconnects. | S1 #v0.39.0 |
| 147 | 0.39.0 | 2026-09-03 | Fixed | Your Bots and their files stay put when your Bot's computer restarts while it can't read them. | S1 #v0.39.0 |
| 148 | 0.39.0 | 2026-09-03 | Fixed | Pausing or deleting a routine also cancels runs that were waiting. | S1 #v0.39.0 |
| 149 | 0.39.0 | 2026-09-03 | Fixed | The account menu keeps showing your weekly usage and accounts when a refresh fails. | S1 #v0.39.0 |
| 150 | 0.39.0 | 2026-09-03 | Fixed | Follow System picks the right Chinese for Cantonese, Traditional or Simplified. | S1 #v0.39.0 |

### v0.40.0 — 2026-09-03 — Enterprise access, languages, and Support menu

Source: S1 · https://x.ai/changelog/bot#v0.40.0 · S2 pubDate 2026-09-03.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 151 | 0.40.0 | 2026-09-03 | New | Grok Bot is now available to every Enterprise team, not only early-access organizations. (Enterprise) | S1 #v0.40.0 |
| 152 | 0.40.0 | 2026-09-03 | New | Grok Bot is available in Urdu, Thai, and Bengali. | S1 #v0.40.0 |
| 153 | 0.40.0 | 2026-09-03 | New | Audit Logs record when Bots are created, when Grok Bot access changes, and team setup changes. (Enterprise) | S1 #v0.40.0 |
| 154 | 0.40.0 | 2026-09-03 | Improved | Help Center, Send Feedback, and About now sit under Support in the account menu, next to Get Grok Bot for mobile. | S1 #v0.40.0 |
| 155 | 0.40.0 | 2026-09-03 | Improved | Creating a Bot shows Creating… on its row while you stay in your current chat. | S1 #v0.40.0 |
| 156 | 0.40.0 | 2026-09-03 | Improved | Card requests say Approve, and a declined, failed, or expired request says no charge was made. | S1 #v0.40.0 |

### v0.41.0 — 2026-09-04 — Bots in the Marketplace and plugin setup

Source: S1 · https://x.ai/changelog/bot#v0.41.0 · S2 pubDate 2026-09-04.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 157 | 0.41.0 | 2026-09-04 | New | The Marketplace now lists Bots you can add as well as plugins, with categories, search, and a page for each Bot. | S1 #v0.41.0 |
| 158 | 0.41.0 | 2026-09-04 | New | Bots made by the Grok Bot team carry a Verified badge in the Marketplace. | S1 #v0.41.0 |
| 159 | 0.41.0 | 2026-09-04 | Improved | While your Bot's computer connects, Connecting shows until the screen is ready. | S1 #v0.41.0 |
| 160 | 0.41.0 | 2026-09-04 | Improved | When Grok Bot access is limited to certain groups, invites explain that they don't grant access and link to Manage Access. (Enterprise) | S1 #v0.41.0 |
| 161 | 0.41.0 | 2026-09-04 | Fixed | Plugin setup shows checkboxes, menus, and number fields when a plugin asks for them, and saved secrets appear as dots. | S1 #v0.41.0 |
| 162 | 0.41.0 | 2026-09-04 | Fixed | Text you type while creating a Bot stays in that Bot's chat. | S1 #v0.41.0 |
| 163 | 0.41.0 | 2026-09-04 | Fixed | Pull request links keep the words you wrote for them. | S1 #v0.41.0 |

### v0.44.0 — 2026-09-06 — Chat forms, timestamps, and AutoFill

Source: S1 · https://x.ai/changelog/bot#v0.44.0 · S2 pubDate 2026-09-06.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 164 | 0.44.0 | 2026-09-06 | New | When your Bot needs something like a sign-in, it asks with a form in the chat and fills the page for you, instead of handing you its computer. | S1 #v0.44.0 |
| 165 | 0.44.0 | 2026-09-06 | New | Hover over a message from your Bot to see when it was sent. | S1 #v0.44.0 |
| 166 | 0.44.0 | 2026-09-06 | New | On a Mac, right-click a text field to use AutoFill. | S1 #v0.44.0 |
| 167 | 0.44.0 | 2026-09-06 | Improved | Requests to use your computer now appear in the chat. | S1 #v0.44.0 |
| 168 | 0.44.0 | 2026-09-06 | Improved | Before sending feedback for you, your Bot asks whether you'd like a reply from the support team. | S1 #v0.44.0 |
| 169 | 0.44.0 | 2026-09-06 | Fixed | Tab inserts a tab in the message box, and multi-line pastes keep their indentation. | S1 #v0.44.0 |
| 170 | 0.44.0 | 2026-09-06 | Fixed | Brief connection problems no longer sign you out or show your computer as disconnected. | S1 #v0.44.0 |
| 171 | 0.44.0 | 2026-09-06 | Fixed | Videos and files from your Bot's computer no longer stop after the first 4 MB. | S1 #v0.44.0 |
| 172 | 0.44.0 | 2026-09-06 | Fixed | When you're signed out, a connection problem no longer covers the sign-in screen. | S1 #v0.44.0 |

### v0.45.0 — 2026-09-08 — Email and Slack drafts, and admin Auto-review

Source: S1 · https://x.ai/changelog/bot#v0.45.0 · S2 pubDate 2026-09-08.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 173 | 0.45.0 | 2026-09-08 | New | Your Bot can write an email or Slack message as a draft for you to review, then Send or Discard it. | S1 #v0.45.0 |
| 174 | 0.45.0 | 2026-09-08 | New | Enterprise admins can require Auto-review and add team-wide Auto-Review Rules; members see it marked Required by your admin. (Enterprise) | S1 #v0.45.0 |
| 175 | 0.45.0 | 2026-09-08 | Improved | After you submit a form, your Bot fills the visible fields, and a page change no longer makes you type them again. | S1 #v0.45.0 |
| 176 | 0.45.0 | 2026-09-08 | Fixed | A new Bot introduces itself instead of leaving the chat empty. | S1 #v0.45.0 |
| 177 | 0.45.0 | 2026-09-08 | Fixed | After you reset your Bot's computer, it's ready as soon as it reconnects, and anything you typed is still there. | S1 #v0.45.0 |
| 178 | 0.45.0 | 2026-09-08 | Fixed | Bots read every message from your other Bots, even when several arrive while they're busy. | S1 #v0.45.0 |
| 179 | 0.45.0 | 2026-09-08 | Fixed | Linux deb and rpm installs show when an update is available and tell you to update through your package manager. | S1 #v0.45.0 |

### v0.46.0 — 2026-09-09 — Usage & Billing and chat renaming

Source: S1 · https://x.ai/changelog/bot#v0.46.0 · S2 pubDate 2026-09-09.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 180 | 0.46.0 | 2026-09-09 | New | Right-click a chat to rename it. | S1 #v0.46.0 |
| 181 | 0.46.0 | 2026-09-09 | Improved | Usage & Billing shows your weekly usage and plan, the chat warns you near your weekly limit, and you can set a monthly on-demand limit. | S1 #v0.46.0 |
| 182 | 0.46.0 | 2026-09-09 | Fixed | Usage & Billing updates your on-demand limit when you come back from adding a payment method. | S1 #v0.46.0 |
| 183 | 0.46.0 | 2026-09-09 | Fixed | Links in an email draft keep their wording when the message is sent. | S1 #v0.46.0 |
| 184 | 0.46.0 | 2026-09-09 | Fixed | When your Bot's computer runs low on memory, closed browser tabs stay closed instead of all reloading. | S1 #v0.46.0 |
| 185 | 0.46.0 | 2026-09-09 | Fixed | Leftover browser tabs no longer ask you to use a security key. | S1 #v0.46.0 |
| 186 | 0.46.0 | 2026-09-09 | Fixed | Your Bot fills a sign-in form even when the page words its labels in a different order. | S1 #v0.46.0 |

### v0.48.0 — 2026-09-09 — Multiple accounts and a new Marketplace

Source: S1 · https://x.ai/changelog/bot#v0.48.0 · S2 pubDate 2026-09-09.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 187 | 0.48.0 | 2026-09-09 | New | Add more than one account and switch between them from the account menu; each keeps its own Bots and data on this computer. | S1 #v0.48.0 |
| 188 | 0.48.0 | 2026-09-09 | New | Add a Bot straight from its row in the Marketplace. | S1 #v0.48.0 |
| 189 | 0.48.0 | 2026-09-09 | New | Enterprise admins with Conversation Insights see their team's top Grok Bot use cases on the Grok Bot page, with a link to the full breakdown. (Enterprise) | S1 #v0.48.0 |
| 190 | 0.48.0 | 2026-09-09 | Improved | The Marketplace has one homepage for plugins and Bots, with featured picks, plugins popular with your team, and categories to browse. | S1 #v0.48.0 |
| 191 | 0.48.0 | 2026-09-09 | Improved | Marketplace search finds plugins, Bots, and categories as you type. | S1 #v0.48.0 |
| 192 | 0.48.0 | 2026-09-09 | Fixed | Connectors that use an API key show Connected once they're connected. | S1 #v0.48.0 |
| 193 | 0.48.0 | 2026-09-09 | Fixed | A link to a Bot that's no longer available says so, and Back returns to the Marketplace. | S1 #v0.48.0 |

### v0.49.0 — 2026-09-11 — Repository access, search, and file links

Source: S1 · https://x.ai/changelog/bot#v0.49.0 · S2 pubDate 2026-09-11.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 194 | 0.49.0 | 2026-09-11 | New | When your Bot needs access to a repository, a card lets you connect GitHub, GitLab, Bitbucket, or Azure DevOps, and the Bot continues once access is granted. | S1 #v0.49.0 |
| 195 | 0.49.0 | 2026-09-11 | New | Click a file path in a message to open that file from your Bot's computer. | S1 #v0.49.0 |
| 196 | 0.49.0 | 2026-09-11 | Improved | Search shows everything in one list, with files, links, and routines appearing once you type. | S1 #v0.49.0 |
| 197 | 0.49.0 | 2026-09-11 | Improved | Pictures and videos open full screen, with download, close, and playback controls. | S1 #v0.49.0 |
| 198 | 0.49.0 | 2026-09-11 | Improved | Your Bot's computer keeps its browser sign-ins when it restarts. | S1 #v0.49.0 |
| 199 | 0.49.0 | 2026-09-11 | Improved | Teammates who aren't admins can invite people to Grok Bot. (Teams) | S1 #v0.49.0 |
| 200 | 0.49.0 | 2026-09-11 | Fixed | Messages keep their paragraph and list line breaks. | S1 #v0.49.0 |
| 201 | 0.49.0 | 2026-09-11 | Fixed | Connecting a service brings you back to Grok Bot, and a declined connection names the service. | S1 #v0.49.0 |
| 202 | 0.49.0 | 2026-09-11 | Fixed | Muted Bots no longer add to the dock badge. | S1 #v0.49.0 |

### v0.50.0 — 2026-09-11 — Route web traffic through your computer

Source: S1 · https://x.ai/changelog/bot#v0.50.0 · S2 pubDate 2026-09-11.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 203 | 0.50.0 | 2026-09-11 | New | Turn on Route egress through this desktop in Settings to send web traffic from your Bot's computer through your own computer instead of the cloud. | S1 #v0.50.0 |
| 204 | 0.50.0 | 2026-09-11 | Fixed | Requests to use your computer keep the command and details open, so you can read them before you answer. | S1 #v0.50.0 |

### v0.51.0 — 2026-09-14 — First Bot setup, routines, and scrolling

Source: S1 · https://x.ai/changelog/bot#v0.51.0 · S2 pubDate 2026-09-14.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 205 | 0.51.0 | 2026-09-14 | New | Setup now creates your first Bot for you. | S1 #v0.51.0 |
| 206 | 0.51.0 | 2026-09-14 | New | You can delete a routine, which also stops its future runs. | S1 #v0.51.0 |
| 207 | 0.51.0 | 2026-09-14 | New | Your Bot can change its own title and the shape and color of its avatar. | S1 #v0.51.0 |
| 208 | 0.51.0 | 2026-09-14 | Improved | Each Bot reopens on the tab you last had open, even after a restart. | S1 #v0.51.0 |
| 209 | 0.51.0 | 2026-09-14 | Fixed | Long conversations scroll all the way back, and you can drag the scrollbar to the top. | S1 #v0.51.0 |
| 210 | 0.51.0 | 2026-09-14 | Fixed | A new account shows the Bot you created, and deleting your last Bot removes it from the list. | S1 #v0.51.0 |
| 211 | 0.51.0 | 2026-09-14 | Fixed | Take over shows the screen your Bot is actually using. | S1 #v0.51.0 |

### v0.52.0 — 2026-09-15 — GitHub connection and routine pausing

Source: S1 · https://x.ai/changelog/bot#v0.52.0 · S2 pubDate 2026-09-15.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 212 | 0.52.0 | 2026-09-15 | New | You can pause a routine and resume it later. | S1 #v0.52.0 |
| 213 | 0.52.0 | 2026-09-15 | Improved | The built-in GitHub connection in the Marketplace shows whether your account is connected, with Connect GitHub when it isn't. | S1 #v0.52.0 |
| 214 | 0.52.0 | 2026-09-15 | Improved | Sidebar rows no longer show the time of the last message, and the collapsed sidebar has a Marketplace shortcut. | S1 #v0.52.0 |
| 215 | 0.52.0 | 2026-09-15 | Fixed | Bots no longer send a second acknowledgment after they've already replied. | S1 #v0.52.0 |
| 216 | 0.52.0 | 2026-09-15 | Fixed | Clicks and typing on your Bot's computer still work when Grok Bot can't check the page first. | S1 #v0.52.0 |
| 217 | 0.52.0 | 2026-09-15 | Fixed | Scrolling sideways in a code block no longer slides the whole message. | S1 #v0.52.0 |
| 218 | 0.52.0 | 2026-09-15 | Fixed | Your Bot's browser no longer offers to save passwords after it signs in. | S1 #v0.52.0 |
| 219 | 0.52.0 | 2026-09-15 | Fixed | Approval cards close when their time runs out. | S1 #v0.52.0 |
| 220 | 0.52.0 | 2026-09-15 | Fixed | Pressing Enter on Update ready restarts to update. | S1 #v0.52.0 |

### v0.53.0 — 2026-09-15 — 1Password, file uploads, and time zones

Source: S1 · https://x.ai/changelog/bot#v0.53.0 · S2 pubDate 2026-09-15.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 221 | 0.53.0 | 2026-09-15 | New | On a Mac, connect 1Password from the Marketplace so your Bot can sign in with your saved logins, asking you first unless you turn on Auto fill. | S1 #v0.53.0 |
| 222 | 0.53.0 | 2026-09-15 | New | Bots can upload files to Google Drive or OneDrive, or attach them to a Gmail draft. | S1 #v0.53.0 |
| 223 | 0.53.0 | 2026-09-15 | Improved | Your Bot's computer uses your time zone, so websites and its clock match where you are. | S1 #v0.53.0 |
| 224 | 0.53.0 | 2026-09-15 | Improved | Click an open image to zoom in, and close the viewer with Escape, the close button, or a click outside the image. | S1 #v0.53.0 |
| 225 | 0.53.0 | 2026-09-15 | Fixed | Stopping your Bot also stops anything still running on its computer. | S1 #v0.53.0 |
| 226 | 0.53.0 | 2026-09-15 | Fixed | Bots fill sign-in fields even when they sit partly off the screen. | S1 #v0.53.0 |
| 227 | 0.53.0 | 2026-09-15 | Fixed | Phone notifications show your Bot's picture. | S1 #v0.53.0 |
| 228 | 0.53.0 | 2026-09-15 | Fixed | You can finish connecting Bitbucket from Grok Bot. | S1 #v0.53.0 |
| 229 | 0.53.0 | 2026-09-15 | Fixed | A Bot created by another Bot now shows up in your sidebar. | S1 #v0.53.0 |

### v0.54.0 — 2026-09-16 — Search, HEIC photos, and 1Password

Source: S1 · https://x.ai/changelog/bot#v0.54.0 · S2 pubDate 2026-09-16.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 230 | 0.54.0 | 2026-09-16 | New | Organization admins can choose Delete VMs and Data under Manage selected to remove members' Grok Bot computers along with their stored data. (Enterprise) | S1 #v0.54.0 |
| 231 | 0.54.0 | 2026-09-16 | Improved | The search palette (Cmd/Ctrl+K) shows matching Bots, settings, actions, and routines before messages; wrap your search in quotes to see every matching message. | S1 #v0.54.0 |
| 232 | 0.54.0 | 2026-09-16 | Improved | A Bot you create from a template greets you in your app language instead of always in English. | S1 #v0.54.0 |
| 233 | 0.54.0 | 2026-09-16 | Fixed | HEIC and HEIF photos, like those from an iPhone, show as images in the conversation, media viewer, and Media tab instead of as file attachments. | S1 #v0.54.0 |
| 234 | 0.54.0 | 2026-09-16 | Fixed | Bots sign in with 1Password on more sites and let 1Password fill one-time codes and passwords instead of asking you to type them. | S1 #v0.54.0 |
| 235 | 0.54.0 | 2026-09-16 | Fixed | The built-in GitHub plugin appears in Marketplace search with a Connect button, and its page lists its tools so you can turn each one off. | S1 #v0.54.0 |
| 236 | 0.54.0 | 2026-09-16 | Fixed | Secret request cards say why a save failed and keep what you typed so you can try again. | S1 #v0.54.0 |

### v0.55.0 — 2026-09-16 — Setup Checklist and form filling

Source: S1 · https://x.ai/changelog/bot#v0.55.0 · S2 pubDate 2026-09-16.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 237 | 0.55.0 | 2026-09-16 | Improved | The Grok Bot dashboard's Setup Checklist groups steps into Recommended and Optional and adds steps for plugins, Slack or Microsoft Teams, and network settings. (Teams) | S1 #v0.55.0 |
| 238 | 0.55.0 | 2026-09-16 | Improved | The About dialog shows when your copy of the app was built, and Copy version info includes the build date. | S1 #v0.55.0 |
| 239 | 0.55.0 | 2026-09-16 | Fixed | Disconnect on the built-in GitHub plugin works even when your Grok Bot computer is unavailable or running an older version. | S1 #v0.55.0 |
| 240 | 0.55.0 | 2026-09-16 | Fixed | When a Bot fills your answers from a chat form into a page, it also fills address and other fields that unlock only when clicked. | S1 #v0.55.0 |
| 241 | 0.55.0 | 2026-09-16 | Fixed | On sign-in pages that keep fields filled while logging you in, the Bot checks whether a 1Password sign-in worked instead of handing you the screen. | S1 #v0.55.0 |

### v0.56.0 — 2026-09-17 — GitHub, spreadsheets, and clearer approvals

Source: S1 · https://x.ai/changelog/bot#v0.56.0 · S2 pubDate 2026-09-17.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 242 | 0.56.0 | 2026-09-17 | Improved | Bots can work with GitHub releases, tags, labels, sub-issues, discussions, and collaborators, create branches, and submit one pull request review covering several files. | S1 #v0.56.0 |
| 243 | 0.56.0 | 2026-09-17 | Improved | Review an action cards say in one sentence what the Bot wants to do and keep the command and reasoning behind View the full request. | S1 #v0.56.0 |
| 244 | 0.56.0 | 2026-09-17 | Improved | Spreadsheet previews let you select cells and ranges, move with the arrow keys, copy with Cmd/Ctrl+C, and show up to 10,000 rows. | S1 #v0.56.0 |
| 245 | 0.56.0 | 2026-09-17 | Improved | When you tell a Bot to stop, it also stops the other Bots it handed work to and the Cloud Agents it started. | S1 #v0.56.0 |
| 246 | 0.56.0 | 2026-09-17 | Fixed | Marketplace shows plugin changes, such as connecting, disconnecting, removing, or signing in, as soon as they finish. | S1 #v0.56.0 |
| 247 | 0.56.0 | 2026-09-17 | Fixed | Routines that watch a single GitHub pull request run only for events on that pull request. | S1 #v0.56.0 |
| 248 | 0.56.0 | 2026-09-17 | Fixed | Changing a Bot's avatar shape and color applies every pick right away, even when you click through them quickly. | S1 #v0.56.0 |
| 249 | 0.56.0 | 2026-09-17 | Fixed | One-time reminder routines show Once with their date and time. | S1 #v0.56.0 |
| 250 | 0.56.0 | 2026-09-17 | Fixed | Bot computers that are asleep apply an admin's latest Network Controls when they next wake. (Enterprise) | S1 #v0.56.0 |

### v0.57.0 — 2026-09-18 — Projects and richer link previews

Source: S1 · https://x.ai/changelog/bot#v0.57.0 · S2 pubDate 2026-09-18.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 251 | 0.57.0 | 2026-09-18 | New | A Bot can start a Project when you ask for one: a Cloud Agent that plans the work and runs its own agents. | S1 #v0.57.0 |
| 252 | 0.57.0 | 2026-09-18 | Improved | Link cards and previews show real titles for private Notion pages, GitHub issues and pull requests, and Slack messages using your connected accounts. | S1 #v0.57.0 |
| 253 | 0.57.0 | 2026-09-18 | Improved | While a Bot's voice memo plays, its transcript highlights each word in sync with the audio, and clicking a word jumps playback there. | S1 #v0.57.0 |
| 254 | 0.57.0 | 2026-09-18 | Improved | Hidden Bots is a collapsible section at the bottom of the sidebar, and a hidden Bot's menu offers Show in sidebar to bring it back. | S1 #v0.57.0 |
| 255 | 0.57.0 | 2026-09-18 | Improved | Messages you send show as sent right away, and a small progress bar appears only if one takes over two seconds to reach the Bot. | S1 #v0.57.0 |
| 256 | 0.57.0 | 2026-09-18 | Improved | A Bot's sidebar menu drops Edit Profile, Duplicate, and template items; use View conversation details to edit the profile and the share menu for templates. | S1 #v0.57.0 |
| 257 | 0.57.0 | 2026-09-18 | Improved | Audit Logs record more Grok Bot activity, including computers, group chats, templates, skills, plugins, routines, and deleting or sharing a Bot. (Enterprise) | S1 #v0.57.0 |
| 258 | 0.57.0 | 2026-09-18 | Fixed | Bots reply to questions they can answer from their own knowledge instead of sometimes stopping without replying. | S1 #v0.57.0 |
| 259 | 0.57.0 | 2026-09-18 | Fixed | A Bot's browser stays connected when other Bots on the same computer use theirs, waits longer for slow pages, and reconnects if it drops. | S1 #v0.57.0 |
| 260 | 0.57.0 | 2026-09-18 | Fixed | A Bot's Waiting for you status in the sidebar clears once it's no longer waiting, instead of getting stuck. | S1 #v0.57.0 |
| 261 | 0.57.0 | 2026-09-18 | Fixed | A Bot's sidebar preview shows its latest message even when it's a form, photo, widget, or approval request, instead of going blank. | S1 #v0.57.0 |

### v0.58.0 — 2026-09-22 — New languages, sidebar, and accessibility

Source: S1 · https://x.ai/changelog/bot#v0.58.0 · S2 pubDate 2026-09-22.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 262 | 0.58.0 | 2026-09-22 | New | You can choose Czech, Danish, Finnish, Hungarian, or Norwegian Bokmål under Language in Settings, and Follow System selects them when your computer uses one. | S1 #v0.58.0 |
| 263 | 0.58.0 | 2026-09-22 | New | With Terminate Inactive Computers on, members' Grok Bot computers are terminated after 30 days without use. (Enterprise) | S1 #v0.58.0 |
| 264 | 0.58.0 | 2026-09-22 | Improved | Search and New chat are round buttons atop the sidebar, Marketplace sits in its footer, and the Bot's name in the chat header opens conversation details. | S1 #v0.58.0 |
| 265 | 0.58.0 | 2026-09-22 | Improved | Grok Bot reconnects faster after sleep or a network change, and brief reconnects or computer updates no longer put a banner across the window. | S1 #v0.58.0 |
| 266 | 0.58.0 | 2026-09-22 | Improved | Action Recording logs more Bot activity, including tool results and handoffs to subagents and cloud agents, and redacts card numbers and access tokens. (Enterprise) | S1 #v0.58.0 |
| 267 | 0.58.0 | 2026-09-22 | Improved | Screen readers announce more of the app, including suggestions, new questions, and message authors, and keyboard focus is visible and stays inside full-screen viewers. | S1 #v0.58.0 |
| 268 | 0.58.0 | 2026-09-22 | Fixed | When a Bot can't reply because of a usage limit, rate limit, or timeout, the chat shows a card that says why. | S1 #v0.58.0 |
| 269 | 0.58.0 | 2026-09-22 | Fixed | Anyone with Grok Bot access can play a Bot's voice memos without being asked to upgrade their plan. | S1 #v0.58.0 |
| 270 | 0.58.0 | 2026-09-22 | Fixed | Auto-review rules you add while a Bot is working, such as with Always allow, stay saved. | S1 #v0.58.0 |
| 271 | 0.58.0 | 2026-09-22 | Fixed | If you hang up a voice chat while a Bot is still working on your request, it finishes and posts the result in the chat. | S1 #v0.58.0 |
| 272 | 0.58.0 | 2026-09-22 | Fixed | A Bot can use a plugin whose only connected account has a label, such as a labeled Outlook account. | S1 #v0.58.0 |
| 273 | 0.58.0 | 2026-09-22 | Fixed | The sidebar keeps your Bots in the same order through reloads and relaunches, and opening a Bot leaves it in place. | S1 #v0.58.0 |
| 274 | 0.58.0 | 2026-09-22 | Fixed | Voice chats use the microphone you choose under Microphone in Settings, and fall back to your default microphone if it's unavailable. | S1 #v0.58.0 |
| 275 | 0.58.0 | 2026-09-22 | Fixed | Bots reconnect to your local computer after a reboot instead of reporting that it isn't connected. | S1 #v0.58.0 |

### v0.59.0 — 2026-09-25 — Team Secrets and a centered layout

Source: S1 · https://x.ai/changelog/bot#v0.59.0 · S2 pubDate 2026-09-25.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 276 | 0.59.0 | 2026-09-25 | New | Expired Auto-review cards offer Always allow this in the future, so you aren't asked about that action again. | S1 #v0.59.0 |
| 277 | 0.59.0 | 2026-09-25 | New | Admins can store Team Secrets on the Grok Bot dashboard, and Team Setup scripts receive them as environment variables. (Enterprise) | S1 #v0.59.0 |
| 278 | 0.59.0 | 2026-09-25 | Improved | When you message a busy Bot, it answers you before working through queued updates from other Bots, Cloud Agents, and background tasks. | S1 #v0.59.0 |
| 279 | 0.59.0 | 2026-09-25 | Improved | On wide windows, chats and the message box stay in a centered column, and wide tables in replies can stretch across it. | S1 #v0.59.0 |
| 280 | 0.59.0 | 2026-09-25 | Improved | Hitting a usage or spend limit shows the full limit banner, with buttons like Upgrade, Set Spend Limit, or Request Upgrade to ask your admins. | S1 #v0.59.0 |
| 281 | 0.59.0 | 2026-09-25 | Improved | Bots use built-in guides with direct links and steps for popular travel, food, shopping, and shipping sites. | S1 #v0.59.0 |
| 282 | 0.59.0 | 2026-09-25 | Fixed | When you send several messages in quick succession, the Bot answers all of them, including the first. | S1 #v0.59.0 |
| 283 | 0.59.0 | 2026-09-25 | Fixed | Bots with a lot of saved memory or skills reply without a several-second pause, and save and forget memories reliably. | S1 #v0.59.0 |
| 284 | 0.59.0 | 2026-09-25 | Fixed | Bot replies in long chats stay visible instead of flickering in and then disappearing when you open or reload the chat. | S1 #v0.59.0 |
| 285 | 0.59.0 | 2026-09-25 | Fixed | When the Bot's computer is briefly unreachable or an automatic computer update fails, chat keeps working without interrupting you with a dialog. | S1 #v0.59.0 |
| 286 | 0.59.0 | 2026-09-25 | Fixed | On Windows, a downloaded update installs when you quit, and on macOS, a failed update install is retried instead of keeping the old version. | S1 #v0.59.0 |

### v0.60.0 — 2026-09-26 — Outlook drafts and more reliable replies

Source: S1 · https://x.ai/changelog/bot#v0.60.0 · S2 pubDate 2026-09-26.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 287 | 0.60.0 | 2026-09-26 | New | Editable email drafts work with Outlook: review a Bot's new email in chat, then choose Send email to send it from your Outlook account. | S1 #v0.60.0 |
| 288 | 0.60.0 | 2026-09-26 | Improved | The sidebar's Marketplace button is now Connect apps, with logos of featured plugins beside it. | S1 #v0.60.0 |
| 289 | 0.60.0 | 2026-09-26 | Improved | Wide tables in Bot messages keep their full layout in narrow windows and scroll sideways instead of squeezing into tall columns. | S1 #v0.60.0 |
| 290 | 0.60.0 | 2026-09-26 | Improved | Emoji reactions on messages arrive with a short animation that pops the emoji into place. | S1 #v0.60.0 |
| 291 | 0.60.0 | 2026-09-26 | Fixed | Bots reply more reliably instead of ending a turn silently, including after using tools or when background work you're waiting on finishes. | S1 #v0.60.0 |
| 292 | 0.60.0 | 2026-09-26 | Fixed | Bot messages show real line breaks and quotation marks instead of stray backslashes, and links at the end of a line open the right page. | S1 #v0.60.0 |
| 293 | 0.60.0 | 2026-09-26 | Fixed | If an unpaid invoice or a plan without Grok Bot stops a Bot's reply, the app and Slack say why instead of a generic error. | S1 #v0.60.0 |
| 294 | 0.60.0 | 2026-09-26 | Fixed | Searching for a Bot by name in New chat, Search, or @mentions finds Bots whose names contain what you typed, with exact matches first. | S1 #v0.60.0 |
| 295 | 0.60.0 | 2026-09-26 | Fixed | When the image provider declines an avatar description, the avatar editor explains why and suggests rewording it. | S1 #v0.60.0 |
| 296 | 0.60.0 | 2026-09-26 | Fixed | Creating a Bot from New chat reliably opens the new Bot instead of sometimes stalling after it's created. | S1 #v0.60.0 |

### v0.61.0 — 2026-09-26 — Team Bots

Source: S1 · https://x.ai/changelog/bot#v0.61.0 · S2 pubDate 2026-09-26.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 297 | 0.61.0 | 2026-09-26 | New | Team Bots let you publish one Bot for your whole team, and teammates chat with it in the app or Slack, each in their own conversation. (Teams) | S1 #v0.61.0 |
| 298 | 0.61.0 | 2026-09-26 | New | Choose Publish to Team in a Bot's Share menu to make a team copy with its chat and memories, or Start fresh; your original Bot stays private. (Teams) | S1 #v0.61.0 |
| 299 | 0.61.0 | 2026-09-26 | New | A new Team Bot walks you through plugins, secrets, skills, and files one card at a time, and only you can see it until you choose Publish to team. (Teams) | S1 #v0.61.0 |
| 300 | 0.61.0 | 2026-09-26 | New | Owners edit a Team Bot's name, description, plugins, secrets, skills, files, and Slack app from its details, and Unpublish takes it away from teammates. (Teams) | S1 #v0.61.0 |
| 301 | 0.61.0 | 2026-09-26 | New | Teammates find Team Bots under Team Bots in New chat, see the ones they add in the sidebar, and get a greeting with Try asking suggestions. (Teams) | S1 #v0.61.0 |
| 302 | 0.61.0 | 2026-09-26 | New | A Team Bot asks before using your connected plugins; Always allow covers that Bot or every Team Bot until you choose Clear connector preferences. (Teams) | S1 #v0.61.0 |
| 303 | 0.61.0 | 2026-09-26 | New | Teammates' use of a Team Bot counts against their own allowance, and the Bot keeps private notes for each person across the app, Slack, and routines. (Teams) | S1 #v0.61.0 |
| 304 | 0.61.0 | 2026-09-26 | New | Team Bots work in Slack: they reply in threads, read channels they've joined, answer workflow mentions, start new posts, and keep links, code, and tables intact. (Teams) | S1 #v0.61.0 |
| 305 | 0.61.0 | 2026-09-26 | New | Ask a Team Bot in Slack to set up, change, pause, or delete your routines; link your Slack account under Settings → General → Team Bots. (Teams) | S1 #v0.61.0 |
| 306 | 0.61.0 | 2026-09-26 | New | Team admins can add a Team Bot for the whole team or chosen groups from Manage team bots on the dashboard, and members can't hide it. (Teams) | S1 #v0.61.0 |
| 307 | 0.61.0 | 2026-09-26 | Fixed | Files a Bot says it's sending you reach the chat more reliably instead of silently going missing. | S1 #v0.61.0 |

### v0.62.0 — 2026-09-28 — Quotes, lists, and spell check

Source: S1 · https://x.ai/changelog/bot#v0.62.0 · S2 pubDate 2026-09-28.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 308 | 0.62.0 | 2026-09-28 | New | Select text in a chat and press Cmd/Ctrl+L, or choose Add to prompt, to quote it in your next message. | S1 #v0.62.0 |
| 309 | 0.62.0 | 2026-09-28 | New | Type - or 1. to start a bulleted or numbered list in the composer; Shift+Enter adds an item, Tab nests it, and Enter still sends. | S1 #v0.62.0 |
| 310 | 0.62.0 | 2026-09-28 | New | Grok Bot underlines misspelled words as you type and offers suggestions and Add to Dictionary on right-click; turn it off with Check Spelling While Typing. | S1 #v0.62.0 |
| 311 | 0.62.0 | 2026-09-28 | New | On the Manage Team Bots page in the dashboard, team admins can search by Bot or creator name and delete a teammate's Team Bot. (Teams) | S1 #v0.62.0 |
| 312 | 0.62.0 | 2026-09-28 | Improved | A Bot's info pane has a Library tab listing the pages, files, and links it has shared, grouped into Today, This week, and Older. | S1 #v0.62.0 |
| 313 | 0.62.0 | 2026-09-28 | Improved | When 1Password isn't connected, Bots ask for site logins with a form in the chat, offering Connect 1Password only if you have the app. | S1 #v0.62.0 |
| 314 | 0.62.0 | 2026-09-28 | Improved | A Team Bot's info pane shows how many plugins, secrets, skills, and files it has, and a Publish to team card once it's ready. (Teams) | S1 #v0.62.0 |
| 315 | 0.62.0 | 2026-09-28 | Improved | When your Slack workspace needs admin approval, the Add to Slack dialog asks you to Send request in Slack before showing Awaiting admin approval. (Teams) | S1 #v0.62.0 |
| 316 | 0.62.0 | 2026-09-28 | Fixed | When a Bot asks you to connect an app in chat, it resumes the task on its own once you finish signing in. | S1 #v0.62.0 |
| 317 | 0.62.0 | 2026-09-28 | Fixed | A message that didn't go through shows Failed to send with Resend and Delete, instead of being stuck on Not delivered yet. | S1 #v0.62.0 |
| 318 | 0.62.0 | 2026-09-28 | Fixed | Desktop and phone notifications arrive as soon as a Bot sends a message, instead of only when it finishes working. | S1 #v0.62.0 |
| 319 | 0.62.0 | 2026-09-28 | Fixed | Emails a Bot sends through Gmail go to the recipients it names, not to a saved draft's original recipients. | S1 #v0.62.0 |
| 320 | 0.62.0 | 2026-09-28 | Fixed | Deleted Bots free their screens on the shared computer, so other Bots' browser actions no longer fail because every screen is taken. | S1 #v0.62.0 |
| 321 | 0.62.0 | 2026-09-28 | Fixed | When a Bot sends several images to Slack, every image is posted, not just the first. | S1 #v0.62.0 |
| 322 | 0.62.0 | 2026-09-28 | Fixed | A Bot stays signed in to websites when its computer's browser restarts. | S1 #v0.62.0 |

### v0.63.0 — 2026-09-29 — Slack approvals and faster browsing

Source: S1 · https://x.ai/changelog/bot#v0.63.0 · S2 pubDate 2026-09-29.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 323 | 0.63.0 | 2026-09-29 | New | In Slack threads, a Bot that needs your approval posts a Review an action card only you can answer, instead of dropping the action. (Teams) | S1 #v0.63.0 |
| 324 | 0.63.0 | 2026-09-29 | New | You can ask a Team Bot in Slack to message one of your own Bots, and the reply comes to you privately in Grok Bot. (Teams) | S1 #v0.63.0 |
| 325 | 0.63.0 | 2026-09-29 | Improved | Adding a plugin that needs sign-in, such as Gmail, from Marketplace starts its sign-in right away instead of stopping at Added. | S1 #v0.63.0 |
| 326 | 0.63.0 | 2026-09-29 | Improved | Bots move through websites faster, with shorter waits for pages to settle after each click or form submission. | S1 #v0.63.0 |
| 327 | 0.63.0 | 2026-09-29 | Improved | Marketplace focuses on plugins: Featured Bots and Bot search results no longer appear, and the search box reads Search plugins. | S1 #v0.63.0 |
| 328 | 0.63.0 | 2026-09-29 | Improved | A Team Bot you own that's ready to publish shows Publish at the top of its details pane, replacing the Publish to team card. (Teams) | S1 #v0.63.0 |
| 329 | 0.63.0 | 2026-09-29 | Fixed | Grok Bot signs in and connects on networks with a TLS-inspecting proxy, using root certificates installed on your computer. | S1 #v0.63.0 |
| 330 | 0.63.0 | 2026-09-29 | Fixed | When you use up your plan's included usage, Grok Bot shows the usage limit notice instead of Bot failed to respond. | S1 #v0.63.0 |
| 331 | 0.63.0 | 2026-09-29 | Fixed | After a Bot says it's on your request and does the work, it sends you the result instead of going quiet. | S1 #v0.63.0 |
| 332 | 0.63.0 | 2026-09-29 | Fixed | Settings → Usage & Billing shows your included usage and when it resets, instead of saying your plan has none. | S1 #v0.63.0 |
| 333 | 0.63.0 | 2026-09-29 | Fixed | A Bot keeps the voice, speed, and language you set for it instead of resetting them to the defaults. | S1 #v0.63.0 |
| 334 | 0.63.0 | 2026-09-29 | Fixed | In the Tasks tab of a Bot's details pane, deleted or expired cloud agent runs leave the Coding list, and stalled statuses show Status unavailable. | S1 #v0.63.0 |
| 335 | 0.63.0 | 2026-09-29 | Fixed | A Bot you create while the app is open shows its latest message preview and unread dot in the sidebar right away. | S1 #v0.63.0 |
| 336 | 0.63.0 | 2026-09-29 | Fixed | Team Bots with names Slack rejects, such as emoji or non-Latin names, can still be added to Slack under a Slack-safe name. (Teams) | S1 #v0.63.0 |

### v0.64.0 — 2026-09-30 — Team Bot managers and refreshed avatars

Source: S1 · https://x.ai/changelog/bot#v0.64.0 · S2 pubDate 2026-09-30.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 337 | 0.64.0 | 2026-09-30 | New | Email and Slack draft cards offer Disable drafts for this Bot, so that Bot sends messages directly; ask the Bot to turn drafts back on. | S1 #v0.64.0 |
| 338 | 0.64.0 | 2026-09-30 | New | The creator of a published Team Bot can add teammates under Managers, who can then change its profile, skills, plugins, secrets, and Slack app. (Teams) | S1 #v0.64.0 |
| 339 | 0.64.0 | 2026-09-30 | Improved | Bot avatars have a refreshed look with bigger eyes, and the avatar editor adds square, sparkle, clover, flower, heart, house, and star shapes. | S1 #v0.64.0 |
| 340 | 0.64.0 | 2026-09-30 | Improved | Links in Bot messages show the site's icon next to the underlined link text. | S1 #v0.64.0 |
| 341 | 0.64.0 | 2026-09-30 | Improved | When a Bot needs a login or other form filled, its chat card opens a Secure Form window showing the site's name and icon. | S1 #v0.64.0 |

### v0.65.0 — 2026-09-30 — Team Bot voice chat and automatic updates

Source: S1 · https://x.ai/changelog/bot#v0.65.0 · S2 pubDate 2026-09-30.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 342 | 0.65.0 | 2026-09-30 | New | Teammates can start a voice chat with a Team Bot, and the call stays in their own conversation with it. (Teams) | S1 #v0.65.0 |
| 343 | 0.65.0 | 2026-09-30 | Improved | Automatic Updates is on by default, so Grok Bot restarts to apply updates while you're away; turn it off in Settings → Updates. | S1 #v0.65.0 |
| 344 | 0.65.0 | 2026-09-30 | Improved | Your phone skips notifications for a Bot you're viewing on your computer, and resumes them once the computer locks, sleeps, or sits idle. | S1 #v0.65.0 |
| 345 | 0.65.0 | 2026-09-30 | Improved | Team Bot setup goes card to card with no Bot messages in between, and each card shows its step, like Step 2 of 5. (Teams) | S1 #v0.65.0 |
| 346 | 0.65.0 | 2026-09-30 | Fixed | When you connect an app, sign-in shows why it failed or that its link expired, and Reopen or Retry starts a fresh sign-in. | S1 #v0.65.0 |

### v0.66.0 — 2026-10-02 — Proactivity, primary Bot and more reliable updates

Source: S1 · https://x.ai/changelog/bot#v0.66.0 · S2 pubDate 2026-10-02.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 347 | 0.66.0 | 2026-10-02 | New | Your primary Bot, marked with a star, will now spot work it can take off your plate and offer to handle it. Requires Grok Bot 0.59.0 or later. | S1 #v0.66.0 |
| 348 | 0.66.0 | 2026-10-02 | Improved | In Slack threads, the Bot's status line shows what it's working on and stays up during long steps. (Teams) | S1 #v0.66.0 |
| 349 | 0.66.0 | 2026-10-02 | Fixed | Update downloads resume after your computer sleeps, and on Mac a copy running from a disk image or Downloads offers Move to Applications. | S1 #v0.66.0 |
| 350 | 0.66.0 | 2026-10-02 | Fixed | A Bot that hangs on an unresponsive command or computer stops itself with a note, and your next message picks up where it left off. | S1 #v0.66.0 |
| 351 | 0.66.0 | 2026-10-02 | Fixed | Your phone notifies you about each Bot reply only once, and never for Bot chats you've deleted. | S1 #v0.66.0 |

### v0.67.0 — 2026-10-02 — Connect Apps and new working status

Source: S1 · https://x.ai/changelog/bot#v0.67.0 · S2 pubDate 2026-10-02.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 352 | 0.67.0 | 2026-10-02 | Improved | Marketplace is now Connect Apps, with category chips under the search, Recommended for you first, and Bot templates on the web. | S1 #v0.67.0 |
| 353 | 0.67.0 | 2026-10-02 | Improved | While a Bot works, its status uses new phrases like Thinking it through and Working on your computer, without the Bot's name in front. | S1 #v0.67.0 |
| 354 | 0.67.0 | 2026-10-02 | Improved | Approval cards show when your Ask first rule paused an action or Always allow added a rule, with Edit rule to change it in Settings. | S1 #v0.67.0 |
| 355 | 0.67.0 | 2026-10-02 | Improved | Connected Google accounts show their email address instead of default on connector cards and in the account list. | S1 #v0.67.0 |
| 356 | 0.67.0 | 2026-10-02 | Improved | On Windows, Use hardware acceleration is now on by default, as on Mac, and a choice you already made is kept. | S1 #v0.67.0 |
| 357 | 0.67.0 | 2026-10-02 | Improved | Copy link on a Team Bot shares an x.ai link, and links you already shared keep working. (Teams) | S1 #v0.67.0 |
| 358 | 0.67.0 | 2026-10-02 | Fixed | Connecting an app finishes even when another app is using its sign-in port, and a failed sign-in page explains why. | S1 #v0.67.0 |
| 359 | 0.67.0 | 2026-10-02 | Fixed | Connector cards that ask you to sign in again, or to add a second account, offer Authorize for that account instead of showing Added. | S1 #v0.67.0 |
| 360 | 0.67.0 | 2026-10-02 | Fixed | When a Gmail reply-all fails, the draft card says Message not delivered instead of showing it as sent. | S1 #v0.67.0 |
| 361 | 0.67.0 | 2026-10-02 | Fixed | Stop in Settings stops every running chat so Update unlocks, and a Settings page that fails after an update offers Restart. | S1 #v0.67.0 |
| 362 | 0.67.0 | 2026-10-02 | Fixed | Routine schedules no longer claim an interval that doesn't repeat, a failed pause or resume shows an error, and deleted routines' chips show (deleted). | S1 #v0.67.0 |
| 363 | 0.67.0 | 2026-10-02 | Fixed | The dock badge no longer counts unread messages from Bots that were deleted. | S1 #v0.67.0 |
| 364 | 0.67.0 | 2026-10-02 | Fixed | On Mac, the Back and Forward buttons on Logitech mice now work. | S1 #v0.67.0 |
| 365 | 0.67.0 | 2026-10-02 | Fixed | Sidebar avatars no longer freeze with one eye bigger than the other. | S1 #v0.67.0 |
| 366 | 0.67.0 | 2026-10-02 | Fixed | When a team admin turns off Route traffic through this computer, Settings → Computer says so, and a failed load of your team's settings offers Retry. (Teams) | S1 #v0.67.0 |

### v0.68.0 — 2026-10-05 — New languages and computer removal

Source: S1 · https://x.ai/changelog/bot#v0.68.0 · S2 pubDate 2026-10-05.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 367 | 0.68.0 | 2026-10-05 | New | Marathi, Tamil, Telugu, Swahili, and Hausa join the Language options in Settings. | S1 #v0.68.0 |
| 368 | 0.68.0 | 2026-10-05 | New | Settings → Computer shows Remove for your other computers, and a removed computer tells you to restart Grok Bot to add it back. | S1 #v0.68.0 |
| 369 | 0.68.0 | 2026-10-05 | New | Email drafts can go out from a verified Gmail send-as address, with a From picker when you have more than one. | S1 #v0.68.0 |
| 370 | 0.68.0 | 2026-10-05 | New | Searching the command palette also finds plugins, and Enter opens the plugin's page. | S1 #v0.68.0 |
| 371 | 0.68.0 | 2026-10-05 | Improved | Approval cards ask whether to allow the Bot by name and quote its instruction, and Settings calls saved rules Custom Rules. | S1 #v0.68.0 |
| 372 | 0.68.0 | 2026-10-05 | Improved | Notifications and the per-Bot notification switch now say the Bot is waiting for you. | S1 #v0.68.0 |
| 373 | 0.68.0 | 2026-10-05 | Improved | Right-click a routine in the details pane for Pause, Resume, Test, Edit, and Delete; clicking a routine no longer opens its detail view. | S1 #v0.68.0 |
| 374 | 0.68.0 | 2026-10-05 | Improved | Hovering a pull request link shows a preview card with its status and title instead of a plain tooltip. | S1 #v0.68.0 |
| 375 | 0.68.0 | 2026-10-05 | Improved | Opening the computer full screen shows the live view right away instead of a second Connecting screen. | S1 #v0.68.0 |
| 376 | 0.68.0 | 2026-10-05 | Improved | The Unassigned section in the sidebar can be dragged, or moved with Move up and Move down, like your own sections. | S1 #v0.68.0 |
| 377 | 0.68.0 | 2026-10-05 | Fixed | Copying or saving a large image, or opening a large JSON or Markdown file, no longer freezes the app. | S1 #v0.68.0 |
| 378 | 0.68.0 | 2026-10-05 | Fixed | Switching chats no longer flashes an empty transcript, and older messages you scrolled back to stay when the app reconnects. | S1 #v0.68.0 |
| 379 | 0.68.0 | 2026-10-05 | Fixed | Gmail draft cards include your signature, logo included, and say Couldn't send this draft when Send doesn't go through. | S1 #v0.68.0 |
| 380 | 0.68.0 | 2026-10-05 | Fixed | Copied replies keep their line breaks and link URLs when you paste them into email, Slack, or plain text. | S1 #v0.68.0 |
| 381 | 0.68.0 | 2026-10-05 | Fixed | Team Bots no longer appear in the primary Bot picker, and a refused change says Team Bots can't be a primary Bot. (Teams) | S1 #v0.68.0 |

### v0.68.1 — 2026-10-07 — Slide decks and Bot-colored chats

Source: S1 · https://x.ai/changelog/bot#v0.68.1 · S2 pubDate 2026-10-07.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 382 | 0.68.1 | 2026-10-07 | New | Your messages in a 1:1 Bot chat take that Bot's color; set Accent to Black in Settings → General to turn it off. Requires Grok Bot 0.64.0 or later. | S1 #v0.68.1 |
| 383 | 0.68.1 | 2026-10-07 | New | Bots can build slide decks with you, showing sample slides to choose from, and deliver them as PowerPoint files or Google Slides. | S1 #v0.68.1 |
| 384 | 0.68.1 | 2026-10-07 | New | Bots can send formatted emails from a draft card, so recipients see headings, bold text, and lists. | S1 #v0.68.1 |
| 385 | 0.68.1 | 2026-10-07 | New | Bots can search your Gmail Spam folder and move a message back to your inbox. | S1 #v0.68.1 |
| 386 | 0.68.1 | 2026-10-07 | New | Team Bots can mention a Slack user group so its members get notified, while @here and @channel still don't ping anyone. (Teams) | S1 #v0.68.1 |
| 387 | 0.68.1 | 2026-10-07 | Improved | Typing / in the composer no longer opens a menu of skills and actions. | S1 #v0.68.1 |
| 388 | 0.68.1 | 2026-10-07 | Improved | Bots work faster on their computer: actions settle sooner, screenshots come back quicker, and new windows skip a five-second wait. | S1 #v0.68.1 |
| 389 | 0.68.1 | 2026-10-07 | Improved | The Bot's computer has a 1920 × 1200 screen, up from 1280 × 800, giving more room when you watch it or take over. | S1 #v0.68.1 |
| 390 | 0.68.1 | 2026-10-07 | Improved | In Slack threads it follows, a Team Bot stays quiet on untagged replies that don't need it, such as emoji-only replies. (Teams) | S1 #v0.68.1 |
| 391 | 0.68.1 | 2026-10-07 | Fixed | Gmail actions fail less often: send and reply no longer report a missing tool, and Bots wait out Google's rate limits. | S1 #v0.68.1 |
| 392 | 0.68.1 | 2026-10-07 | Fixed | Email drafts show up as a card in the chat, a Send cut off by Stop still goes out, and attachments keep their file names. | S1 #v0.68.1 |
| 393 | 0.68.1 | 2026-10-07 | Fixed | The Bot's browser recovers from a crashed tab, handles large uploads, and gives up on a stuck page after 25 seconds. | S1 #v0.68.1 |
| 394 | 0.68.1 | 2026-10-07 | Fixed | Stop or a new message ends a Bot that's stuck on an unresponsive step within about 30 seconds. | S1 #v0.68.1 |
| 395 | 0.68.1 | 2026-10-07 | Fixed | Secure Forms fill into the page the Bot has open, and checkout card fields get a Secure Form instead of a screen handoff. | S1 #v0.68.1 |
| 396 | 0.68.1 | 2026-10-07 | Fixed | When X or Vercel needs you to sign in again, the Bot shows a reconnect card instead of retrying or giving up. | S1 #v0.68.1 |
| 397 | 0.68.1 | 2026-10-07 | Fixed | If the app's window crashes, Grok Bot reloads it instead of leaving it blank. | S1 #v0.68.1 |

### v0.70.2 — 2026-10-11 — Bot email addresses, X search, and in-chat apps

Source: S1 · https://x.ai/changelog/bot#v0.70.2 · S2 pubDate 2026-10-11.
Also includes: 0.69.0, 0.69.1, 0.70.0 and 0.70.1. These builds share the lines below; the source does not split them.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 398 | 0.70.2 | 2026-10-11 | New | Bots can claim their own email address and receive mail there, and email they send from it waits for your approval on a draft card. | S1 #v0.70.2 |
| 399 | 0.70.2 | 2026-10-11 | New | Bots can search X and read posts and profiles without you connecting an X account. | S1 #v0.70.2 |
| 400 | 0.70.2 | 2026-10-11 | New | Connectors that come with an app, such as Figma, Notion, and Canva, can show it as an interactive card in the chat. | S1 #v0.70.2 |
| 401 | 0.70.2 | 2026-10-11 | New | Bots can pay with X Money or Stripe Link. | S1 #v0.70.2 |
| 402 | 0.70.2 | 2026-10-11 | New | Bots can find a Bot template that fits what you describe and link it in the chat. | S1 #v0.70.2 |
| 403 | 0.70.2 | 2026-10-11 | New | On Mac, View Unread in the View menu shows only Bots with unread messages in the sidebar. | S1 #v0.70.2 |
| 404 | 0.70.2 | 2026-10-11 | New | Press Cmd+F or Ctrl+F on an open page to search it in a Find in page bar. | S1 #v0.70.2 |
| 405 | 0.70.2 | 2026-10-11 | New | You can rename a page from its title, and the new name shows everywhere. | S1 #v0.70.2 |
| 406 | 0.70.2 | 2026-10-11 | New | Shared pages have a title bar with Download, which saves a PDF, plus Try Grok Bot for visitors and Share for the owner. | S1 #v0.70.2 |
| 407 | 0.70.2 | 2026-10-11 | New | Adding Glean asks for your Glean MCP URL and connects it after you sign in to Glean in your browser. | S1 #v0.70.2 |
| 408 | 0.70.2 | 2026-10-11 | New | QuickBooks Online is available to connect. | S1 #v0.70.2 |
| 409 | 0.70.2 | 2026-10-11 | New | Bots can save a web page as a PDF from their browser and send audio files such as MP3, M4A, and WAV. | S1 #v0.70.2 |
| 410 | 0.70.2 | 2026-10-11 | New | The full-screen video player has a speed menu, and voice calls offer 0.5x speed. | S1 #v0.70.2 |
| 411 | 0.70.2 | 2026-10-11 | New | Teammates can approve Auto-review requests, including Always allow, from their own direct message with a Team Bot. (Teams) | S1 #v0.70.2 |
| 412 | 0.70.2 | 2026-10-11 | Improved | Before an action it can't undo, such as sending, posting, buying, or deleting, a Bot checks your own messages for approval. | S1 #v0.70.2 |
| 413 | 0.70.2 | 2026-10-11 | Improved | Browser approval cards describe actions in plain words, such as Open a new tab in Grok Bot's browser, and a saved Allow rule applies the same way on every tool. | S1 #v0.70.2 |
| 414 | 0.70.2 | 2026-10-11 | Improved | When more than one account could send an email, the Bot asks which address to use, then tells you the address it sent from. | S1 #v0.70.2 |
| 415 | 0.70.2 | 2026-10-11 | Improved | When a sign-in emails a code or link, the Bot reads it from your connected Gmail or Outlook, or its own inbox, instead of asking you. | S1 #v0.70.2 |
| 416 | 0.70.2 | 2026-10-11 | Improved | After a bank or brokerage connector returns data, the Bot asks before sharing it anywhere else. | S1 #v0.70.2 |
| 417 | 0.70.2 | 2026-10-11 | Improved | Bots acknowledge your message before they start longer work. | S1 #v0.70.2 |
| 418 | 0.70.2 | 2026-10-11 | Improved | Reactions sit on the message bubble, the quick row includes your recent emoji, and each person shows only their latest reaction. | S1 #v0.70.2 |
| 419 | 0.70.2 | 2026-10-11 | Improved | Reply quotes show the quoted text and jump to the replied message when clicked, and selecting text shows an Add to chat pill. | S1 #v0.70.2 |
| 420 | 0.70.2 | 2026-10-11 | Improved | While a Bot works with nothing to report, a 1:1 chat shows just its animated avatar. | S1 #v0.70.2 |
| 421 | 0.70.2 | 2026-10-11 | Improved | While attachments upload, your message shows a Sending… bar that fills as the files upload. | S1 #v0.70.2 |
| 422 | 0.70.2 | 2026-10-11 | Improved | The full-screen computer view opens in Watching until you press Take control. | S1 #v0.70.2 |
| 423 | 0.70.2 | 2026-10-11 | Improved | When a Bot's computer is asleep, the Computer tab shows a Wake button that wakes it in place. | S1 #v0.70.2 |
| 424 | 0.70.2 | 2026-10-11 | Improved | Computer settings separate Your computer from the Bot's computer, and Updates shows only app updates. | S1 #v0.70.2 |
| 425 | 0.70.2 | 2026-10-11 | Improved | Updates to Grok Bot's computer run without status pills in the sidebar; you see a notice only if one leaves the computer unreachable. | S1 #v0.70.2 |
| 426 | 0.70.2 | 2026-10-11 | Improved | After saving a routine, the Bot sums up what it does and who receives the result, and each run delivers there. | S1 #v0.70.2 |
| 427 | 0.70.2 | 2026-10-11 | Improved | When you give a Bot a connector link, it installs the matching plugin from the catalog when there is one. | S1 #v0.70.2 |
| 428 | 0.70.2 | 2026-10-11 | Improved | Connect Apps lists the most-installed plugins first, search also finds plugins whose description matches, and a search with no results says so. | S1 #v0.70.2 |
| 429 | 0.70.2 | 2026-10-11 | Improved | Bots can wait for a background command on their computer to finish, shown as Waiting on results. | S1 #v0.70.2 |
| 430 | 0.70.2 | 2026-10-11 | Improved | When GitHub refuses a repository or Vercel a team, the Bot suggests ones it can reach or asks you to reconnect. | S1 #v0.70.2 |
| 431 | 0.70.2 | 2026-10-11 | Improved | Adding an MCP server on a private Tailscale network now explains that Grok Bot can't reach it yet and suggests exposing it with Tailscale Funnel. | S1 #v0.70.2 |
| 432 | 0.70.2 | 2026-10-11 | Improved | Canvases and documents are both labeled Page. | S1 #v0.70.2 |
| 433 | 0.70.2 | 2026-10-11 | Improved | Typing # in the composer no longer opens the pull request picker. | S1 #v0.70.2 |
| 434 | 0.70.2 | 2026-10-11 | Fixed | Connector calls fail less often: Bots fix wrongly shaped arguments and accept Notion links and Slack channel names before sending. | S1 #v0.70.2 |
| 435 | 0.70.2 | 2026-10-11 | Fixed | When a connector rate-limits your account, Bots wait for the retry delay instead of calling it in a loop. | S1 #v0.70.2 |
| 436 | 0.70.2 | 2026-10-11 | Fixed | With 1Password connected, browser and computer actions retry through brief connection errors instead of stopping. | S1 #v0.70.2 |
| 437 | 0.70.2 | 2026-10-11 | Fixed | Slack, Gmail, and Outlook drafts retry through temporary rate limits and say if they still couldn't send. | S1 #v0.70.2 |
| 438 | 0.70.2 | 2026-10-11 | Fixed | Slack messages a Bot drafts no longer turn into one raw code block when sent. | S1 #v0.70.2 |
| 439 | 0.70.2 | 2026-10-11 | Fixed | Gmail drafts use your default send-as address and add your own signature, not one quoted from someone else. | S1 #v0.70.2 |
| 440 | 0.70.2 | 2026-10-11 | Fixed | Bot emails with non-English names or subjects no longer bounce, replies to them stay in the same thread, and small images in incoming mail are kept. | S1 #v0.70.2 |
| 441 | 0.70.2 | 2026-10-11 | Fixed | When Agent email is off for your team or account, the Bot says so instead of calling it a temporary problem. | S1 #v0.70.2 |
| 442 | 0.70.2 | 2026-10-11 | Fixed | Files and images Bots send from their computer arrive in the chat, ahead of any question card. | S1 #v0.70.2 |
| 443 | 0.70.2 | 2026-10-11 | Fixed | Opening a file while the Bot's computer is asleep wakes it and opens the file. | S1 #v0.70.2 |
| 444 | 0.70.2 | 2026-10-11 | Fixed | When chats, pages, skills, routines, or plugins fail to load, the app shows the error with Try again and keeps what it last loaded. | S1 #v0.70.2 |
| 445 | 0.70.2 | 2026-10-11 | Fixed | Search finds message text and attachment names in all chats, including the open one. | S1 #v0.70.2 |
| 446 | 0.70.2 | 2026-10-11 | Fixed | The open chat is marked read when you relaunch the app, come back to your computer, or click its row again. | S1 #v0.70.2 |
| 447 | 0.70.2 | 2026-10-11 | Fixed | While a Bot searches the web or reads pages, the chat and Slack show what it's doing, such as Digging around, instead of Working in Cursor. | S1 #v0.70.2 |
| 448 | 0.70.2 | 2026-10-11 | Fixed | The Bot's browser keeps downloads under their own file names and starts again after its profile folder is removed. | S1 #v0.70.2 |
| 449 | 0.70.2 | 2026-10-11 | Fixed | Outlook shows its Authorize card when a change needs more permission, and Bots stop retrying on deleted or protected items. | S1 #v0.70.2 |
| 450 | 0.70.2 | 2026-10-11 | Fixed | All-day calendar events stay on the right date, and Bots check your other calendars before saying an event is missing. | S1 #v0.70.2 |
| 451 | 0.70.2 | 2026-10-11 | Fixed | Plugins installed from chat or the web are ready on the Bot's computer, and local plugins such as Xero get the settings you entered. | S1 #v0.70.2 |
| 452 | 0.70.2 | 2026-10-11 | Fixed | Long messages show Show more right away, so opening a chat no longer jumps. | S1 #v0.70.2 |
| 453 | 0.70.2 | 2026-10-11 | Fixed | Publishing, sharing, or deleting a Bot, and adding one from a template, work while its computer is asleep or unreachable. | S1 #v0.70.2 |
| 454 | 0.70.2 | 2026-10-11 | Fixed | Switching chats or focusing the window no longer wakes a sleeping computer. | S1 #v0.70.2 |
| 455 | 0.70.2 | 2026-10-11 | Fixed | Switching accounts lands on the new account within seconds, even when another computer is asleep. | S1 #v0.70.2 |
| 456 | 0.70.2 | 2026-10-11 | Fixed | Pinned Bots stay in sync between the desktop and the phone. | S1 #v0.70.2 |
| 457 | 0.70.2 | 2026-10-11 | Fixed | If the window keeps crashing, Grok Bot offers to reload it or quit, and a window left blank after an update relaunches. | S1 #v0.70.2 |
| 458 | 0.70.2 | 2026-10-11 | Fixed | Bots no longer sign you out of a connector while repairing it, and a connector account you sign out of stays signed out. | S1 #v0.70.2 |
| 459 | 0.70.2 | 2026-10-11 | Fixed | When a model isn't available in your region, the turn stops and explains why, and Bots fall back to Grok. | S1 #v0.70.2 |
| 460 | 0.70.2 | 2026-10-11 | Fixed | In Slack, Bots answer messages whose thread they can't read, and asking a teammate's Bot no longer adds it to your sidebar. | S1 #v0.70.2 |
| 461 | 0.70.2 | 2026-10-11 | Fixed | Connecting Slack from the dashboard on grok.com now brings you back there to finish linking your Slack account. | S1 #v0.70.2 |
| 462 | 0.70.2 | 2026-10-11 | Fixed | In voice calls, the Bot knows today's date in your time zone instead of sometimes using tomorrow's. | S1 #v0.70.2 |
| 463 | 0.70.2 | 2026-10-11 | Fixed | On Linux, the app stays responsive and can quit while a notification is showing. | S1 #v0.70.2 |
| 464 | 0.70.2 | 2026-10-11 | Fixed | Usage & Billing shows your plan name on Current plan, and the usage meter labels its percentage as used. | S1 #v0.70.2 |

### v0.71.2 — 2026-10-14 — Smarter notifications and larger file attachments

Source: S1 · https://x.ai/changelog/bot#v0.71.2 · S2 pubDate 2026-10-14.
Also includes: 0.71.0 and 0.71.1. These builds share the lines below; the source does not split them.

| # | Version | Date | Type | Entry | Source |
|---|---------|------|------|-------|--------|
| 465 | 0.71.2 | 2026-10-14 | New | Bots can send from a tagged form of their email address, like name+shop@, and a routine on that tag runs only for its mail. | S1 #v0.71.2 |
| 466 | 0.71.2 | 2026-10-14 | New | Forms a Bot asks you to fill in can arrive with known fields filled in, and you can edit them before you submit. | S1 #v0.71.2 |
| 467 | 0.71.2 | 2026-10-14 | New | While a paid account merge is still moving this account's data, Settings shows Your accounts are being merged, with Contact Support if it runs long. | S1 #v0.71.2 |
| 468 | 0.71.2 | 2026-10-14 | New | Team admins can turn off Messaging between Bots under Bot capabilities on the dashboard, so members' Bots can't message or hand work to other Bots. (Teams) | S1 #v0.71.2 |
| 469 | 0.71.2 | 2026-10-14 | New | Enterprise team admins can recreate, terminate, or delete members' Grok Bot computers from Manage Bot Computers on the dashboard or through the Admin API. (Enterprise) | S1 #v0.71.2 |
| 470 | 0.71.2 | 2026-10-14 | New | When a Bot's computer runs low on disk, the Bot tells you once, names the biggest files, and deletes them only if you agree. | S1 #v0.71.2 |
| 471 | 0.71.2 | 2026-10-14 | Improved | While you use Grok Bot on a Mac or Windows PC, Bot replies and questions notify you there instead of your phone. Requires Grok Bot 0.70.2 or later. | S1 #v0.71.2 |
| 472 | 0.71.2 | 2026-10-14 | Improved | You can attach files up to 250 MB and videos up to 1 GB, and the Bot says when a video is too large to watch. Requires Grok Bot 0.70.2 or later. | S1 #v0.71.2 |
| 473 | 0.71.2 | 2026-10-14 | Improved | One message can carry up to 20 attachments instead of 6, and a notice says how many weren't added past the 200 MB total. | S1 #v0.71.2 |
| 474 | 0.71.2 | 2026-10-14 | Improved | Images a Bot creates or captures, and files from cloud agents it started, load in the chat while its computer is asleep. | S1 #v0.71.2 |
| 475 | 0.71.2 | 2026-10-14 | Improved | If a voice chat's connection drops, the call reconnects and continues the same conversation instead of ending. | S1 #v0.71.2 |
| 476 | 0.71.2 | 2026-10-14 | Improved | Bots can use up to 200 skills from your installed plugins instead of 24, so skills from plugins you add are no longer left out. | S1 #v0.71.2 |
| 477 | 0.71.2 | 2026-10-14 | Improved | When a Bot's computer is asleep, clicking the Computer is asleep preview wakes it in place, replacing the separate Wake button. | S1 #v0.71.2 |
| 478 | 0.71.2 | 2026-10-14 | Improved | Grok Bot opens while the Bot's computer is still starting, instead of waiting behind a full-window Setting up Grok Bot's computer screen. | S1 #v0.71.2 |
| 479 | 0.71.2 | 2026-10-14 | Improved | Sending while the Bot's computer wakes no longer shows Waiting to send… under your message or Waking your computer… in the message box. | S1 #v0.71.2 |
| 480 | 0.71.2 | 2026-10-14 | Improved | Bots can archive, move, delete, flag, or mark many Outlook messages as read or unread in one step instead of one at a time. | S1 #v0.71.2 |
| 481 | 0.71.2 | 2026-10-14 | Improved | At checkout, Bots use card details or photos you send in chat, asking only for missing fields or a verification code in a Secure Form. | S1 #v0.71.2 |
| 482 | 0.71.2 | 2026-10-14 | Improved | When GitHub can't see a repository, the Bot stops retrying and gives you a link to the GitHub page where you grant access. | S1 #v0.71.2 |
| 483 | 0.71.2 | 2026-10-14 | Improved | Bot searches on X with date limits, minimum likes or reposts, or filters X doesn't support now return posts instead of being rejected. | S1 #v0.71.2 |
| 484 | 0.71.2 | 2026-10-14 | Improved | When a Bot asks you to choose with a question card, it no longer repeats the question and options in a message beside it. | S1 #v0.71.2 |
| 485 | 0.71.2 | 2026-10-14 | Improved | Email drafts from a Bot's own address show attachments as file cards, marked when they can't be sent, changed since attached, are too large, or weren't scanned. | S1 #v0.71.2 |
| 486 | 0.71.2 | 2026-10-14 | Improved | Merging accounts finishes when both accounts have files on the Bot's computer, keeping both sets and adding (from transferred account) to clashing file names. | S1 #v0.71.2 |
| 487 | 0.71.2 | 2026-10-14 | Improved | In Team Bot Slack setup, Connect goes straight to Slack, Awaiting admin approval offers Resubmit, and a denied request shows when it was denied. (Teams) | S1 #v0.71.2 |
| 488 | 0.71.2 | 2026-10-14 | Improved | When a Team Bot asks to use your connected account, the card explains the access covers only your own messages and others can't use it. (Teams) | S1 #v0.71.2 |
| 489 | 0.71.2 | 2026-10-14 | Improved | Captions in the full-screen image viewer show formatting and clickable links, and images keep their size as you page between them. | S1 #v0.71.2 |
| 490 | 0.71.2 | 2026-10-14 | Improved | In a Bot's info pane, the name reads as plain text until you hover or click to rename it, and screen readers announce it as editable. | S1 #v0.71.2 |
| 491 | 0.71.2 | 2026-10-14 | Improved | On approval cards, the rule under labels such as Paused by your Ask first rule shows as plain text, without a box or quotation marks. | S1 #v0.71.2 |
| 492 | 0.71.2 | 2026-10-14 | Improved | Animated Bot avatars in the sidebar and a chat's activity line move more smoothly. | S1 #v0.71.2 |
| 493 | 0.71.2 | 2026-10-14 | Improved | When GitHub isn't connected, the Bot offers a single Connect GitHub action instead of listing every GitHub tool. | S1 #v0.71.2 |
| 494 | 0.71.2 | 2026-10-14 | Improved | A voice call from your phone wakes the Bot's sleeping computer, so the Bot can work with what you said after the call. | S1 #v0.71.2 |
| 495 | 0.71.2 | 2026-10-14 | Fixed | While the Bot's computer is asleep, Grok Bot keeps what it loaded and says Your computer is asleep instead of showing Couldn't refresh or connection errors. | S1 #v0.71.2 |
| 496 | 0.71.2 | 2026-10-14 | Fixed | When the Bot's computer updates, a working Bot reconnects to the new computer and keeps going. | S1 #v0.71.2 |
| 497 | 0.71.2 | 2026-10-14 | Fixed | When the Bot's computer fails to wake, the Bot says it couldn't start instead of retrying as if it were still starting up. | S1 #v0.71.2 |
| 498 | 0.71.2 | 2026-10-14 | Fixed | Images and files a Bot shares from its computer still load in the chat when the app can't fetch them from that computer directly. | S1 #v0.71.2 |
| 499 | 0.71.2 | 2026-10-14 | Fixed | Opening a file right after you send it shows its contents instead of File unavailable. | S1 #v0.71.2 |
| 500 | 0.71.2 | 2026-10-14 | Fixed | When the server fails an attachment upload, Grok Bot says Couldn't upload an attachment and keeps your draft, instead of asking you to check your connection. | S1 #v0.71.2 |
| 501 | 0.71.2 | 2026-10-14 | Fixed | When your computer sleeps, Bots treat it as disconnected within two minutes and say so right away, instead of waiting for commands to time out. | S1 #v0.71.2 |
| 502 | 0.71.2 | 2026-10-14 | Fixed | After a Wi-Fi, VPN, or other network change, Bots can run tasks on your computer right away instead of finding it unreachable. | S1 #v0.71.2 |
| 503 | 0.71.2 | 2026-10-14 | Fixed | Commands a Bot runs on your computer keep going through brief connection stalls and long waits instead of failing as temporarily unreachable. | S1 #v0.71.2 |
| 504 | 0.71.2 | 2026-10-14 | Fixed | If work is meant for one of your computers that's offline, the Bot tells you instead of running it on another computer without asking. | S1 #v0.71.2 |
| 505 | 0.71.2 | 2026-10-14 | Fixed | Background jobs a Bot starts on your Mac, such as a local server, keep running after the command returns. | S1 #v0.71.2 |
| 506 | 0.71.2 | 2026-10-14 | Fixed | Plugin and Auto-review settings changes keep reaching the Bot's computer after Grok Bot reconnects, instead of stalling until a restart. | S1 #v0.71.2 |
| 507 | 0.71.2 | 2026-10-14 | Fixed | When a Bot asks to wait on a command longer than the time limit, it's told the limit right away instead of timing out. | S1 #v0.71.2 |
| 508 | 0.71.2 | 2026-10-14 | Fixed | When a safety check blocks a Bot's reply, the chat shows Blocked by a safety check and Try a different message instead of a generic error. | S1 #v0.71.2 |
| 509 | 0.71.2 | 2026-10-14 | Fixed | Tables in Bot replies stay within the reply's width and scroll sideways when they need more room. | S1 #v0.71.2 |
| 510 | 0.71.2 | 2026-10-14 | Fixed | Attachments in one message that share a file name are numbered, such as report.pdf (2), so you can open or remove the right one. | S1 #v0.71.2 |
| 511 | 0.71.2 | 2026-10-14 | Fixed | On Windows, pasting text copied from a list into the message box keeps it inline instead of splitting it into extra paragraphs. | S1 #v0.71.2 |
| 512 | 0.71.2 | 2026-10-14 | Fixed | On Windows and Linux, text copied from a chat pastes into other apps with non-English characters and curly quotes intact. | S1 #v0.71.2 |
| 513 | 0.71.2 | 2026-10-14 | Fixed | Opening Grok Bot to a restored chat no longer flashes a Couldn't refresh bar above the message box. | S1 #v0.71.2 |
| 514 | 0.71.2 | 2026-10-14 | Fixed | Switching accounts or signing back in shows the app's loading frame instead of a blank white window. | S1 #v0.71.2 |
| 515 | 0.71.2 | 2026-10-14 | Fixed | Switching accounts while a queued message is canceled or refused no longer puts its text and attachments in the other account's message box. | S1 #v0.71.2 |
| 516 | 0.71.2 | 2026-10-14 | Fixed | Accounts without Grok Bot access finish setup and see just the access notice, without setup or load errors. | S1 #v0.71.2 |
| 517 | 0.71.2 | 2026-10-14 | Fixed | When the Bot you had open is deleted on another device, Grok Bot opens another of your Bots instead of an empty pane. | S1 #v0.71.2 |
| 518 | 0.71.2 | 2026-10-14 | Fixed | Deleting several Bots at once still deletes the rest when one fails, and the alert names only the Bot that failed. | S1 #v0.71.2 |
| 519 | 0.71.2 | 2026-10-14 | Fixed | Sidebar section changes that can't be saved stay put with Can't reach your computer and Retry, then save once your computer is reachable. | S1 #v0.71.2 |
| 520 | 0.71.2 | 2026-10-14 | Fixed | In the collapsed sidebar, a Bot list that can't load shows a warning icon with retry instead of text squeezed letter by letter. | S1 #v0.71.2 |
| 521 | 0.71.2 | 2026-10-14 | Fixed | The full-screen computer view no longer shows a cut-off snippet of a subagent's instructions or a Couldn't load subagents line. | S1 #v0.71.2 |
| 522 | 0.71.2 | 2026-10-14 | Fixed | When a Bot's routines fail to load, Couldn't load routines appears inside the Routines section of its details pane. | S1 #v0.71.2 |
| 523 | 0.71.2 | 2026-10-14 | Fixed | With the details pane open and no Bot selected, a failed primary Bot load shows Couldn't load and Try again. | S1 #v0.71.2 |
| 524 | 0.71.2 | 2026-10-14 | Fixed | When a Bot's skills can't be loaded, the @ menu no longer shows a Couldn't load skills row. | S1 #v0.71.2 |
| 525 | 0.71.2 | 2026-10-14 | Fixed | The sidebar's number shortcut badges no longer stay on screen after you change zoom with Cmd or Ctrl. | S1 #v0.71.2 |
| 526 | 0.71.2 | 2026-10-14 | Fixed | In the collapsed sidebar, the More unreads button is a circle with its arrow centered. | S1 #v0.71.2 |
| 527 | 0.71.2 | 2026-10-14 | Fixed | When you drag Bots or sections in the sidebar, screen readers announce their names and where they land. | S1 #v0.71.2 |
| 528 | 0.71.2 | 2026-10-14 | Fixed | Screen readers announce a Bot's reply even when it arrives after the announcement that the Bot stopped. | S1 #v0.71.2 |
| 529 | 0.71.2 | 2026-10-14 | Fixed | When you Tab to a link and its preview card opens, keyboard focus moves into the card. | S1 #v0.71.2 |
| 530 | 0.71.2 | 2026-10-14 | Fixed | When a Bot changes a routine while the app is briefly disconnected, the Routines list updates once it reconnects, without a reload. | S1 #v0.71.2 |
| 531 | 0.71.2 | 2026-10-14 | Fixed | After onboarding creates your primary Bot, the Introducing your primary Bot chooser no longer asks you to pick one again. | S1 #v0.71.2 |
| 532 | 0.71.2 | 2026-10-14 | Fixed | After you answer a request to use your computer, the Bot's sidebar row shows Allowed, Denied, or Expired instead of Permission required. | S1 #v0.71.2 |
| 533 | 0.71.2 | 2026-10-14 | Fixed | When you pause and keep talking in a voice chat, the transcript extends your line instead of repeating it, and leaves out noise tags. | S1 #v0.71.2 |
| 534 | 0.71.2 | 2026-10-14 | Fixed | Connector calls no longer time out after one minute: they wait up to two minutes for a reply, and longer while the connector reports progress. | S1 #v0.71.2 |
| 535 | 0.71.2 | 2026-10-14 | Fixed | Bots see the full parameters of tools on connectors from Grok, so they call those tools correctly instead of guessing. | S1 #v0.71.2 |
| 536 | 0.71.2 | 2026-10-14 | Fixed | Bots hit X's rate limit less often when searching X or reading posts, and a rate-limited call no longer counts toward your X read limit. | S1 #v0.71.2 |
| 537 | 0.71.2 | 2026-10-14 | Fixed | Bots work with a specific Stripe customer, invoice, subscription, or payment on the first try instead of hitting a missing parameter error. | S1 #v0.71.2 |
| 538 | 0.71.2 | 2026-10-14 | Fixed | Stop also ends a Bot's background subagents, so their results no longer wake the Bot afterward, and their pending approval cards expire. | S1 #v0.71.2 |
| 539 | 0.71.2 | 2026-10-14 | Fixed | When you hand the Bot's computer back with I'm done or Skip, the Bot posts its answer in the chat instead of sometimes staying silent. | S1 #v0.71.2 |
| 540 | 0.71.2 | 2026-10-14 | Fixed | Scripts a Bot runs in its browser no longer fail over extra or out-of-range settings, so browser tasks finish more often. | S1 #v0.71.2 |
| 541 | 0.71.2 | 2026-10-14 | Fixed | Secure Form fills fields on more websites, including inside embedded frames from other sites, instead of leaving them empty. | S1 #v0.71.2 |
| 542 | 0.71.2 | 2026-10-14 | Fixed | When a routine needs to sign in to a site, it asks you in chat at that step instead of quietly stopping. | S1 #v0.71.2 |
| 543 | 0.71.2 | 2026-10-14 | Fixed | Bots ask for logins and other multi-field details on one Secure Form instead of a secret request card that holds a single value. | S1 #v0.71.2 |
| 544 | 0.71.2 | 2026-10-14 | Fixed | Screenshot, computer, and browser actions keep working when you haven't connected 1Password, instead of failing on a saved-login check. | S1 #v0.71.2 |
| 545 | 0.71.2 | 2026-10-14 | Fixed | Messaging from another time zone updates the zone the Bot uses for schedules and reminders right away, unless you chose one under Timezone in Settings. | S1 #v0.71.2 |
| 546 | 0.71.2 | 2026-10-14 | Fixed | Bots with any shape the avatar editor offers, such as sparkle or star, can be shared as templates without the Bot changing its look. | S1 #v0.71.2 |
| 547 | 0.71.2 | 2026-10-14 | Fixed | Emails that arrive in a Bot's own inbox keep each link's web address, so the Bot can open verification and sign-in links. | S1 #v0.71.2 |
| 548 | 0.71.2 | 2026-10-14 | Fixed | Email sent to a Bot's own address arrives even when its subject, sender address, or thread references are very long. | S1 #v0.71.2 |
| 549 | 0.71.2 | 2026-10-14 | Fixed | After you choose Disable drafts for a Bot, it sends email from its own address right away, without a draft card. | S1 #v0.71.2 |
| 550 | 0.71.2 | 2026-10-14 | Fixed | After a Bot claims an email address, opening Email or Plugins shows it as Connected instead of still offering Connect. | S1 #v0.71.2 |
| 551 | 0.71.2 | 2026-10-14 | Fixed | When you allow a Team Bot to use one of your plugins, its tools work right away instead of the Bot failing to find them. (Teams) | S1 #v0.71.2 |
| 552 | 0.71.2 | 2026-10-14 | Fixed | Plugins on a Team Bot use the settings your team admin entered, such as a Datadog site, when the Bot has none of its own. (Teams) | S1 #v0.71.2 |
| 553 | 0.71.2 | 2026-10-14 | Fixed | A Team Bot still named New team bot with no description shows Draft, not Published to your team, until you rename it or add a description. (Teams) | S1 #v0.71.2 |
| 554 | 0.71.2 | 2026-10-14 | Fixed | Grok Bot works under your selected team even when another team you're on uses Privacy Mode (Legacy), as long as the selected team doesn't. | S1 #v0.71.2 |
| 555 | 0.71.2 | 2026-10-14 | Fixed | Account merges that move many Bots finish in one go instead of failing and showing Your account merge is taking longer than usual. | S1 #v0.71.2 |
| 556 | 0.71.2 | 2026-10-14 | Fixed | When a downloaded update is withdrawn, Restart to Update goes away and Grok Bot keeps your current version, even when you quit on a Mac. | S1 #v0.71.2 |
| 557 | 0.71.2 | 2026-10-14 | Fixed | An update download that keeps restarting from the beginning waits between tries and then stops with an error instead of retrying nonstop. | S1 #v0.71.2 |
| 558 | 0.71.2 | 2026-10-14 | Fixed | When the update server sends a broken response, Settings says The update server returned an invalid response instead of blaming your connection. | S1 #v0.71.2 |
| 559 | 0.71.2 | 2026-10-14 | Fixed | Restart to Update shows Restarting… and waits up to two minutes for commands a Bot is running on your computer to finish. | S1 #v0.71.2 |
| 560 | 0.71.2 | 2026-10-14 | Fixed | When an update replaces Grok Bot's files while it runs, reloading or crash recovery relaunches the app instead of showing a blank window. | S1 #v0.71.2 |
| 561 | 0.71.2 | 2026-10-14 | Fixed | On Linux deb and rpm installs, Update required links the latest package, leading with it when the package repository doesn't have the update yet. | S1 #v0.71.2 |
| 562 | 0.71.2 | 2026-10-14 | Fixed | On Windows and Linux, opening Grok Bot while it's still quitting reopens it after the quit instead of leaving nothing open. | S1 #v0.71.2 |
| 563 | 0.71.2 | 2026-10-14 | Fixed | GitHub tools stay available after a connection block and work once you reconnect, without starting a new chat. | S1 #v0.71.2 |
| 564 | 0.71.2 | 2026-10-14 | Fixed | When Gmail refuses to open a full thread, the Bot still answers from the thread's first message. | S1 #v0.71.2 |
| 565 | 0.71.2 | 2026-10-14 | Fixed | A connector that still needs Allow keeps its name, so the Bot asks you to allow it instead of saying it can't find it. | S1 #v0.71.2 |
| 566 | 0.71.2 | 2026-10-14 | Fixed | A Bot keeps its connector tools while its computer is asleep, starting up, or not created yet, instead of losing them for that turn. | S1 #v0.71.2 |

---

## 5. After 0.68.1 (2026-10-07)

Two entries follow the cut-off of the earlier inventory, and they are walked in section 4 like the rest. Nothing else was published after them.

| Version | Date | Entry title | Builds folded into it |
|---|---|---|---|
| 0.70.2 | 2026-10-11 | Bot email addresses, X search, and in-chat apps | 0.69.0, 0.69.1, 0.70.0, 0.70.1 |
| 0.71.2 | 2026-10-14 | Smarter notifications and larger file attachments | 0.71.0, 0.71.1 |

The New lines of those two entries, verbatim, so the delta can be scanned without the full tables:

| Version | Entry | Source |
|---|---|---|
| 0.70.2 | Bots can claim their own email address and receive mail there, and email they send from it waits for your approval on a draft card. | S1 #v0.70.2 |
| 0.70.2 | Bots can search X and read posts and profiles without you connecting an X account. | S1 #v0.70.2 |
| 0.70.2 | Connectors that come with an app, such as Figma, Notion, and Canva, can show it as an interactive card in the chat. | S1 #v0.70.2 |
| 0.70.2 | Bots can pay with X Money or Stripe Link. | S1 #v0.70.2 |
| 0.70.2 | Bots can find a Bot template that fits what you describe and link it in the chat. | S1 #v0.70.2 |
| 0.70.2 | On Mac, View Unread in the View menu shows only Bots with unread messages in the sidebar. | S1 #v0.70.2 |
| 0.70.2 | Press Cmd+F or Ctrl+F on an open page to search it in a Find in page bar. | S1 #v0.70.2 |
| 0.70.2 | You can rename a page from its title, and the new name shows everywhere. | S1 #v0.70.2 |
| 0.70.2 | Shared pages have a title bar with Download, which saves a PDF, plus Try Grok Bot for visitors and Share for the owner. | S1 #v0.70.2 |
| 0.70.2 | Adding Glean asks for your Glean MCP URL and connects it after you sign in to Glean in your browser. | S1 #v0.70.2 |
| 0.70.2 | QuickBooks Online is available to connect. | S1 #v0.70.2 |
| 0.70.2 | Bots can save a web page as a PDF from their browser and send audio files such as MP3, M4A, and WAV. | S1 #v0.70.2 |
| 0.70.2 | The full-screen video player has a speed menu, and voice calls offer 0.5x speed. | S1 #v0.70.2 |
| 0.70.2 | Teammates can approve Auto-review requests, including Always allow, from their own direct message with a Team Bot. (Teams) | S1 #v0.70.2 |
| 0.71.2 | Bots can send from a tagged form of their email address, like name+shop@, and a routine on that tag runs only for its mail. | S1 #v0.71.2 |
| 0.71.2 | Forms a Bot asks you to fill in can arrive with known fields filled in, and you can edit them before you submit. | S1 #v0.71.2 |
| 0.71.2 | While a paid account merge is still moving this account's data, Settings shows Your accounts are being merged, with Contact Support if it runs long. | S1 #v0.71.2 |
| 0.71.2 | Team admins can turn off Messaging between Bots under Bot capabilities on the dashboard, so members' Bots can't message or hand work to other Bots. (Teams) | S1 #v0.71.2 |
| 0.71.2 | Enterprise team admins can recreate, terminate, or delete members' Grok Bot computers from Manage Bot Computers on the dashboard or through the Admin API. (Enterprise) | S1 #v0.71.2 |
| 0.71.2 | When a Bot's computer runs low on disk, the Bot tells you once, names the biggest files, and deletes them only if you agree. | S1 #v0.71.2 |

Not versioned, and not part of any entry: the first-party "What's new" video for the week of 2026-10-18 (S13), section 6 below.

---

## 6. 2026-10-18: the week after the last entry (first-party video, not the changelog)

No changelog entry covers this week as of 2026-10-20, so the only first-party record is Matt Palmer's video "What's new in Grok Bot — Oct 18, 2026" (S13, 5:05), transcribed locally. It names features that section 4 does not contain; each line below is what the video states, in the transcript's terms, and no version number is given for any of them. The transcription is machine-made ("Grockbot" and "Grogbot" are "Grok Bot"), so treat the wording as spoken, not published.

| # | Feature as the video states it | In the changelog? | Source |
|---|---|---|---|
| 1 | Redesigned chat cards: markdown tables, questions with A/B/C and multi-select options | not in any entry | S13 |
| 2 | "Bot's computer" responses three times faster (second upgrade in two weeks) | not in any entry | S13 |
| 3 | Draft edits highlighted: when the bot revises a draft (Slack, Gmail), the revisions are highlighted | not in any entry | S13 |
| 4 | Plus-addressed e-mail aliases for the bot's e-mail address | 0.71.2: "Bots can send from a tagged form of their email address, like name+shop@, and a routine on that tag runs only for its mail." (section 4, New of 0.71.2) | S13, S1 |
| 5 | X: the bot reads and answers the user's X DMs, with limits against spam | not in any entry | S13 |
| 6 | X: @bot in an X thread does what the user asks; needs the X plugin installed and configured; the X username is linked to the account | not in any entry; S4 documents requirements, regions and the meaning of each reply | S13, S4 |
| 7 | New connectors: Robinhood, Coinbase, Trello, PostHog "and many more" | not in any entry | S13 |
| 8 | Voice calls: the bot keeps the memory of a call (full transcript) for 30 minutes after hang-up | not in any entry | S13 |
| 9 | Notifications collapsed: one notification on the device the user is active on, not every device | not in any entry | S13 |
| 10 | Invite teammates (team and enterprise accounts) | not in any entry | S13 |
| 11 | Android: Grok Bot can be the default Android assistant | not in any entry | S13 |
| 12 | Team bot access lists: delegate who has access to a team bot | not in any entry | S13 |
| 13 | Mobile: an "unread" pill that jumps to unread messages | not in any entry | S13 |
| 14 | Routine times: improvements when scheduling a routine | not in any entry | S13 |
| 15 | Slack sign-in links: a better sign-in flow when the bot needs Slack and the user is not signed in | not in any entry | S13 |

---

## 7. Not obtained

1. **Versions before 0.17.0.** The oldest entry on the page and in the feed is 0.17.0 (2026-08-12). Grok Bot launched 2026-08-11 (S5; S3 records the launch the same day), so builds between the launch and 0.17.0, 0.1 through 0.16, are not published anywhere.
2. **Version numbers 0.23.0, 0.42.0, 0.43.0, 0.47.0.** The sequence jumps 0.22.0 to 0.24.0, 0.41.0 to 0.44.0 and 0.46.0 to 0.48.0 on both the page and the feed. Whether those builds existed, or shipped anything user-visible, is not stated, and nothing was inferred.
3. **Per-build notes for 0.69.0, 0.69.1, 0.70.0, 0.70.1, 0.71.0, 0.71.1.** They are named only inside the "Also includes" line of 0.70.2 and 0.71.2. No line is attributed to one of them, so this file cannot say what shipped in each.
4. **Times, build numbers, and per-platform versions.** Entries carry a date, not a time; there are no build or bundle numbers and no separate macOS, Windows, Linux, iOS or Android version numbers. A line names a platform only where the feature is platform-specific.
5. **No Grok Bot release-notes page on docs.x.ai.** The docs carry product pages only (overview, get-started, bots, skills/routines, chat, approvals, computer-and-apps, team-bots, settings, mobile, faq, files-and-results, security, tag-on-x, teams-and-enterprises, troubleshooting, use-cases) and no changelog. docs.x.ai/developers/release-notes is the API release notes and contributes only the 2026-08-11 launch item (S3).
6. **Nothing after 0.71.2 (2026-10-14).** The header still read "Latest v0.71.2 · Oct 14, 2026" when this file was written. The week of 2026-10-18 exists only as the video in section 6, which gives no version numbers, so those features are dated to the video and not to a release.
7. **Rendering.** Nothing was lost to JavaScript. A request without a User-Agent is answered with HTTP 403 (5,477 bytes); with a browser User-Agent the changelog returns 811,695 bytes of prerendered HTML holding all 51 entry anchors and every one of the 566 entry lines, and the feed returns 97,000 bytes with the same 51 entries and 566 list items. The tables above were built from the feed and checked against the page: all 566 lines appear verbatim in the page HTML, apart from the badge form noted in section 2.
8. **The Grok Build tab of the same changelog page.** The page carries tabs "Grok Build" and "Grok Bot"; Grok Build is a different product and was not walked.
9. **App-store release notes.** Not consulted: the brief scopes sources to xAI's own pages, and store listings are not among them. If a mobile build ever ships something the changelog does not record, this file will not show it.
10. **Secondary write-ups.** Search surfaced thedailybot.vercel.app, getgrokbot.com and iphoneincanada.ca posts about Grok Bot releases. None is cited: they are secondary, and nothing here depends on them.

---

## 8. Shape of the history

| Type | Lines |
|---|---|
| New | 130 |
| Improved | 161 |
| Fixed | 275 |
| Total | 566 |

51 entries over 63 days (2026-08-12 to 2026-10-14), on 33 distinct dates. The largest entry is 0.71.2 (102 lines); the smallest is 0.18.0 (1). Per-version line counts are in section 3.
