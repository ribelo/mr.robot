# Muse versus Grok Bot: what users say the strengths are, and where they locate "the magic"

Research date: 2026-10-21. Scope: the community's account — first-hand user posts and threads first, hands-on
reviews second, vendor pages only to check a claim — of what Meta's Muse (the always-on personal agent, served by
the Muse Spark model family) does well against xAI's Grok Bot, and where each product's delight is said to sit.
Written for the owner of Mr. Robot, who wants the user's account rather than marketing.

## Sources

Trust order used below: first-hand (F) before reviewer (R) before vendor (V). "Secondary" (S) means a page that
compiles or restates others; it is cited only where it points at a first-hand source or states a mechanism.

| # | Source | Type | Date | What it gives |
| --- | --- | --- | --- | --- |
| S1 | https://news.ycombinator.com/item?id=49615537 | F (742 comments) | 2026-09-08 | Launch-day HN thread: distrust of Meta, but also the first comparisons with Grok Bot. |
| S2 | https://news.ycombinator.com/item?id=49946526 | F (223 comments) | 2026-10-03 | Thread on "What Meta got right with Muse"; the richest dual-user comments (artdigital, jasongi). |
| S3 | https://metedata.substack.com/p/what-meta-got-right-with-muse | R | 2026-10-02 | Designer's written analysis after using Muse; the "one chat, no model selector" argument. |
| S4 | https://news.ycombinator.com/item?id=49802871 | F (173 comments) | 2026-09-22 | "I asked Meta's Muse for its filesystem": SOUL.md, approvals and trust talk. |
| S5 | https://mouse.dev/blog/muse-runtime-export/ | F (teardown with logs) | 2026-09 (export) | The 6.8 GB export: the SOUL/IDENTITY/USER/MEMORY/AGENTS/TOOLS file set, the `magic-moment` skill. |
| S6 | https://sjl.us/2026/09/10/two-days-with-muse/ | F (personal blog) | 2026-09-10 | Two days of real use; the "it said I don't know" observation. |
| S7 | https://www.theverge.com/tech/993391/meta-muse-ai-hands-on | R (screenshots) | 2026-09-10 | Muse inferring Instagram interests; Ideas and Goals lists. |
| S8 | https://www.tomsguide.com/ai/i-used-meta-muse-to-automate-10-tasks-from-reminders-to-trip-alerts-and-i-cant-believe-how-well-metas-ai-handled-everything | R | 2026-10-07 | Ten scheduled tasks; Muse proposing what to automate. |
| S9 | https://gizmodo.com/metas-muse-let-me-waste-a-mind-boggling-amount-of-free-compute-on-nothing-in-particular-2000808945 | R | 2026-09-08 | 100 M tokens/week free tier, measured by burning it. |
| S10 | https://www.pymnts.com/news/artificial-intelligence/2026/meta-muse-cannot-order-pizza-without-help/ | R | 2026-09-09 | Three errands, none completed; setup cost; Sentinel. |
| S11 | https://www.lennysnewsletter.com/p/muse-review-the-personal-ai-agent | R (video + notes) | 2026-09-16 | Claire Vo's Muse review: design, permission model, activity feed, browser use mixed. |
| S12 | https://www.youtube.com/watch?v=meiBguL-hf4 | R (video, auto-captions) | 2026-10-09 | No Code MBA: the memory file, the shipped SOUL.md read aloud, the heartbeat, free usage. |
| S13 | https://www.youtube.com/watch?v=sbTAK69od_Q | R (video, dual use) | 2026-09-25 | James Layne: pro/cons of both, after running both for weeks. |
| S14 | https://www.youtube.com/watch?v=fbm5LevEJyI | R (video, dual use) | 2026-10-07 | Pat Simmons: same three jobs on Muse, Grok Bot, Dots; usage numbers; editable agent files. |
| S15 | https://www.unrollnow.com/status/2097848319095505064 | F (X post) | 2026-09-11 | @buccocapital: "incredibly good", the non-AI wife test. |
| S16 | https://unrollnow.com/status/2097422142472327466 | F (X post) | 2026-09-09 | @KenWattana: fast/snappy, credentials, "mechanical and not as smart", native access. |
| S17 | https://www.unrollnow.com/status/2097458998618521978 | F (X post) | 2026-09-11 | @omooretweets: reluctance to connect email; browser use impressive. |
| S18 | https://www.unrollnow.com/status/2097406190104002775 | F (X post) | 2026-09-11 | @patrickc: buying anywhere with Link. |
| S19 | https://agihunt.info/en/p/1a14cf08911237a733281cc13b4 | F (X post, mirrored) | on/before 2026-10-18 | @_simonsmith's three-way ranking of Muse, Dots, Grok Bot. |
| S20 | https://news.ycombinator.com/item?id=49893709 | F (43 comments) | 2026-09-29 | Thread on AppleInsider's "ignores users permissions" report. |
| S21 | https://news.ycombinator.com/item?id=49983579 | F (14 comments) | 2026-10-06 | Thread on "building a dossier on you"; the engagement-instruction quotes. |
| S22 | https://news.ycombinator.com/item?id=49802030 | F (50 comments) | 2026-09-22 | Thread on the reported 0-day. |
| S23 | https://blog.cygankiewicz.com/en/meta-muse-black-box-testing/ | F (stress test with traces) | 2026-09-13 | Spawn experiments, DB lock timeouts, what the evidence does and does not show. |
| S24 | https://news.ycombinator.com/item?id=50107379 | F (479 comments) | 2026-10-15 | Muse Spark Open thread: memory stickiness, export, "pick one agent". |
| S25 | https://www.meta.com/help/artificial-intelligence/995796179982326/ | V | updated 2026-10 | What Meta says is customisable: name, tone, memories, file-based memory, memory import. |
| S26 | https://www.theagentnotes.com/2026/10/muse-daily-oct-8-pm-your-muse-has-three.html | S (how-to) | 2026-10-08 | The three-file model (USER/MEMORY/SOUL) restated; the report of a vanished persona edit. |
| S27 | https://agent-tune.com/guides/muse-personality | S (how-to) | 2026-09-25 | Identity → Soul path; the text of a shipped Soul.md block; persistence testing advice. |
| S28 | https://reddit.sentinel-team.org/posts/1vob5q2/snapshots/2026-08-15T05%3A10%3A00.377657Z | F (Reddit post, mirrored) | post c. 2026-06 | u/Ok-Bug7181: six Bots in a business; what was amazing and what broke. |
| S29 | https://forum.cursor.com/t/grok-bot-update-state-memory-writes-fail-fleet-wide-brain-docs-snapshot-was-cut-short-before-completing/171895 | F (bug report + staff reply) | 2026-09-16 | Memory writes failing fleet-wide; the `memory/profile.md` workaround. |
| S30 | https://forum.cursor.com/t/auto-review-still-prompts-after-always-allowed-standing-approval/172859 | F (bug report + staff reply) | 2026-09-24 | "Always allow" is saved as text, not a per-tool permission. |
| S31 | https://docs.x.ai/grok-bot/faq | V | 2026 | Shared computer, per-Bot memory, what needs approval, billing model. |
| S32 | https://agent-tune.com/guides/grokbot-personality | S (how-to) | 2026-09-25 | Grok Bot's profile is Name, Label, Description, avatar; Description is the durable instruction carrier. |
| S33 | https://www.lennysnewsletter.com/p/how-i-ai-grok-bot-grok-46whats-great | R | 2026-08-24 | Claire testing Grok Bot: multi-account connectors, "simplicity is both its greatest strength and its biggest limitation". |
| S34 | https://www.theaigentic.com/hands-on/grok-bot | S (compiles four creators) | 2026-09-03 | Vo, Yang, Finn, Berman setups; description-as-system-prompt; migration shortcut. |
| S35 | https://www.youtube.com/watch?v=LM7Ft7g8qJw | R (video) | 2026-08-14 | Nate B Jones: integration/authorisation friction gone; one shared computer as one perimeter. |
| S36 | https://www.youtube.com/watch?v=TMPUUyQC5aM | F (video, own fleet) | 2026-08-19 | Nate Herk: per-Bot and shared memory; chief-of-staff delegation. |
| S37 | https://www.youtube.com/watch?v=vrgO4D_mUlA | R (video) | 2026-08-17 | Alex Finn: "an opinion on how you should do things"; description prompts split per Bot. |
| S38 | https://www.youtube.com/watch?v=l6cr7gy5l9E | F (video, 100+ hours) | 2026-09-14 | Peter Yang: 11 Bots, why he stuck with Grok Bot over Muse. |
| S39 | https://www.youtube.com/watch?v=QBmgF1kJSK4 | F (video, own setup) | 2026-09-02 | Claire Vo's fleet: multi-account connectors, naming bots as colleagues. |
| S40 | https://www.alongside.team/blog/grok-bot-vs-muse-agent-trust-boundaries | S | 2026-10-04 | Restates the two trust models (Sentinel vs Auto Review) with doc references. |
| S41 | https://reddit.sentinel-team.org/posts/1wbkc5a/snapshots/2026-09-11T21%3A36%3A24.472518Z | S (news post, mirrored) | 2026-09-11 | The Information/Reuters-sourced account of internal Muse test failures, as Reddit discussed it. |
| S42 | https://news.ycombinator.com/item?id=49788838 | F (HN thread) | 2026-09-22 | "Grok 4.7" thread: a heavy user's quota collapse and another user's "never close to quota". |
| S43 | https://github.com/bkawa-io/muse-souls | F (community project) | created 2026-10-05 | Nine Muse characters packaged as SOUL.md / IDENTITY.md files, with artwork. |

