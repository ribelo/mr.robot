---
title: "Mr. Robot v1.10 — provider accounts, model chains, usage, sign-in in the system browser"
status: done
story-prefix: pa
parent: mr-robot-v1.9.md
---

# Mr. Robot v1.10 — provider accounts and model chains

## Problem Statement

A person can connect only one account per Provider (OpenCode Go is the exception: a hidden key pool that rotates by itself). The owner has two Claude subscriptions and several OpenCode Go keys and wants to use all of them, to share each one with the Home separately, and to know which Robot uses which account. When an account hits its limit the Robot stops; when a subscription ends nobody is told. Nobody sees how much of a subscription window is left. And signing in to Google from the desktop app happens inside the app's own window, where the password manager (Bitwarden, 1Password) and its passkeys are not available, so the sign-in cannot be finished.

## Solution

**Accounts.** Every Provider (DeepSeek, OpenRouter, ChatGPT, Claude, OpenCode Go) holds any number of accounts per person, each with a label and its own "shared with the Home" switch. The OpenCode Go pool becomes ordinary accounts.

**Model chain.** Nothing rotates silently. Each Robot has an explicit, ordered **model chain**: entries of account + model (+ thinking effort), reordered by drag and drop in its settings. A Robot runs on the first usable entry. When an entry's account hits a limit or breaks, the Robot moves to the next entry, says so in the Conversation, and continues the work. When an earlier entry becomes usable again, the next Turn goes back to it, also with a line. When every entry is unusable the Robot is blocked, its owner is told, and it resumes by itself at the earliest reset. Mr. Robot may set the chains of other Robots.

**Account state.** A limited account is skipped until its reset (one hour when the Provider gives none). A broken account (subscription cancelled, payment failed, token revoked) needs attention: its owner is told once, it is tried again after 6 hours, and "Check now" tests it at once.

**Usage.** Each Claude and OpenCode Go account shows its usage windows (percent used, reset time) in the profile, refreshed on open and cached for a minute. Members who may use a shared account see its bars, never its secrets. The owner of a shared account sees which Robots (and whose) have it in their chain.

**Sign-in in the system browser.** The desktop app opens every page outside the Mr. Robot server and the Access sign-in in the system browser. The Google callback no longer needs the Access session: the one-time consent state identifies the person, and the browser tab ends with "Connected — return to Mr. Robot".

## User Stories

### Sign-in
1. As a person using the desktop app, I want Google's sign-in to open in my normal browser, so that my password manager and passkeys work ^pa-e7xj
2. As a person, I want the browser tab to finish the connection without asking me to sign in to Mr. Robot again, so that one Google sign-in is enough ^pa-4sr1
3. As a person using the desktop app, I want any link outside Mr. Robot to open in my browser, so that the app window stays the app ^pa-6ljh

### Accounts
4. As a person, I want to add any number of accounts of every Provider, each with a label, so that I can use all my subscriptions and keys ^pa-i3le
5. As a person, I want to share each account with the Home separately, so that my partner may use one subscription but not the other ^pa-f281
6. As a person, I want my existing credentials and OpenCode Go keys kept as accounts after the update, so that nothing has to be connected again ^pa-mdlk
7. As the owner of a shared account, I want to see which Robots (and whose) have it in their chain, so that I know who spends it ^pa-f59m
8. As a person, I want to remove an account and see which Robots lose it, so that removal is not a surprise ^pa-cv06

### Model chain
9. As a person, I want each Robot to have an ordered list of account + model entries, edited and reordered by drag and drop in its settings, so that I decide exactly what it may spend ^pa-mho0
10. As a person, I want a new Robot to start with one entry (a model I can use and my first account for it), so that nothing needs configuring by default ^pa-u06u
11. As a person, I want existing Robots migrated to a one-entry chain on their current model, bound to the account they used, so that behaviour does not change ^pa-l3l9
12. As a person, I want a Robot to move to the next entry when its account hits a limit or breaks, and to continue its work, so that a limit does not stop it ^pa-kvsr
13. As a person, I want every move between entries shown as one line in the Conversation ("Switched to Claude Opus on rk@…: anthropic limit until 16:00"), so that no switch is silent ^pa-q0dg
14. As a person, I want the Robot to go back to an earlier entry once it is usable again, with a line, so that the preferred account is used first ^pa-14yx
15. As a person, I want a Robot whose every entry is unusable to be blocked, to tell me, and to resume by itself at the earliest reset, so that I do not have to restart it ^pa-dus3
16. As Mr. Robot, I want to read and set the model chain of a Robot my owner reaches, using accounts my owner can use, so that configuration is not the owner's chore ^pa-w81r

### Account state
17. As a person, I want a limited account skipped until its reset (one hour when unknown) and then used again, so that a limit never disables an account for good ^pa-gqff
18. As a person, I want a broken account (cancelled, unpaid, revoked) marked "needs attention", told to me once, and tried again after 6 hours, so that I can fix it and it recovers by itself ^pa-bc78
19. As a person, I want a "Check now" button on an account, so that after fixing a payment I do not wait 6 hours ^pa-hq0v

### Usage
20. As a person, I want each Claude account to show its usage windows (current 5-hour session, week, per-model weeks) with percent and reset time, so that I know what is left ^pa-lmbl
21. As a person, I want each OpenCode Go account to show its rolling, weekly and monthly usage with percent and reset time, so that I know what is left ^pa-sps4
22. As a Member, I want to see the usage bars of accounts shared with the Home, without their secrets, so that I can choose which to put in my chains ^pa-sstr
23. As a person, I want usage refreshed when I open the profile and cached for a minute, so that the page is fast and the Providers are not hammered ^pa-7d50
24. As a person, I want an account whose Provider has no usage endpoint (DeepSeek, OpenRouter, ChatGPT) to show no bars rather than invented numbers, so that the page is honest ^pa-afb9

