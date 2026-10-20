---
title: "Mr. Robot v1.17 — Drafts, Pages and multi-select: what the Grok Bot release history taught"
status: ready-for-agent
story-prefix: dp
parent: mr-robot-v1.16.md
---

# Mr. Robot v1.17 — Drafts, Pages and multi-select

## Problem Statement

The owner read the complete Grok Bot release history (docs/research/grok-bot-release-notes.md, 0.17.0 to 0.71.2, with the 2026-10-18 video) against Mr. Robot v1.15 and v1.16 on 2026-10-20. Most of the 130 "New" lines are team, enterprise, billing and language work that a single Home does not need. Three things remain that a Robot's owner feels every day:

1. **A draft is not a thing.** Grok Bot grew a draft into an object over five releases: the bot writes an e-mail or a Slack message as a draft, the owner reads it on a card, edits it, sends or discards it, sees what the bot changed in a revision, and can tell one bot to send without asking. Mr. Robot has the pieces (a send tool at the ask level becomes a tool-call Ask; propose_review carries a list of items) but the owner reads JSON arguments, cannot edit the text in place, sees no difference between two revisions, and has no one-touch way to say "this Robot sends on its own".
2. **A result is a file, not a document.** A Robot that writes a report puts a file in the Workspace and names its path; the owner opens the Files view, which is an editor for working with files, not a place for reading. Grok Bot's Pages give a result a title, a reading layout, a PDF and a link. The owner wants the same, in Markdown and in HTML.
3. **A question allows one answer.** ask (v1.15) takes one option or a custom text. Grok Bot has had multi-select since 0.25.

Two small things ride along: "always allow" on a tool-call Ask, which Grok Bot added to expired Auto-review cards (0.59), and dictation in the composer, which the owner wants recorded for later, not built now.

## Solution

**Drafts as tool-call Asks, rendered as messages.** No new object. A send tool (gmail_send, gmail_reply, gmail_forward, slack_send_message, discord_send_message, discord_dm, discord_reply and the as-you variants) at the ask level already produces a tool-call Ask; that Ask is now rendered as a message card: recipients, subject, the body as Markdown, attachments, Send and Discard, and an editable body whose edited text is what Send sends. A Robot at allow can still ask for the card with draft: true. A revision the owner asks for arrives through draft_revise, which replaces the body on the same Ask and shows the words added and removed against the previous version, with the revision history under the card. "This Robot sends on its own" on the card raises the Connection's write grant for that Robot to allow after a confirmation; the grant settings do the reverse. E-mail bodies go out as HTML rendered from the Markdown. gmail_draft (a draft left in the mailbox) stays what it is.

**Pages.** A Page is a file under pages/ in the Workspace, Markdown or HTML, with a title. The Robot writes it with the file tools and hands it over as an attachment of say. The owner reads it in a reading view: title, table of contents for Markdown, the app's Markdown rendering (tables, Mermaid, KaTeX, Workspace images) or the HTML in a sandboxed frame with a Source view; Rename; PDF through Browser Rendering. The Robot's panel lists its Pages. Sharing is a public link with a signed, revocable token that the owner turns on by hand in the reading view and can turn off; the shared page serves the title, the content and the PDF and nothing else; shared Pages are listed in the profile. HTML pages are served from a path that carries a sandboxing Content-Security-Policy and run without the app's origin. A platform skill pages says when a Page beats a message and how to keep one current.

**Multi-select.** ask gains multi_select; the card shows checkboxes and Submit; the answer is a list; a custom text may ride along when allowed.

**Always allow.** A tool-call Ask card offers "Always allow this", which approves the call and raises the item's level to allow for that Robot, after a confirmation; Auto review denials are excluded.

**Dictation** is recorded as a postponed ticket.

## User Stories