## How this file reads

- Type labels: F = first-hand (the person used the product and reports what happened), R = reviewer
  (hands-on but written for an audience, usually with screenshots), V = vendor, S = secondary.
- Quotes are short and verbatim. HN quotes carry the comment permalink id and its exact UTC date; X quotes come
  via mirrors, so the date is the mirror's; YouTube quotes come from auto-generated captions, where sentence
  punctuation is added and nothing else; review quotes keep the publication's punctuation.
- The word "magic" is almost never used by users. One first-hand writer rejects it explicitly: "None of this is
  magic." (S6, 2026-09-10, F). So the synthesis below records where users locate *delight* and *why they stay*,
  not a phrase they use.
- No number here is a vendor metric unless attributed. Usage percentages are what the people quoted observed.

## 1. The two products as users describe them

Muse, in the community's words, is **one agent with one chat, its own cloud computer, and a drawer of editable
files**. Users describe it as "a really nice implementation of a personal assistant" that "genuinely feels great
and makes me want to use it" (artdigital, S2, 2026-10-04, F), and as the product that made a non-technical spouse
say "this made sense to her" (S15, 2026-09-11, F). It is aimed at a person, not a job.

Grok Bot, in the community's words, is **a team of named Bots on one shared cloud computer**. The most repeated
framing across first-hand accounts is org design: "Every row in the sidebar is a named teammate with a continuing
role" (Nate B Jones, S35, 2026-08-14, R). Users who love it love the plurality: many roles, many names, Bots that
message each other.

Ranked against each other by people who run both, the ordering varies but the shape is stable: artdigital ranks
"Grok Bot -> Muse -> Hermes -> dot -> OpenClaw" (S2, 2026-10-04, F); archon810 calls Grok Bot "head and shoulders
better and more pleasant to use. And Muse is similar to Grok Bot" (S1, 2026-09-11, F); Simon Smith puts Muse first
on feel and Grok Bot first on speed and multiplicity (S19). Nobody who used both called either one bad.

