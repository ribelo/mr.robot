---
title: "Mr. Robot v1.7 — app polish: scroll, optimistic send, theme tokens, robot colour"
status: ready-for-agent
story-prefix: ap
parent: mr-robot-v1.5.md
---

# Mr. Robot v1.7 — app polish

## Problem Statement

While a Robot answers, the Conversation scrolls to the bottom on every streamed token, so a long answer cannot be read until it ends. A sent message appears only after the server has accepted it; on a slow link Enter feels dead. Every Robot has a colour, but the chat uses it only for the avatar and an inline label. Colours are hard-coded CSS variables: there is no token set, no light mode, no way to tint a Robot's messages. Robot state (working, waiting, blocked) is a text pill, not something the eye catches.

## Solution

Stick-to-bottom scrolling that follows only while the reader is at the bottom, with a "jump to latest" button when detached. Optimistic sending: the message appears at once as pending; a refused send stays marked "not sent" with Retry. A design-token file (JSON) that generates the CSS variables, light and dark themes following the system with a manual override in the profile, Robot messages tinted with the Robot's colour, and an avatar that animates per fleet state.

## User Stories

1. As a person, I want the Conversation to keep following new content only while I am at the bottom, so that scrolling up to read is not undone by the stream ^ap-iyej
2. As a person, I want a "jump to latest" button with the count of new messages when I am scrolled up, so that I can return in one tap ^ap-8rui
3. As a person, I want the Conversation to return to following the stream once I scroll back to the bottom, so that the behaviour needs no setting ^ap-oe45
4. As a person, I want my message shown in the chat the moment I press Enter, marked pending until the server confirms, so that sending feels instant on the desktop app and the phone ^ap-3si6
5. As a person, I want a refused send kept in the chat marked "not sent" with Retry and the error, the composer already empty, so that nothing I typed is lost and nothing is sent twice ^ap-ceqx
6. As a person, I want a pending message shown without a timestamp or with a clock mark until confirmed, so that I can tell what has landed ^ap-7b3p
7. As a developer, I want every colour, radius, spacing and font token in one JSON file that generates the CSS variables, so that a theme is data, not scattered CSS ^ap-qb2y
8. As a person, I want a light and a dark theme that follow the system by default, so that the app matches my desktop ^ap-p00m
9. As a person, I want a manual theme override (system, light, dark) in my profile, so that I can pin one ^ap-itj1
10. As a person, I want a Robot's replies drawn on a background tinted with its colour at low strength (readable in both themes), so that I see who speaks at a glance ^ap-yzs4
11. As a person, I want a Robot's avatar to animate per fleet state (idle, working, waiting for me, blocked) in the list and the header, so that state is visible without reading ^ap-bxt2
12. As a person, I want the colour picker to offer the token palette and a custom hex, so that Robots get distinct colours that still fit the theme ^ap-udc9

## Implementation Decisions

- **Scrolling**: the Conversation tracks "at bottom" from the scroll container (distance to bottom under a small threshold). Auto-scroll on new items or stream text runs only when at bottom. Leaving the bottom shows a floating "↓ N new" button; clicking it scrolls to the bottom and re-arms following. Works with the windowed row renderer for long conversations.
- **Optimistic send**: the Conversation keeps a local list of pending sends (client id, text, attachments, state: pending | failed with message). Pending items render after the server items; a confirmed send is removed when the server conversation contains it (matched by the client id the API accepts, else by text and time window). Failure keeps the item with Retry; Retry resends with the same client id so the server deduplicates. The composer clears at Enter.
- **Tokens**: one JSON file in the web app (colours by role: surface, surface-raised, text, muted, accent, danger, success; radii; spacing; font sizes) with a light and a dark set; a small build step or a runtime module turns it into CSS variables on the root under `[data-theme=light|dark]`. The DSH trajectory theme file consumes the same variables where it already uses variables.
- **Theme choice**: a per-Member setting (system | light | dark) in the profile, stored with the Member's other UI settings; applied before first paint from local storage to avoid a flash; system via `prefers-color-scheme`.
- **Robot tint**: a Robot message bubble's background is `color-mix(in oklab, <avatarColor> <tint%>, <surface>)` with a tint percentage per theme (around 10–14% dark, 8–10% light) and the text colour from the theme, never from the Robot colour. Mixed conversations (robot messages from other Robots) use the sender's colour.
- **Avatar state**: the avatar component takes the fleet state and animates with CSS only (pulse when working, ring when waiting for you, muted with a mark when blocked); respects `prefers-reduced-motion`.
- **Palette**: the identity colour picker lists the token palette plus a custom hex input; existing colours stay valid.

## Testing Decisions
- Component tests in the web app (prior art: apps/web/test) with a fake scroll container: following stops when scrolled up, resumes at bottom, the button shows the count (ap-iyej, ap-8rui, ap-oe45).
- Component tests of the Conversation with a stubbed API: pending item appears immediately, is replaced by the server item, a failed send shows Retry and resends once (ap-3si6, ap-ceqx, ap-7b3p).
- A test that every variable the stylesheets use is defined by the token file in both themes (ap-qb2y, ap-p00m); the override is applied from the profile setting (ap-itj1).
- Snapshot-free assertions on computed style for the tint and the avatar state class (ap-yzs4, ap-bxt2, ap-udc9).

## Out of Scope
Message editing, reactions, read receipts; per-Home custom themes edited at runtime; animated wallpapers; any Worker change beyond accepting a client id on send and storing the theme setting.

## Further Notes
- The Electron host app loads this PWA; every change here lands there without an Electron release.