### Drafts
1. As an owner, I want a tool-call Ask of a send tool shown as a message card with recipients, subject, the body rendered from Markdown and the attachments, so that I read a draft, not arguments ^dp-si4p
2. As an owner, I want Send and Discard on the card, Send approving the stored call and Discard rejecting it with a reason the Robot reads, so that one tap decides ^dp-wd2q
3. As an owner, I want to edit the body (and the subject of an e-mail) in the card before Send, and the edited text to be exactly what is sent, so that I fix a word without a round trip ^dp-qbt7
4. As a Robot, I want draft: true on every send tool to produce the card even when my grant is allow, so that I can choose to show a message before it goes ^dp-yhn7
5. As a Robot, I want draft_revise(ask_id, body, subject?) to replace the body of an open draft Ask, so that I act on "shorter, and drop the second paragraph" ^dp-5ixt
6. As an owner, I want a revised draft to show the words added and removed against the previous version, with the revision history under the card, so that I see what changed ^dp-o3st
7. As an owner, I want "This Robot sends on its own" on the card, which after a confirmation raises the Connection's write grant for that Robot to allow and sends the current draft, so that trust is one tap ^dp-ef0p
8. As an owner, I want the grant settings to lower that level back to ask, so that the tap is reversible ^dp-fjh7
9. As an owner, I want e-mail bodies written in Markdown sent as HTML with a plain-text part, so that recipients see headings, bold and lists ^dp-ky1h
10. As an owner, I want the draft card on Discord as text with a link into the app, so that I know a message waits ^dp-1tk6
11. As a Robot, I want the platform prompt and the asking skill to say when to draft (anything that speaks for the owner to someone outside, unless the owner asked for exactly that message) and that gmail_draft leaves a draft in the mailbox instead, so that the two are never confused ^dp-41yj
12. As an owner, I want a draft Ask to expire like other Asks and the Robot to be told when it was dismissed, so that stale drafts do not pile up ^dp-gsf8

### Pages
13. As a Robot, I want a Page to be a file under pages/ in my Workspace, Markdown or HTML, with a title in its front matter or its <title>, written with the file tools, so that a Page is a file I already know how to make ^dp-53pf
14. As an owner, I want a reading view for a Markdown Page: title, table of contents from its headings, the app's Markdown with tables, Mermaid, KaTeX and Workspace images, so that a report reads like a document ^dp-nnzg
15. As an owner, I want a reading view for an HTML Page in a sandboxed frame without the app's origin, with a Source view, and links opening in a new tab, so that a Robot's HTML is safe to open ^dp-hv7b
16. As an owner, I want a PDF button that renders the Page through Browser Rendering, so that I keep or send a copy ^dp-239c
17. As an owner, I want Rename to change the Page's title in the file and everywhere it shows, so that the name is one ^dp-e0rp
18. As an owner, I want a say attachment under pages/ shown as a Page card (title, first lines) that opens the reading view, so that the Robot hands me a document ^dp-35i9
19. As an owner, I want the Robot's panel to list its Pages by date, so that I find them without the Files view ^dp-lxw4
20. As an owner, I want a Share switch in the reading view that mints a public link with a signed token, and Stop sharing that revokes it, so that I decide what leaves the Home ^dp-hf7v
21. As a person with the link, I want the shared Page to show its title, content and PDF and nothing of the app, without signing in, so that a link is a link ^dp-jl3d
22. As an owner, I want my profile to list every shared Page with its link and a Stop sharing, so that nothing stays shared by accident ^dp-zq16
23. As an owner, I want a Robot unable to share a Page, so that sharing is always my act ^dp-62di
24. As an owner, I want a shared HTML Page served with a sandboxing Content-Security-Policy from a path outside the app, so that a shared page cannot reach the app ^dp-p5yn
25. As a Robot, I want a platform skill pages: when a Page beats a message (longer than a screen, a table, something to keep), how to structure one, when to update an existing Page instead of writing a new one, Markdown first and HTML only when layout needs it, so that I use Pages well ^dp-3wnd
26. As an owner, I want the Files view to show pages/ with an Open as Page action, so that the two views meet ^dp-t2w1