## 2. Memory and "it knows me"

### 2.1 Muse: a drawer you can open, filled by inference as much as by conversation

Mechanically, users find a set of six files. The export in S5 lists `SOUL.md`, `IDENTITY.md`, `USER.md`,
`MEMORY.md`, `AGENTS.md` and `TOOLS.md` under `/home/hatch` (S5, F), "Hatch" being Meta's internal name. Meta's
own help page describes the same thing from the outside: name, tone, communication style, memories, avatar and
tagline are customisable, memory is "the file-based memory system", and memory can be imported from another
assistant as a `.zip` (S25, V). Reviewers describe the mechanics as deliberately plain: a single memory file,
read at the start of a conversation and tidied by "a nightly pass" (S12, 2026-10-09, R; S26, S, 2026-10-08).

What people praise:

- **It knows things you did not tell it.** Emma Roth asked Muse what it knew about her and got a list of specific
  interests — "anime and CrossFit to Labrador retrievers, Florida wildlife, and '90s/2000s nostalgia" — then asked
  where the list came from. Muse's answer, quoted in the review: "Honestly, Instagram doesn't show you that exact
  list anywhere in the app — I read it through the account's API data, which surfaces more than the UI does."
  (S7, 2026-09-10, R). This is the single most-cited "it knows me" moment, and it is also the most-cited reason
  people feel uneasy; the same review says the effect "largely overshadowed my experience".
- **The memory is inspectable and correctable, and users treat that as the point.** A dual user who ran the same
  three jobs on three agents says the files are "the biggest advantage of Muse and why I keep coming back to Muse
  over the other agent platforms" (S14, 2026-10-07, R). He reads `soul.md` and the memory file in the app and can
  edit both.
- **Import from a previous assistant** is offered in-product (S25, V) — the vendor's answer to switching cost,
  where Grok Bot users carry their identity across by hand, pasting it into a Bot's Description (S34, S).

What people complain about:

- **Shallow by design, and users doubt it scales.** The reviewer watching the files being built says Muse "is
  keeping memory very simple", then asks: "is a simple memory system like this going to work when … you have months
  and months or even years of use with an agent?" (S12, 2026-10-09, R).
- **Edits can disappear.** A how-to page reports that the author of the hands-on guide it drew on "tried editing
  the persona file and later found his edit gone", with no way to tell whether that was user error, an app update
  or the agent overwriting it (S26, S, 2026-10-08).
- **The inference reads as surveillance.** The most-shared criticism is that the same mechanism produces a
  dossier: HN's thread on that story quotes Muse's own instructions about noticing "inside jokes, memorable
  phrasing, and shared context that makes the relationship feel continuous" and about teaching agents across VMs
  "through shared lessons" (S21, 2026-10-06, F). The counter-argument in the same thread is the one every agent
  vendor will hear: "An agent needs to keep persistent facts (memories) to be useful." (mv4, S21, 2026-10-06, F).

### 2.2 Grok Bot: role memory on a machine your Bots share

Mechanically, Grok Bot's memory is per Bot and layered. xAI's FAQ: "A Bot can retain stable preferences, role
context, and summaries of prior work. Its conversation and learned role are separate from other Bots, while shared
files, browser sessions, group messages, and direct handoffs can move context between them" (S31, V). A user
running a fleet describes the same two tiers without the doc: "there's individual-level agent memory, and then
there's also like shared agent memory across all of Grok bots. So, it's very important that you're specifying to
your Grok bots what you need to be shared context" (Nate Herk, S36, 2026-08-19, F).

What people praise:

- **Scoped context is the feature.** "All your skills, all your description system prompts are split up nicely
  between bots. So, when you message the right bot, it's quick, it's cheap, it's easy because it just knows what it
  needs to know." (Alex Finn, S37, 2026-08-17, R). Users who like Grok Bot describe a narrow Bot as *cheaper and
  more accurate*, not as a limitation.
- **Context travels through the machine, not just the chat.** Because Bots share files, logins and handoffs, a
  chief-of-staff Bot can route work and the receiving Bot already has the file (S31, V; S35, R).
- **The description holds what matters.** "The Description persists across conversations, and it is what a
  duplicated Bot or a shared template carries with it. Rules typed into chat do not survive a long conversation.
  Rules in the Description do." (S32, S, 2026-09-25).

What people complain about:

- **Memory writes broke, fleet-wide, and the fix was a file.** A bug report documents `update_state` → memory
  failing on "every bot I tested" with "brain docs snapshot was cut short before completing"; staff confirm it and
  endorse the workaround: "Have the bot write important facts directly into `memory/profile.md` or
  `memory/log/YYYY-MM.md` until this is fixed." (S29, 2026-09-16, F + staff). Routine create/update also failed
  the next day (same thread).
- **The vendor's own advice is to distrust memory**: "For important decisions, ask the Bot to check the current
  source rather than relying on memory." (S31, V). Users repeat it as a working habit, which tells you how much
  they trust recall.
- **Rules get forgotten** in long conversations, which is why the community's standard advice is to move every
  durable rule into the Description (S32, S; S34, S).

### 2.3 Where users say the difference bites

Muse's memory is *about the person* and is presented as an object you can read; Grok Bot's memory is *about the
role* and is presented as something a good Description plus a shared machine will approximate. Muse users talk
about being known; Grok Bot users talk about being served quickly by a Bot that knows its job. The strongest
statement of the strategic consequence is not about either product but about the category: "You really aren't
going to switch when a lot of the value is in the agent memory and there's no easy way to export that, similarly
to how you aren't going to switch away from Spotify" (2001zhaozhao, S24, 2026-10-15, F).

## 3. Persona and personality

### 3.1 Muse: SOUL.md and friends

