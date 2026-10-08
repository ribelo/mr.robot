# 03: Gmail and Calendar tools

**Parent:** mr-robot-v1.5 (../mr-robot-v1.5.md) — stories cn-426k, cn-z1di, cn-s04t

**What to build:** Gmail: search, read thread, attachments to workspace, draft, send (separate grant), reply, forward, label, archive, mark read, unsubscribe. Calendar: calendars, list/search events, create, update, delete, respond, free-busy. Fixture tests for every tool; a live triage and a live event on the owner's account.

**Blocked by:** 02 Google: guided OAuth client setup and Connect Google

**Status:** in-progress

- [ ] All tools pass fixture tests
- [ ] Live: inbox triage summary and an event created on the owner's calendar
- [ ] A robot without the send grant has no send tool

## How it works

- **Gmail** (connectors/google/gmail.ts):
  - gmail_search (threads with their latest message), gmail_thread (full text; HTML mail as text with links kept), gmail_attachment (into the Workspace under attachments/gmail/).
  - gmail_draft (with Workspace files attached, optionally as a reply in its thread), gmail_labels, gmail_label (by name, creating labels on request), gmail_archive, gmail_mark_read.
  - gmail_unsubscribe: RFC 8058 one-click when the sender supports it, then archives; otherwise it returns the link or mailto.
  - With the separate write grant only: gmail_send, gmail_reply (reply-all leaves the account itself out), gmail_forward (the original attachments go along).
  - MIME is built in TypeScript: UTF-8 subjects as encoded words, base64 bodies, multipart attachments.
- **Calendar** (connectors/google/calendar.ts): calendar_calendars, calendar_events (recurring events expanded, time order, query), calendar_event, calendar_create (all-day or timed, attendees invited, Meet link on request), calendar_update (only the given fields), calendar_delete, calendar_respond (as the account), calendar_freebusy.
- Each tool appears only for accounts whose consent included its service.

## Verified

- **google-tools.test.ts:** every tool against recorded Gmail and Calendar responses, checking the request it makes (URL, query, body, MIME text) and how it reads the answer. A 401 is reported and marks the connection.
- **connectors.test.ts:** a Robot holding a Google connection without the write grant has gmail_search, gmail_draft and calendar_create but no send, reply or forward. With the write grant they appear.
- **Open, needs the owner's account:** a live inbox triage and an event created on his calendar.
