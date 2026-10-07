# Glossary

Vocabulary for Mr. Robot. Specs, code and tests use these words and no synonyms.

- **Home** — one deployment's group of people who may share secrets, subscriptions, skills and robots. v1 deploys one Home.
- **Member** — a person signed in through Cloudflare Access who belongs to a Home. The first Member is the Home admin.
- **Robot** — a persistent worker owned by a Member: one Durable Object, one endless Conversation, its own Persona files, Routines, Grants and Workspace. Not a chat session and not a subagent.
- **Mr. Robot** — the personal chief Robot every Member gets on first sign-in; it may create Robots and holds recipient Grants to every Robot the Member can reach.
- **Conversation** — the single, endless exchange with a Robot. Rendered simply as chat or fully as the Trajectory; both are the same DSH session log.
- **Trajectory** — the full session log view: turns, tool calls, results, executed code.
- **Turn** — one agent-loop run of a Robot, from a Wake-up to the Robot going back to sleep. One Turn at a time per Robot.
- **Wake-up** — what starts a Turn: a Member message, a Routine occurrence, a Robot message, a Channel event, or a Takeover returned.
- **Routine** — a schedule (one-shot, interval, daily, weekly, cron) with a prompt, owned and edited by the Robot, backed by a Durable Object alarm. Shown as "Created routine" cards in the Conversation.
- **Rewind** — replacing the live session with one seeded from the log up to a chosen point; the old log goes to the Robot's archive and the Rewind can be undone.
- **Grant** — permission a Member gives a Robot: a tool, a skill, a recipient Robot, a secret. Everything is off until granted.
- **Grant proposal** — a Robot's request for additional Grants, stored exactly and answered by the owner; the stored proposal is applied, never prose.
- **Workspace** — the Robot's files in R2: Persona files, memory, notes, attachments, artefacts.
- **Persona files** — SOUL.md, IDENTITY.md, AGENTS.md, TOOLS.md, MEMORY.md and daily notes, in the Muse layout, owned by the Robot.
- **Member files** — USER.md and PROACTIVE_PREFERENCES.md, owned by a Member, mounted read-only into each of their Robots.
- **Takeover** — a Member taking control of a Robot's browser tab from their device (screen, taps, keys) and handing it back; the Robot's Turn is suspended meanwhile.
- **Live view** — watching a Robot's browser without taking it over.
- **Channel** — an adapter that turns external events into Wake-ups and Robot output into outbound messages on the same Conversation. v1: PWA and Web Push.
- **Provider** — a model source: OpenAI subscription, Anthropic subscription, DeepSeek, OpenRouter, Workers AI. Credentials belong to a Member and may be shared with the Home.
- **Spend limit** — a monthly token/cost cap per Robot and per Member; crossing it blocks the Robot until raised.
- **Skill library** — the Home's single collection of skills in R2, synchronised from a Git repository and extended by approved Robot proposals; granted per Robot.
- **Robot message** — a work request from one Robot to a granted recipient Robot, or its reply, delivered through a durable outbox and shown as a labelled message.
- **Code mode** — the default execution mode (DSH PTC): the model writes a program that calls its tools inside an isolate; the alternative is direct tool calls.
- **Browser backend** — what runs a Robot's Chrome behind the browser seam: Browser Run, Container Chrome, Container Chrome via VPN; later Host browser. Chosen per Robot, defaulting to the Home's.
- **Login entry** — name, username, password, websites, notes, scope; granted per Robot; filled into matching pages without the password reaching the Robot's program. Replaces Secret.
- **Ask** — a pending decision a Robot puts to its owner (grant proposal, question, setup approval, member-file edit), shown in place of the composer.
- **Global skill / Local skill** — a skill in the Home library (read-only for Robots except Mr. Robot) / a skill in one Robot's Workspace (the Robot edits it freely).
- **Files view** — the per-Robot view of its Workspace with an editor.
- **Composer** — the message input at the bottom of a Conversation.
- **Host** — a computer running the Mr. Robot desktop app, paired to a Member, private or shared with the Home; offers robots files, a shell and a Host browser on grant.
- **Host browser** — the browser backend served by a Host: Chrome installed there, driven over CDP through the app, behind the same seam as cloud backends.
- **Host tools** — host_read, host_write, host_run on a granted Host.
- **Work details** — a per-Member setting (Compact, Standard, Detailed, Verbose) for how much of a Robot's tool work the Conversation shows; Compact is the default.
- **Memory scope** — member (about the person), robot (the Robot's own), Home (shared household facts); each a set of files injected as the Robot's baseline message.