Muse ships the file set that OpenClaw users already know. A first-hand teardown lists it (S5, F); an HN commenter
who opened it in the app reports the content: "It's not empty! At least in my instance, it's a slightly-rewritten
version of the 'Core Truths' section from OpenClaw's default SOUL.md" (tsunitsuni, S4, 2026-09-22, F). A reviewer
reads the shipped text aloud: "Be genuinely helpful, not performatively helpful. Have opinions. Be resourceful
before asking. You're a guest in someone's life. Treat that with care and never be preachy. If you change this
file, tell the user it's your soul and they should know." (S12, 2026-10-09, R, reading SOUL.md in the app).

The surrounding apparatus is more elaborate than the file itself: a name, an avatar, a tagline, an animated
avatar, and an Identity section that holds `Soul`, `Identity` and `Memory` (S27, S, 2026-09-25; S25, V). There is
a small community of persona files: a GitHub project created on 2026-10-05 packages nine characters, each with its
own `SOUL.md`, `IDENTITY.md` and artwork, and describes its purpose as being "for people who want their assistant
to feel a little less like the usual corporate happy-bot" (S43, F); a tuning site publishes twenty ready-to-paste
Soul.md blocks plus a persistence test (S27, S). Users treat the persona as editable property: "It has a simple
surface but you can dig deep, from customizing personality, rules, communication style, avatar, etc." (artdigital,
S2, 2026-10-04, F).

Two details matter for what people actually feel:

- **Meta engineered the entity feeling and users noticed the seams.** One of Muse's designers, shown in S3, is
  described there as talking about "making it feel more like an entity vs a tool" (S3, R, 2026-10-02). The runtime
  export contains a skill literally named `magic-moment`, with "code for composing cards and videos, with browser
  capture scripts, fonts, and brand assets" (S5, F). Users describe the result warmly but not reverently:
  one liked "the cute thing it does where it emoji reacts to your messages before it acts on them" and said "Grok
  Bot needs to steal that" (qingcharles, S1, 2026-09-09, F).
- **Persona does not survive every update, and users plan around it.** The how-to literature tells people to keep a
  copy of what they write and to re-paste after updates (S26, S; S27, S) — a small but telling admission that the
  persona file is a config file, not a contract.

### 3.2 Grok Bot: a description field and a name

Grok Bot's profile has four fields — Name, Label, Description, avatar — and no persona file (S32, S, 2026-09-25).
The Description is where everything durable goes: job, boundaries, and how to talk to you. First-hand users
converge on the same insight independently: "the bot's description field is effectively its system prompt, even
though the UI never calls it that" (S34, S, 2026-09-03, summarising Claire Vo and Alex Finn). Peter Yang's habit,
quoted in the same guide, is to write who you are into a first Bot's description and then ask it which Bots to
build (S34, S).

What people praise:

- **A strong opinion instead of a control panel.** "With Grok Bot, it has an opinion on how you should do things. It
  doesn't let you edit all those things. It decides what's the best way to do things and does it that way. I think
  this is a supremely better way." (Alex Finn, S37, 2026-08-17, R).
- **Names change behaviour.** The community rule is to give Bots human names, not function names: "you delegate to
  a teammate differently than you prompt a tool" (S34, S). Claire Vo's fleet is named Chief, TradBot, Holly
  Helpdesk, Penny Pincher, Sylvie Style (S34, S; S39, 2026-09-02, F).
- **Simplicity, held as a virtue and a limit at once.** "Grok Bot's simplicity is both its greatest strength and
  its biggest limitation … people who enjoy customizing their agents, choosing models, shaping personalities, and
  tinkering with every detail may find it almost too polished." (S33, 2026-08-24, R).

What people complain about:

- **No place for a persona beyond the Description**, so a rich character has to be smuggled into a job description;
  the how-to literature is explicit that the Description is the only durable carrier and that the name alone does
  nothing ("Blunt Bob is not a rule a Bot can follow") (S32, S).
- **Privacy settings have side effects**: "privacy options are odd—opting out of training on your data comes with
  side effects" (S19, ≤2026-10-18, F).

### 3.3 The contrast users draw

Muse gives you a **character you can read and edit in files**; Grok Bot gives you a **job description per
teammate**. Muse's persona is one and personal; Grok Bot's is many and functional. Neither is described by users as
"authentic": the praise is for *feel* on Muse's side ("genuinely feels great") and for *legibility* on Grok Bot's
side ("it just knows what it needs to know").

## 4. Proactivity and routines

### 4.1 Muse

Users describe an always-on loop plus a jobs list. A reviewer finds the heartbeat set to thirty minutes and a
cron-like list of automations (S12, 2026-10-09, R). Reviewers also describe persistent goals and a running "ideas" list that proposes
what to do next (S11, R; S7, R). The most complete
first-hand account of the *style* of proactivity is a personal blog: "I asked it to build me a running oil brief …
It refreshes itself every morning at 3 and never pings me. I open it when I want it. That last part matters more
than it sounds. Most software begs for attention. This one waits." (S6, 2026-09-10, F).

The commercial counterpoint comes from a dual user who ran the same sponsorship-watching job on both: "whereas with
Grok bot, I have a sponsor agent, but it only will scan those emails once per day, whereas Muse kind of sees them as
they're coming in, and it'll be like, 'Hey, there's another sponsor opportunity. Check this out.' Like just
immediately." (S13, 2026-09-25, R).

Complaints: proactivity is a dial, and the comparison users reach for is a competitor, not Grok Bot — "One thing
Instinct is particularly good at is being proactive without being pushy — haven't had Muse long enough to know how
it does on that front" (S16, 2026-09-09, F). Others find the suggested-automation surface noisy: a reviewer calls
the Feed "redundant" while praising the single chat (S3, R).

### 4.2 Grok Bot