### Multi-select
27. As a Robot, I want ask to take multi_select, so that a question can allow several answers ^dp-xz6h
28. As an owner, I want checkboxes and Submit on such a question, with a custom text alongside when allowed, so that I pick several in one go ^dp-53uq
29. As a Robot, I want the answer Wake-up to list every chosen value, so that I act on the whole choice ^dp-f8z1
30. As an owner, I want the Discord text form to number the options and accept several numbers, so that the emergency channel still works ^dp-rys9

### Always allow
31. As an owner, I want "Always allow this" on a tool-call Ask card, which after a confirmation approves the call and raises that item's level to allow for the Robot, so that a trusted action stops asking ^dp-u9z9
32. As an owner, I want the button absent on an Ask that came from an Auto review denial, so that a reviewer's no is never turned into a standing yes by one tap ^dp-kcds
33. As an owner, I want the change shown in the Robot's grants and reversible there, so that the tap is a grant change like any other ^dp-2xp4

### Docs, glossary, compatibility
34. As an owner, I want the glossary to define Draft, Page and Shared Page, so that the words are one ^dp-lupc
35. As a Robot, I want docs/asks-and-help.md, docs/connections.md and docs/memory-and-files.md updated, and a new docs/pages.md, so that what I read is what the platform does ^dp-76wm
36. As an owner, I want old tool-call Asks of send tools to keep rendering as they did, so that history survives ^dp-f0pp

## Implementation Decisions

- **Draft card.** The AskBar and the Conversation render a tool-call Ask whose tool is in the send set with a DraftCard; the send set is declared by the connector tools (a `draft` capability flag with a mapping from arguments to recipients, subject, body, attachments). Edits in the card patch the stored call arguments (body, subject) through a new Ask endpoint; Send approves the stored call as today. `draft: true` is added to every tool in the set; the ask gate treats it as an item at ask for that call. `draft_revise({ ask_id, body, subject? })` is a tool in the asks capability; it appends a revision row (ask_id, seq, body, subject, at, by robot | owner) and the card renders a word diff of the latest two. "This Robot sends on its own" calls the grant endpoint to set `<connection>:write` to allow and then approves the Ask. E-mail bodies: Markdown → HTML with the app's renderer plus a text part; the Gmail connector sends multipart/alternative. Discord Channel output: the existing Ask text form plus a link.
- **Pages.** Files under `pages/` with `.md` or `.html`; the title from YAML front matter `title:` or the first H1 for Markdown, from `<title>` for HTML; a Workspace listing endpoint for pages/ with titles and dates. Routes: `#/robots/:id/pages/:slug` (reading view) and `/p/:token` on the edge (shared). PDF: the edge renders the reading view (or the HTML) through the existing Browser Rendering binding's page.pdf and streams it; Markdown is rendered server-side with the same Markdown pipeline the PWA uses. HTML Pages render in an `<iframe sandbox="allow-scripts">` with `srcdoc` and a CSP of `default-src 'none'; img-src data: blob: <workspace>; style-src 'unsafe-inline'; script-src 'unsafe-inline'`; shared HTML pages are served from `/p/:token` with `Content-Security-Policy: sandbox allow-scripts` and no cookies. Sharing: a `shared_pages` table at the Member (robot id, path, token hash, created, revoked); the token is random, the link `https://<host>/p/<token>`; revocation deletes the row; the Robot has no tool that touches it. Rename rewrites the front matter title or `<title>` in place.
- **Multi-select.** `multi_select` on ask; the stored Ask keeps `selected: string[]` and `custom?`; the Wake-up label lists values comma-separated.
- **Always allow.** A button on the tool-call Ask card when the Ask's items are at ask and the Ask is not a review denial (the stored reason prefix "Auto review denied" marks those); it calls the grant endpoint for the item then approves the Ask; the grant history records "raised from Ask <id>".
- **Prompt and skills.** The asking skill gains the draft rules; a new platform skill pages; docs/pages.md.
- **Glossary** per dp-lupc.