## Implementation Decisions

### Sign-in
- Electron main process: `will-navigate` and `will-redirect` to any origin other than the configured server and the Access team domain (`*.cloudflareaccess.com`) are prevented and opened with `shell.openExternal`. The renderer adds `external=1` to the Google consent start URL when it runs in the app (`window.mrRobotHost` exists).
- The Google consent state becomes `<memberId>.<random>`; the callback route is exempt from Access (an Access bypass application for that one path, like the webhook path) and routes to the Member named in the state, which verifies the random part as today. A consent started with `external=1` answers with a small HTML page ("Connected <account>. Return to Mr. Robot.") instead of the redirect to the app.

### Accounts
- Member storage: table `account` (id, provider, label, kind api-key|oauth, sealed, shared, expires, status ok|limited|broken, note, until, checked_at, notified, created_at, updated_at). Migration copies each `credential` row to one account and each OpenCode Go pool key to one account (label "Key ••••<last 4>"); the old table and pool are dropped.
- Labels: OAuth accounts use the account e-mail when the Provider reveals it (Claude, ChatGPT), else "<Provider> <n>"; API keys "Key ••••<last 4>"; the person may rename.
- Home index `provider_account` (id, member_id, provider, label, shared, status, until) maintained by the Member on every change: the list of accounts a Member may use (own, plus shared ones of active Members), and the account status that chain walking reads.
- API: list my accounts and the Home-shared ones; add (API key or OAuth flow, many times); rename; share; remove; check now; usage. The Profile's Providers section lists accounts per Provider with Add account.
- The OpenCode Go pool rotation code (key pool, stickiness, promotion) is removed.

### Model chain
- `RobotConfig.chain: ChainEntry[]` with `ChainEntry = { account: string, provider, model, effort }` (Workers AI has the account id "workers-ai"). `config.model` stays as the active entry's model so the rest of the code is unchanged; the active entry index lives in the Robot store.
- Credentials are resolved per request for the active entry's account through the Home, which checks the account is the owner's or shared with the Home by an active Member.
- Chain walking: a wrapper around the Provider adapter classifies a failed request (429 or an unified-reset header: limited, with reset from `anthropic-ratelimit-unified-reset`, `retry-after` or one hour; 401, 402, 403 and subscription or credit errors: broken) and records it. After a failed Turn with a recorded account failure the Robot marks the account through its owner's Member, picks the next usable entry, sets it active (the composition is rebuilt), adds the switch line and enqueues a platform Wake-up "continue from where you stopped". Before every Turn the Robot picks the first usable entry; a change adds the "back to" line.
- All entries unusable: the failed Turn notice and "blocked" notification as today, plus a resume alarm at the earliest `until`; the alarm enqueues the continue Wake-up.
- Broken accounts are usable again 6 hours after `checked_at`; a success sets the status back to ok. The owner of the account is notified once per break.
- Settings: the chain editor replaces the model selector (drag and drop rows; account select per row filtered to accounts that can run that Provider; model and effort per row). The settings patch and the deputy's settings patch accept `chain`; the deputy may use accounts the owner can use.
- The Home's robot registry stores each Robot's chain account ids so an account's owner sees "used by".

### Usage
- Claude: `GET https://api.anthropic.com/api/oauth/usage` with the account's OAuth access token and `anthropic-beta: oauth-2025-04-20`; every object field with `utilization` and `resets_at` is a window (names mapped: five_hour → Current session, seven_day → This week, seven_day_<model> → <Model> this week). Undocumented: a failure shows "usage unavailable", never an error page.
- OpenCode Go: `GET https://opencode.ai/zen/go/v1/usage` with the key; `usage.rolling|weekly|monthly` → percent and resetsAt.
- Cached per account for 60 seconds in the Member; the same call is the health probe for "Check now" on these Providers. Other Providers: "Check now" uses a cheap authenticated request (DeepSeek balance, OpenRouter key info, ChatGPT token refresh).

## Testing Decisions
- Workerd tests through the edge API and the Robot DO with stubbed Provider HTTP and the scripted model: several accounts per Provider and per-account sharing (pa-i3le, pa-f281, pa-cv06, pa-f59m); migration of a credential and an OpenCode pool (pa-mdlk); default and migrated chains (pa-u06u, pa-l3l9); a 429 with a reset header moves to the next entry, adds the line, continues, and returns after the reset (pa-kvsr, pa-q0dg, pa-14yx, pa-gqff); a 401 marks broken, notifies once, retries after 6 hours, Check now (pa-bc78, pa-hq0v); all unusable blocks and resumes by alarm (pa-dus3); deputy chain (pa-w81r); usage parsing of recorded Claude and OpenCode responses, caching, shared visibility, no bars for others (pa-lmbl, pa-sps4, pa-sstr, pa-7d50, pa-afb9); Google callback without Access and the external page (pa-4sr1).
- Component tests: chain editor reorder and account filtering (pa-mho0); usage bars.
- Manual: the desktop app opens Google in the system browser (pa-e7xj, pa-6ljh).

## Out of Scope
Automatic rotation without an explicit chain; usage for ChatGPT, DeepSeek, OpenRouter; credit balances; per-account spend limits.