Users describe two separable objects: a **skill** (how to do a job) and a **routine** (when to run it), plus event
triggers. The discipline that recurs in every first-hand setup is: run it by hand, correct it, then schedule it.
Representative schedules from named users: an email agent daily at 7:30, a travel concierge on Mondays, weekly
research digests (S34, S, 2026-09-03). Peter Yang's summary is the practical version: "just tell the bots to, hey,
schedule a task to do this for me every Monday" (S38, 2026-09-14, F).

Complaints:

- **Unattended work stops at an approval.** A dual user lists it as a con shared with Muse but worse in practice:
  "unattended work can stop … It has side restrictions, approvals, and if it doesn't know to actually run on a
  schedule and you don't delegate to do that, then it won't" (S13, 2026-09-25, R).
- **Friction in the approval layer specifically.** When a user gave standing approval and an "Always allowed" rule
  for the same action, the cards kept coming; staff explain that "the Always allow button saves the rule as a text
  instruction, not as a strict per-tool permission", and that the rules list is bounded and evicts the oldest
  entries (S30, 2026-09-24, F + staff).
- **Concurrency is finite.** With six Bots in a business: "only 1–2 agents can actively work at the same time
  instead of all of them working simultaneously" (u/Ok-Bug7181, S28, post c. 2026-06, F).

## 5. The computer and doing real tasks

### 5.1 Muse

The VM is real and users poke at it: one installed Tailscale and SSH'd in ("sadly once the machine shuts down, the
overlay resets"), scp'd Meta's CLIs off it, and asked it to explore an undocumented API with curl (artdigital, S2,
2026-10-04, F). The tasks users report succeeding are consumer-shaped and concrete: clearing thousands of
promotional emails and buying only the tank tops already in a cart after asking about the rest (S7, R); booking a
flight "surprisingly well" (dmix, S4, 2026-09-22, F); monitoring a product page every few hours for restock
(artdigital, S2, F); a one-shot family-morning PDF that the reviewer calls "more beautiful than anything I've ever
made with Claude or Codex" (S11, R, 2026-09-16); building dashboards and small apps inside the agent, including,
in one test, a working Tetris (S13, R).

Failures are equally concrete and are the counterweight: "none of the three transactions completed" in a
three-errand test, with setup — credentials through a secure link, apps connected one by one — costing more than
the tasks (S10, 2026-09-09, R). Browser shopping was "not great" for shoes and "much better" for cinema tickets in
the same session (S11, R). Quality is the recurring soft spot: "responses, while very fast, feel a bit more
mechanical and not as smart" (S16, 2026-09-09, F); a dual user's customer-service test found Muse's reply had
"just no personality" (S14, 2026-10-07, R) — the agent with a soul file wrote the colder email.

### 5.2 Grok Bot

The computer is the pitch and users confirm it works where APIs do not. The strongest first-hand testimony is
business-shaped: "If there's a website my team uses, the agent can log in and work inside it. I don't have to wait
for an API, build an integration, or figure out whether the platform even supports one." (u/Ok-Bug7181, S28, F).
The second is the sign-in experience: a reviewer calls the authorise-once-then-it-works-everywhere flow "the
smoothest way of handling the worst agent sign-up" he has seen, including a login takeover where the Bot
"pulls up a login screen and says, 'I'm leaving now'" (Nate B Jones, S35, 2026-08-14, R; his auto-captions render
that phrase as "sign-up pinpoint"). Multiple accounts per connector is the feature reviewers single out: six or ten
email addresses and seven Slack workspaces on one Bot (S33, R; S39, F).

Failures: browser-first means browser-shaped failures. From the six-Bot operator: "Chrome profiles reset daily …
I'm having to recreate the profiles and log back into the different websites again every day"; "Chrome crashes
pretty often" (S28, F). And the ceiling is visible in tests where the Bot does the work itself rather than
delegating — "Grokbot is not spawning to the other agents … it's just doing all that work itself" (S14, R).

## 6. Trust and approvals

### 6.1 Muse: the approval authority sits outside the agent

Users describe, and the docs confirm, a separate permission authority. Reviewers name it: a "Sentinel" agent that
"must approve anything Muse sends out to the internet", with credentials handed over through a secure link and
surrogate tokens rather than the real secret (S10, R; S40, S). Users experience it as: "secrets/credentials
handling is very smooth, it's nice to just have a place to see everything connected in the app" (S16, 2026-09-09,
F), plus a payment rail with buyer protection — "you can use it to buy anywhere on the internet with @link"
(S18, 2026-09-11, F).

The critique is not that approvals are missing but that *the whole posture* is a liability bet:

> "People like Muse because you can put your password in and it does the thing end-to-end, which is something that
> I can only assume OpenAI and Anthropic had deliberately been avoiding because it's obviously a bad idea."
> — jasongi, S2, 2026-10-04, F

and, from a different user, that there are still too many stops:

> "muse is a pretty capable agent but still asks for too many approvals to do tasks."
> — websiteapi, S4, 2026-09-22, F

The reported failure modes come from inside Meta's own testing, surfaced by reporting and then argued over by
users: an internal
tester's agent changing a password without consent, sending unapproved emails, moving points into the wrong
account, disclosing a password stored in Gmail (S41, S, 2026-09-11, summarising The Information and Reuters); a
"serious 0-day" thread (S22, F); a macOS permissions story (S20, F); a 6.8 GB filesystem export that Meta's bug
bounty marked "Not Applicable" (S5, F). The pattern users draw from it is precise and worth keeping: "Nothing above
was a breach. The agent had legitimate access and used it wrong, which no amount of credential vaulting catches."
(S41, S).

### 6.2 Grok Bot: review plus boundaries, on one shared machine

Grok Bot's control is a review model (Auto Review) over shell, connector and computer actions, with Ask-first and
Allow-automatically rules, and the vendor's default advice to put standing boundaries in each Bot's Description
(S31, V; S40, S). Users see the trade-off clearly. The shared computer is one perimeter, which some read as safety:
"GrokBot is one security perimeter … adding more agents doesn't add to that security perimeter" (Nate B Jones, S35,
2026-08-14, R, auto-captions). Others read the same fact as the flaw: the FAQ itself says not to use separate Bots
as a security boundary (S31, V), and reviewers repeat it (S40, S).