## Testing Decisions

A good test drives the system the way a person or a Robot does: through the edge API in workerd with the scripted model, or through a rendered PWA component with a stubbed API; the PDF render has one staging check. No unit test on plugin internals; no test touches the network except the staging check.

- **Workerd through the API with the scripted model** (prior art: v1.11 ask-per-call tests, v1.15 ask and say tests): a send tool at ask stores an Ask that the view marks as a draft with recipients, subject, body and attachments (dp-si4p); Send approves the stored call and the connector stub receives the edited body and subject; Discard rejects with the reason (dp-wd2q, dp-qbt7); draft: true at allow produces the Ask (dp-yhn7); draft_revise appends a revision and the view carries both versions (dp-5ixt, dp-o3st); "sends on its own" raises the grant and approves (dp-ef0p, dp-fjh7); the Gmail stub receives HTML and text parts (dp-ky1h); the Discord text form (dp-1tk6); a dismissed draft wakes the Robot (dp-gsf8); pages/ listing with titles for .md and .html, rename rewrites the title, the say attachment is typed as a page (dp-53pf, dp-e0rp, dp-35i9, dp-lxw4); share mints a token, /p/:token serves without Access, revoke makes it 404, the Robot has no share tool, the profile lists shares (dp-hf7v, dp-jl3d, dp-zq16, dp-62di); the shared HTML response carries the sandbox CSP (dp-p5yn); multi_select answers as a list in the Wake-up and the Discord form accepts several numbers (dp-xz6h, dp-f8z1, dp-rys9); always allow raises the level and approves, absent on a review denial, visible in grant history (dp-u9z9, dp-kcds, dp-2xp4); old send Asks render (dp-f0pp); the pages skill in the index (dp-3wnd).
- **Component tests** (prior art: v1.15 ask and credential cards): the draft card with edit, Send, Discard and the revision diff (dp-si4p, dp-qbt7, dp-o3st); the Markdown reading view with a table of contents and the HTML view in a sandboxed frame with Source (dp-nnzg, dp-hv7b); the Page card in the Conversation and the Pages list in the panel (dp-35i9, dp-lxw4); the Share switch and the profile list (dp-hf7v, dp-zq16); the multi-select card (dp-53uq); the Always allow button and its absence on a denial (dp-u9z9, dp-kcds); the Files view action (dp-t2w1).
- **Staging**: a Markdown Page and an HTML Page rendered to PDF through Browser Rendering; a shared link opened in a private window (dp-239c, dp-jl3d).

## Out of Scope

Drafts for Robot messages, Threads or say; a drafts table or a drafts list outside Asks; Outlook; editing attachments in the card; Page versions or history (the file is the state); comments on shared Pages; HTML Pages loading remote scripts or styles; Pages for Members other than the owner except through a share link; dictation (postponed ticket); notifications on the active device only (postponed, see v1.16 notes); 1Password (the owner uses Login entries).

## Further Notes

Decisions from the session of 2026-10-20 (the release-history vector), with what was weighed.

- **A draft is an Ask.** Grok Bot built drafts as their own object; Mr. Robot already had "a call that waits for the owner", so a draft became a rendering of that plus revisions. The owner accepted the reuse; the one new tool is draft_revise.
- **Pages are files.** The reading view, the PDF and the share link are views over a Workspace file, so the Files view, the file tools, Rewind and Start over keep working on them without new rules. HTML was pulled into this release at the owner's request ("1.17 is not big, this is the main change"); it is served sandboxed and never with the app's origin.
- **Sharing is the owner's act.** The first thing that leaves Cloudflare Access is a shared Page; the Robot cannot share, the owner sees every share in one list, and revocation is one tap.
- **Dictation** is wanted later: the owner dictates everything; Web Speech API in the browser or Whisper through Workers AI are the two routes to decide then.
- Seams: the edge API in workerd with the scripted model and the connector stubs; component tests; one staging check for the PDF render. No new seam.