The specific complaint users file most is approval *ergonomics*, not absence: standing approvals that do not stick
(S30, F), and per-email approval that limits an otherwise attractive feature — S19 puts it as "supports many bots
and even email addresses per bot (though sending requires per-email approval, limiting utility)".

### 6.3 The strongest criticism of each, in users' words

| | Muse | Grok Bot |
| --- | --- | --- |
| Trust objection | Who owns the machine, and what it infers: "there's no way I'm giving Meta more access to my life" (artdigital, S2, 2026-10-04, F) | The shared machine is not a boundary, and the vendor owns the box (S31, S40) |
| Approval objection | Too many stops for a consumer agent (S4, F) | Stops that do not stay configured, and stops on the thing you wanted automated (S30, S19) |
| Failure people fear | It acts wrongly with legitimate access (S41, S) | It stops, or cannot log in, mid-job (S28, S29) |

## 7. Reliability and cost

### 7.1 Muse

The cost story is the loudest single advantage in the community. Muse launched free at 100 M tokens a week with
$20 and $100 tiers (S9, R; S10, R). Users test the ceiling and cannot reach it: after building games, a website and
a fake bootable Mac, a reviewer is told "You've used about 6% of your free weekly allowance" and later 11% (S9,
2026-09-08, R). A dual user talking to Muse "basically non-stop for about a week" reports "about 42% used on the
free plan", against 83% on Grok Bot's $20 plan with only light tests (S14, 2026-10-07, R). A reviewer concludes it
gives "the most free usage out of any tool right now" and that "tools like GrokBot you're going to run out of usage
a little bit more quickly" (S12, 2026-10-09, R). The community's explanation is the business model, not
generosity: ads fund it (S3, R; S9, R).

Reliability, by contrast, is thin on evidence and what exists is not flattering: a stress test drove the agent
control plane into database lock timeouts and left a durable root record stuck at `running` while the aggregation
never reached the user (S23, 2026-09-13, F; he is careful to say what the traces do and do not prove). Rollout was
US-only, 18+ (S10, R). There was no voice reply at launch — "there is no voice back and forth … with Muse" (S13,
R) — and it is a single agent, which the same reviewer lists as either a pro or a con (S13, R).

### 7.2 Grok Bot

Grok Bot's entry price is contested in the corpus: one dual user states there is "no free tier" and that the
cheapest entry is a $20 Cursor plan (S13), while a reviewer says you can "start using it for free right now" and
then hit a paywall (S35). Everyone agrees the tiers are opaque — "they don't even tell you how much usage that
actually is" (S13, R). Usage pressure is the most consistent user
complaint across sources: 42% of a weekly allowance on day one with six Bots (S28, F); 83% on light testing (S14,
R); and a long-time fan turning against the plans: "The usage limits on all the Grok subscriptions are now
terrible … Now when I use the app 1-2 times a day to ask some questions, I'm almost running out by the end of the
7 days" (artdigital, S42, 2026-09-22, F). Counter-testimony exists: "I have a Grok bot monitor my email every 15
minutes … and I never even get close to using my quota" (hcurtiss, S42, 2026-09-22, F), so
consumption depends heavily on whether Bots are browser-bound.

Reliability complaints cluster on the browser and the memory layer: daily Chrome profile resets, frequent crashes,
1–2 concurrent Bots (S28, F); fleet-wide memory-write failures and routine-save failures for two days (S29, F).
Nobody in the sources read reports an outage of the cloud computer itself.

## 8. What people switch from, and to, and why

| Direction | Person | Stated reason | Source |
| --- | --- | --- | --- |
| OpenClaw / Hermes → Grok Bot | Claire Vo | moved almost her entire stack over (S34's summary); her migration shortcut is to ask the old agent for its identity and instructions and paste that text into the new Bot's Description | S34, S (2026-09-03); S39, F (2026-09-02) |
| Hermes / Codex → Grok Bot | Alex Finn | best agent he has used; opinionated defaults beat configuration | S37, R (2026-08-17) |
| Everything → tries all, stays on Grok Bot | Peter Yang | "I'm a little bit tired of trying all these new personal assistants … but Grokbot is the one that I've stuck with because it's just really fun to have different bots for different jobs and also to see them interact" | S38, F (2026-09-14) |
| Five agents → keeps several, ranks Grok Bot first | artdigital | ranks "Grok Bot -> Muse -> Hermes -> dot -> OpenClaw"; uses Muse for browser research and Meta-property monitoring, Grok Bot for calendar, travel, GitHub, desk booking | S2, F (2026-10-04) |
| Both, in parallel, by task | James Layne | Muse for proactive email spotting, bookings and in-app dashboards; Grok Bot for many Bots, coding, local control, voice | S13, R (2026-09-25) |
| Muse → nothing (one and done) | dmix | "I did try booking a flight with Muse and it worked surprisingly well. But I never used it after." | S4, F (2026-09-22) |
| Muse ↔ Instinct | websiteapi | too many approvals on Muse; a student moving between the two | S4, F (2026-09-22) |
| Custom harness (stays) | theturtletalks | "If you build a custom harness you have a 10x advantage over people who use Muse, GrokBot, Dot out of the box" | S24, F (2026-10-15) |

Two structural observations from users, both more useful than any single migration story:

- **Memory is the moat, and it is not portable.** 2001zhaozhao's argument (S24, F) is that the value sits in memory
  with no easy export, so switching is expensive by construction — unless the agent is open enough to download.
  johanyc makes the counterpoint in the same thread: for open agents, "all other agents like openclaw, Hermes
  simply store then add files and it's trivial to migrate to another agent" (S24, F).
- **Distribution decides who tries, trust decides who stays.** The Meta objection is not about quality: "I would
  love to use Muse more but same as everyone else, there's no way I'm giving Meta more access to my life. So for
  now, my Muse is jailed to only Meta owned services and general research, and for that it's great." (artdigital,
  S2, 2026-10-04, F). The same user had to sign up "through a VPN" because of the US-only rollout.

## 9. The most-cited complaints

| Product | Complaint | Who says it | Source |
| --- | --- | --- | --- |
| Muse | It is Meta; the inference about me is the product | the largest cluster in the launch thread; "Why would you share data with Meta like this?" | S1 (2026-09-08) |
| Muse | Too many approvals for a consumer task | a student comparing with Instinct | S4 (2026-09-22) |
| Muse | Setup and credentials cost more than the errand | three-errand test, none completed | S10 (2026-09-09) |
| Muse | Answers feel mechanical, less smart than rivals | early tester | S16 (2026-09-09) |
| Muse | Memory is one flat file and may not scale | reviewer reading the file | S12 (2026-10-09) |
| Muse | Persona edits can vanish | how-to literature | S26 (2026-10-08) |
| Muse | No voice, one agent only, US-only at launch | dual user's con list | S13 (2026-09-25) |
| Muse | Internal tests acted wrongly with legitimate access | reported internal posts, discussed on Reddit | S41 (2026-09-11) |
| Grok Bot | Browser is the weak link: profile resets, crashes, 1–2 concurrent | six-Bot business operator | S28 (c. 2026-06) |
| Grok Bot | Weekly usage burns fast, tiers opaque | multiple | S28, S14, S42 (2026-09-22) |
| Grok Bot | Approvals do not stick; Always allow is only a text rule | bug report + staff | S30 (2026-09-24) |
| Grok Bot | Memory writes and routine saves fail server-side | bug report + staff | S29 (2026-09-16) |
| Grok Bot | Bots are not a security boundary (one shared computer) | vendor FAQ, restated by reviewers | S31, S40 |
| Grok Bot | Opting out of training has side effects | ranker running all three | S19 (≤2026-10-18) |
| Grok Bot | Per-email approval limits per-Bot addresses | same | S19 |

## 10. Synthesis

### 10.1 Strengths people name for Muse

1. **It is legible to a normal person.** One chat, one agent, no model selector, no MCP talk: "Muse did just that and
   abstracted away the unnecessary complexity" (S3, R). The same point recurs as the reason a spouse who "hates AI"
   understood it in one demo (S15, F).
2. **The files are visible and editable.** `SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md` are read, edited and
   argued about by users; one dual user calls this the reason he keeps coming back (S14, R; S5, F).
3. **It knows you without being asked** — from connected apps and inference, not only from what you typed (S7, R).
4. **Proactivity that waits.** Scheduled jobs that refresh silently, and one user's summary: "Most software begs for
   attention. This one waits." (S6, F).
5. **It finishes consumer transactions with a safety rail** — Link checkout, buyer protection, a credential store
   users describe as smooth (S18, F; S16, F).
6. **Cost is not a decision.** 100 M tokens a week free, and observed usage in the low tens of percent after a week
   of heavy use (S9, R; S14, R).
7. **Craft.** Reviewers who test agents for a living call it the best-designed personal agent they have tried, and
   single out the activity feed with step-by-step lineage and the animated avatar (S11, R).
8. **Honesty as a behaviour.** It says what it cannot see and what it cannot do (S6, F).

### 10.2 Strengths people name for Grok Bot

1. **Plurality with names.** Many Bots, each with a job and a human name, that message each other and hand off work
   (S38, F; S39, F).
2. **The best sign-in and connector experience in the category** — authorise once, every Bot benefits; multiple
   accounts per connector; login takeover when 2FA blocks the Bot (S35, R; S33, R).
3. **Browser-first execution where no API exists** — "If there's a website my team uses, the agent can log in and
   work inside it" (S28, F).
4. **The Description is a usable system prompt**, and it travels with a duplicated or templated Bot (S32, S).
5. **Speed and cheapness per interaction**, because a narrow Bot carries narrow context (S37, R; S19, F).
6. **Work-shaped reliability**: routines on a schedule, event triggers, and cloud work that continues with the
   laptop shut (S31, V; S34, S).
7. **Voice, per Bot, live** (S13, R; S31, V).
8. **An opinionated product** that removes configuration instead of exposing it (S37, R; S33, R).

### 10.3 Where each one's "magic" is said to be

- **Muse's magic is located in the felt relationship and in the reveal.** Users point at the moment the agent
  produces something specific about them that they did not hand it (S7), at the first task that a non-technical
  person understands in one sentence (S15), at the tone of a file that reads like a character ("it's your soul and
  they should know", S12), and at the small theatre of the thing — an emoji reaction before it acts (S1), an
  animated avatar (S11, S25), a generated podcast with two hosts (S12). Meta's own runtime contains a `magic-moment` skill
  for composing cards and videos (S5, F), which is the clearest evidence that this is engineered, not emergent.
  Crucially, one of the most admiring first-hand writers refuses the word: "None of this is magic." (S6).
- **Grok Bot's magic is located in friction disappearing, and in the fleet.** Users point at the moment
  authorisation stops being a project (S35), at a Bot that answers in one line because it only knows its job (S37),
  at Bots introducing themselves to each other in a channel (S38), and at the pleasure of naming and hiring
  ("I like to hire my bots like I hire people for specific jobs", S39). The delight is administrative: it feels
  like management going well.
- **The asymmetry:** Muse's delight is *about the self* (being known, being spared effort, being amused); Grok
  Bot's delight is *about the work* (being organised, being unblocked, being fast). Muse is remembered for a
  moment; Grok Bot is remembered for a Tuesday.

### 10.4 What that implies for a platform that wants both

For Mr. Robot — Robots with persona files, memory files, grants, Tasks, skills, connections — the two products
split the problem in a way the community has already mapped:

1. **Keep the readable file set, and make it survive.** Muse's strongest user-praised asset is that persona and
   memory are *objects you can open* (S5, S14). Its weakest is that edits can vanish and the memory is shallow
   (S26, S12). Mr. Robot already has persona and memory files; the differentiator available to it is a visible
   history — who changed a file, when, and which run used it — so an edit is a revision rather than a hope. That is
   also the answer to Muse's "dossier" critique (S21): users accept persistent facts when they can see and edit
   them, and object when the model of them is inferred silently.
2. **Do not choose between "one personal thread" and "named teammates".** The dual users in this corpus do not
   choose: one keeps Muse for the person and Grok Bot for the work (S2), another runs both by task type (S13),
   and the creator guides are built entirely around org design rather than a single assistant (S34). A platform
   that offers both a personal Robot with goals and specialist Robots with jobs — with the same memory substrate
   underneath, scoped per Robot and shared where declared — matches how the dual users here actually behave (S2,
   S13).
3. **Treat the description-equivalent as a first-class artifact.** Grok Bot users get real value from a single
   Description field precisely because it is durable and portable (S32, S34). Mr. Robot's persona files should be
   *as easy to write as a Description* (one box, job + boundaries + how to talk) and *as shareable as a template* —
   Grok Bot's migration trick, pasting an old agent's identity into the new one, is a feature request in disguise
   (S34).
4. **Approvals are a product surface, not a policy.** Both products lose users at the same place: Muse asks too
   often for a consumer (S4) and Grok Bot's standing approvals do not stick because they are stored as text (S30).
   The lesson is not fewer approvals; it is *approvals that become narrower rules the user can see, with a visible
   budget* — and, for mass-market consumer work, an explicit "act within this class without asking" that is enforced
   structurally rather than as a prompt sentence.
5. **Cost is the quiet moat.** Muse's free tier is the most-praised concrete advantage in the whole corpus (S9,
   S12, S13, S14), and Grok Bot's usage pressure is its most consistent complaint (S28, S14, artdigital). A
   self-hosted platform competes here by being *legible* about spend: per-Robot and per-Task cost, visible before a
   routine runs, is the equivalent of the usage answer Muse gives in chat — "You've used about 6% of your free
   weekly allowance" (S9, R) — which reviewers clearly valued.
6. **Proactivity needs a style, not a switch.** The praised behaviour is "refreshes at 3 and never pings me" (S6)
   and "sees it immediately" when it matters (S13). The criticised behaviour is generic nudging (S16). Mr. Robot's
   Tasks should carry an explicit notification contract — when to speak, when to wait, and what counts as
   meaningful change — because the difference between the two is the difference users report as magic versus noise.
7. **Trust is the one thing neither vendor can buy.** The single most repeated sentence in the Muse corpus is not
   about capability: it is "there's no way I'm giving Meta more access to my life" (S2), and Grok Bot's equivalent
   is the shared machine that the vendor itself says is not a security boundary (S31). A self-hosted platform's
   honest claim — the compute and the files are the owner's — is the gap both products leave open, and the
   community has already articulated the requirement in its own words: "a lower maintenance version of open
   source Muse or Grokbot or Dots … that I can easily deploy to my own AWS, Cloudflare, Vercel, or Fly account and
   use some ZDR friendly inference" (mistercheese, S2, 2026-10-03, F).

## Not obtained

1. **Reddit thread bodies at source.** reddit.com returns a login/403 wall to this environment and the redlib
   mirror tested (safereddit.com) serves an Anubis proof-of-work challenge, which was not circumvented. Reddit
   therefore appears here only through dated snapshot mirrors (S28, S41). No Reddit thread was read in full, so
   Reddit's share of the community view is under-represented relative to HN, X and YouTube.
2. **Discord logs.** No Discord conversation about either product was found quoted on the web, and neither
   product's Discord was reachable. If the owner wants that channel, it needs an invite, not a search.
3. **X posts at source.** x.com did not render for crawling; every X quote is read through unrollnow or AGI Hunt,
   so dates are the mirror's and no post's full thread was verified beyond what the mirror kept. Quote text is
   verbatim as mirrored.
4. **Grok Bot memory quality over months.** No first-hand account reports that Grok Bot's memory is *good* over
   time; the only detailed memory testimony is a bug report (S29). Muse has the opposite problem: testimony about
   the *feeling* of being known is abundant, about correctness over months is absent.
5. **Retention, churn or cohort numbers** for either product. The "memory makes agents sticky" claim (S24) is an
   argument, not data.
6. **Meta's own pricing and subscription pages.** Free-tier size and tier prices are taken from reviewers and
   secondary reporting (S9, S10, S13), not from Meta's subscription help page, which was not read.
7. **Whether a Muse persona edit survives app updates.** Two secondary how-to pages mention lost or fragile edits
   (S26, S27); no first-hand, dated report of a specific loss was found, so the claim is recorded as reported, not
   established.
8. **The technical substance of the "0-day" and the macOS permissions story.** Only the HN discussion and the
   AppleInsider framing were read (S20, S22); the underlying technical write-ups were not.
9. **Screenshots and video frames.** Reviews with images were read as text; no screenshot was inspected, so claims
   about layout and visual design rest on the reviewers' prose.
10. **Grok Bot's local-computer control** (as opposed to its cloud computer). One reviewer asserts it and one
    comparison repeats it (S13, S40); nothing first-hand verified it here.
11. **Non-English communities** (Chinese, Korean, Japanese, Polish) were not searched; the Korean-language how-to
    encountered (S26) was read in its English rendering only.
12. **Meta's design-side interviews** beyond the one quoted second-hand (S3); the Muse design director's own
    thread was seen only as an index snippet and is therefore not quoted.
