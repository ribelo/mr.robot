# Grok Bot templates: anatomy, lifecycle, marketplace, and whether they are data

Research date: 2026-10-21. Scope: what a Grok Bot template *is* as an object — every field it carries, where each field is shown, what the person who adds one receives, how a template is created and published, how the marketplace renders it, and whether any format, export, import, API or deep link exists. Written for the owner of this repository, who wants to design templates from first principles and, if possible, load Grok Bot templates into Mr. Robot.

Method: every x.ai and docs.x.ai page was fetched on 2026-10-21 with a desktop browser User-Agent (Chrome 141 on macOS); requests without one are refused. The marketplace and its template pages are Next.js App Router pages with no `__NEXT_DATA__`; the template object travels inside the React Server Component (RSC) flight payload as `self.__next_f.push([1,"…"])` records, which were decoded, text-chunk references resolved, and parsed. All 90 public template pages were fetched and parsed for the counts in section 3.2. A number without a citation is one of those measurements.

Branding: the pages title themselves "SpaceXSI". Sign-in and billing run through Cursor; marketplace images are served from an S3 bucket named `grok-bot-marketplace-public-assets`.

---

## 1. Sources

| # | Source | URL | What it gave |
|---|--------|-----|--------------|
| S1 | Bot Marketplace index | https://x.ai/bot/marketplace | Rendered page, JSON-LD with two ItemLists, 4 RSC pushes, search placeholder |
| S2 | Marketplace template page, Overheard | https://x.ai/bot/marketplace/bots/overheard | The full 18-key template object in the RSC payload; the rendered page's sections. The same page type was fetched for all 90 slugs (S10) |
| S3 | Template share page | https://x.ai/bot/NIEguoGUjA648fUPle8F5 | What a "Copy link" URL contains, and the `grokbot://` deep link |
| S4 | Grok Bot changelog, page and RSS feed | https://x.ai/changelog/bot · https://x.ai/changelog/bot/rss.xml | The template lines of 0.30.0, 0.37.0, 0.41.0, 0.48.0, 0.54.0, 0.57.0, 0.63.0, 0.67.0, 0.70.2 and 0.71.2, verbatim |
| S5 | Docs: Create and manage Bots | https://docs.x.ai/grok-bot/bots | The "Share a Bot" procedure, what a public link shows, what adding copies, Marketplace import |
| S6 | Guide: Templates for Grok Bot (2026-09-08, Matt Palmer) | https://x.ai/bot/guides/templates-for-grok-bot | The recipe-not-clone definition, what is packaged and what is left out, the publish and add walkthrough |
| S7 | Docs: FAQ | https://docs.x.ai/grok-bot/faq | "The link exposes the Bot's configuration"; the short share procedure |
| S8 | Docs: Team Bots | https://docs.x.ai/grok-bot/team-bots | The Personal Bot / public template / Team Bot comparison table; the Publish to Team flow |
| S9 | Use-cases gallery | https://x.ai/bot/use-cases | 56 roles, category filters, one Add link each |
| S10 | x.ai sitemap | https://x.ai/sitemap.xml | The complete URL scheme: 290 URLs, 90 template pages, 9 category pages, 20 guide pages |
| S11 | Marketplace category page | https://x.ai/bot/marketplace/from-grok-bot-team | Category page shape and search placeholder |
| S12 | Third-party bot terms | https://x.ai/legal/bot-sharing-terms | Licence, responsibility for connecting accounts, prohibition on re-export |
| S13 | Cursor RPC, observed | POST https://api2.cursor.sh/aiserver.v1.GrokBotService/GetPublicGrokBotTemplate | Unauthenticated 200 with template metadata, version and blob key; the import-details route answers 401 |

S2 is a page type, not one page: section 3.2 reports what all 90 pages of that type contain. Nothing here comes from a write-up.

---

## 2. What a template is

xAI's definition, in its own words: "Templates share a bot as a recipe, not a clone" (S6). "A template is a collection of skills, memories, and plugins" (S6). The docs phrase it as configuration: a public link "shows the Bot's shared configuration, including its identity, description, skills, and routines" (S5).

Three consequences follow from the sources, and they matter more than the definition:

1. **A template is generated from a Bot, not authored separately.** The creator opens the Share menu and chooses Create template; "the Bot builds the template" (S5). No source read describes a template editor, a template file, or a way to write one from scratch.
2. **It is a sanitised projection.** "When you create a template, you create a copy of the bot's instructions, relevant memories and skills, and specific plugins" (S6). Personal or internal memories are left out "by default"; custom code and scripts are not included; non-standard plugins such as MCP servers are not included (S6).
3. **It is a copy, not a live link.** "Adding a shared Bot creates a copy on the recipient's account. It does not give them your computer, logins, or conversation history" (S5). No source says that a template change reaches copies already added.

The guide's own metaphor: "If I give you a recipe, you will use it to create your own version of that meal. Your meal will look different from what I created with the original recipe" (S6).

**What it is not.** A template is not a Team Bot: a Team Bot is one shared Bot with owners, managers, team memory and a Slack app (S8), while a template is a configuration copied to each adder. It is also not the share link itself: the link is a pointer to a template, and a template page is a separate object (section 6).

---

## 3. Anatomy: every field

### 3.1 The published object

Every marketplace template page embeds one JSON object under the key `template`. It has exactly 18 keys, the same set on all 90 pages (S2). This is the complete anatomy as published.

| Field | Shape | Where it is shown | Editable by the adder | Source |
|---|---|---|---|---|
| `id` | string, the URL slug | nowhere except the page URL `/bot/marketplace/bots/<id>` | no | S2 |
| `name` | string | page heading, marketplace card, name of the new Bot | yes — an added Bot can be renamed | S2, S5 |
| `creatorName` | string, a person or team name | "By <creator>" under the heading | no | S2 |
| `handle` | string, an x.ai handle | not rendered on the page | no | S2 |
| `description` | string, one paragraph | the paragraph under the heading; the new Bot's description | yes | S2, S5 |
| `summary` | string | identical to `description` in all 90 objects | nothing separate to edit | S2 |
| `categories` | array of strings | category pages, cards, filters; not printed on the template page | no | S1, S2 |
| `installCount` | number | not rendered anywhere | no | S2 |
| `color` | colour name (`orange`, `blue`, …) | the new Bot's avatar | yes, in the avatar editor | S2, S4 0.71.2 |
| `shape` | shape name (`teardrop`, `cloud`, …) | the new Bot's avatar | yes, in the avatar editor | S2, S4 0.71.2 |
| `addHref` | string, `/bot/<opaque id>` | behind the "Import Bot" button | no | S2 |
| `imageUrl` | HTTPS URL | the creator's picture on the page and card | no — it is the creator's image, not the Bot's avatar | S2 |
| `updatedAt` | ISO timestamp | not rendered | no | S2 |
| `instructions` | string | nothing on the page | unknown — empty in every public object | S2 |
| `memories` | array of `{id, name, description}` | section "memories — Facts it already knows"; each rendered as a paragraph | yes, after adding, as the Bot's memory | S2, S6 |
| `skills` | array of `{id, name, description, content}` | section "skills — Playbooks it can run"; names and one-line descriptions | yes, after adding, in the Bot's skills | S2, S6 |
| `routines` | array of `{id, name, summary}` | section "routines — Jobs that run on their own"; names and one-line summaries | yes, after adding, but no schedule arrives | S2, S6 |
| `integrations` | array of `{id, name, description}` | section "integrations — Apps it can use"; names and one-line descriptions | yes, after adding; each account is connected by the adder | S2, S6, S12 |

"Editable by the adder" is about the copy, not the template: the adder never edits the template object, but the added Bot is an ordinary Bot whose profile, memory, skills and routines are the normal editable surfaces (S5 documents editing name and description; the guide describes the new Bot as "a distinct new copy"). No page says an added Bot's inherited items are locked.

There is **no** field for: files, secrets, plugin credentials, routine schedules, routine prompts, skill bodies, suggested prompts, starter prompts, a licence, a version number, a changelog, or an export format. None of those words appears as a key in any of the 90 objects.

### 3.2 The measured corpus

All 90 template URLs from the sitemap (S10) were fetched and parsed. Every page yielded one object.

| Measure | Result |
|---|---|
| Pages fetched and parsed | 90 of 90 |
| Distinct key sets | 1 (the 18 keys above) |
| Templates with non-empty `instructions` | 0 |
| Templates with `installCount` above 0 | 0 (the field is 0 on all 90) |
| Templates with memories | 85 — 622 memories in total |
| Templates with skills | 75 — 443 skills |
| Templates with routines | 67 — 148 routines |
| Templates with integrations | 68 — 321 integrations |
| Templates with all four arrays empty | 1 (`seed-a91e4c`, "SWE" by Cursor) |
| Distinct `creatorName` / `handle` | 48 / 40 |
| Memory length, min / mean / max | 27 / 371 / 6144 characters |
| Skill description length | 36 / 157 / 436 characters |
| Routine summary length | 15 / 127 / 335 characters |
| Memories containing "never", "do not" or "don't" | 332 of 622 |
| Routine summaries that say paused, disabled or enable-only | 45 of 148 |

Category assignments (a template can carry several): From Grok Bot Team 54, Marketing 25, Sales 23, Personal 14, Engineering 8, Product 7, Design 4, Operations 4, Recruiting & People 2.

Two cautions about these numbers. `installCount` is not a popularity signal: it is 0 everywhere, so either it is not populated on the public pages or the pages are static. And "45 of 148 routine summaries say paused" is a text measure, not a state: the object has no enabled flag, so the disabled state is asserted by the creator's prose, not carried as data.

### 3.3 What is not carried

The guide and docs are explicit about the exclusions:

- **Secrets and keys.** "Templates do not include secrets" (S6); "Remove API keys … before you share" (S5); the terms say anyone with the link sees "the full configuration, including skills, routines, and identity content" and that the sharer must review it for sensitive information (S12).
- **Files on the Bot's computer.** Adding "does not give them your computer" (S5); custom code and scripts are excluded (S6).
- **Logins, cookies and connected accounts.** Excluded (S5, S7); the terms put the burden on the adder: "You are responsible for connecting your own accounts for any integrations this bot requires" (S12).
- **Conversation history and learned memory.** Excluded (S5); the same exclusion as Duplicate, which "does not copy conversation history, learned memory, or chat attachments" (S5).
- **MCP servers and other non-standard plugins.** "If there are non-standard plugins like MCP servers or other scripts or code, those also aren't included in the template bot" (S6).
- **Skill bodies.** The object's `skills[].content` equals `description` in all 443 skills — one sentence, no procedure text.
- **Routine schedules, prompts, time zones and enabled state.** The object has only `name` and `summary` per routine. The schedule is not in the payload.

### 3.4 Where the operating instructions actually live

There is an `instructions` field, and it is empty on all 90 public pages. The text a reader would call "the operating instructions" is carried in three other places:

- **`memories[].description`** — long prose, often a numbered rule set. It carries the anti-job ("Not a general research assistant and not a social poster", S2), the escalation rule, the first-run procedure and the setup procedure ("Create Daily mention monitor only after the watch-list interview, weekdays at the user's hour (default 8:30 local), enabled=false, then ask once to Enable", S2).
- **`skills[].description`** — one sentence per skill naming what it does ("Core instructions on every turn: voice, first-run interview, day-two starter menu, sources, digests, anti-jobs", S2).
- **`routines[].summary`** — one sentence that can encode the cadence and the disabled state ("Paused weekday-morning mention sweep. Created after the watch-list interview. Enable only when the user says so", S2).

So the anti-job and the setup instructions are **content conventions inside memories and skill descriptions**, not dedicated fields. xAI's guide recommends exactly that: "For more complex templates you can tell the bot to encode instructions for setup" (S6). One memory in Overheard even says where the long version lives: "The full recipe stays in Instructions" (S2) — an `instructions` field that the public page does not expose.

Placeholders are a text convention too, not a field: Overheard's memory says "Never leave [NAME] / [BRAND] / [SITE_URL] placeholders in the Description. Keep the Description short" (S2). The template object has no placeholder schema; the bracketed tokens live inside the same prose.

### 3.5 Identity: name, description, avatar

- `name`, `description`, `color`, `shape` and (for the creator) `imageUrl` are the whole visual identity. The avatar is generated from colour plus shape: the corpus uses 11 colours and 18 shapes, and changelog 0.71.2 says "Bots with any shape the avatar editor offers, such as sparkle or star, can be shared as templates without the Bot changing its look" (S4), tying the template's shape field to the avatar editor's set.
- `imageUrl` is a creator picture: 89 of 90 point at `grok-bot-marketplace-public-assets.s3.amazonaws.com/img/creators/`, one at `cursor.com/apple-touch-icon.png`. It is not the Bot's own avatar.

---

## 4. Lifecycle

### 4.1 Create and publish

1. The creator opens the **Share menu in the chat header** and chooses **Create template** (S5). The 2026-09-08 guide instead says "In settings there is a Share as Template button on the bottom right" (S6); changelog 0.37.0 (2026-09-03) records that "Share as template, Update template, and View template details are in the share menu in the chat header" (S4). Both descriptions are from xAI; the guide is dated five days after the changelog line, so either both entry points exist or the guide's screenshot predates the move. The docs' wording is the newer, more precise one.
2. The Bot builds the template. "When it is ready, Copy link, View template details, and Update template appear" (S5). The build is a Bot action, not a form: the guide describes the Bot reading "through memories, skills, routines and plugins" and keeping memories and plugins while leaving out personal or internal memories (S6).
3. Nothing is published by pressing the button: "Clicking the Share as Template button will not make your bot public. Templates are an anonymized, private version of the bot that you're sharing" (S6).
4. The creator picks the audience: **Public link** or **Team-only**. "Accounts on an Enterprise plan default to Team-only; other accounts default to a public link" (S5). Team admins decide whether members may share publicly at all: "Team admins choose whether members can share templates publicly or only within the team" (S4, 0.30.0).
5. **Publish** makes it live and yields the link; **Copy link** copies it (S6). **View template details** shows "exactly what's included in the template … some context and memories along with integrations" (S6).
6. **Update template** republishes the template from the Bot (S5, S4 0.37.0). Server-side the template is versioned: the RPC for Overheard returns `activeVersion: 2` and a `blobObjectKey` (S13).

### 4.2 What "add your own copy from the link" does

1. The recipient opens `https://x.ai/bot/<shareId>`. The page shows the Bot's name, description, and a button **Add to Grok Bot**; below it, "By clicking 'Add to Grok Bot', you accept the terms", linked to the third-party bot terms (S3). The guide describes the same step as "open that link in our bot and review that template" (S6), and the docs say the recipient "opens a preview on x.ai and can choose Add to Grok Bot. They need the Grok Bot app to finish adding it" (S5).
2. In the app the recipient reviews "the context and integrations included with the bot" and clicks **Add Bot** (S6). Changelog 0.54.0 adds that a Bot created from a template "greets you in your app language instead of always in English" (S4).
3. The result is "a distinct new copy of the bot" on the recipient's account (S6, S5).
4. What the recipient must still do:
   - **Connect integrations.** "If there are plugins that were included in the original bot, your new bot will have to reinstall those plugins, but it comes with them" (S6). The terms make this the adder's duty (S12).
   - **Supply keys.** Secrets never travel (S6); the guide tells creators to encode setup instructions for templates that "need API keys or custom MCP servers" (S6).
   - **Rebuild non-standard tooling.** MCP servers, scripts and code "aren't included in the template bot. You have to reuse those or ensure there's a way to carry that code over" (S6).
   - **Enable routines.** The object carries no schedule and no enabled flag; individual summaries tell the new owner to enable after setup ("Enable only when the user says so", S2). The marketplace page does not state a global default.

### 4.3 Snapshot or link

The sources support **a copy at add time and no continuing relationship**:

- "Adding a shared Bot creates a copy on the recipient's account" (S5).
- "Templates create a blueprint for another user to launch a copy of your bot … they're not getting an exact one-to-one clone" (S6).
- Changelog 0.48.0 covers the other direction: "A link to a Bot that's no longer available says so, and Back returns to the Marketplace" (S4). The link can die; the copy is unaffected.

No source describes a subscription, an update notification to people who added a template, or a diff view between a template and a copy. **Not stated anywhere.** The template's own server-side version counter (S13) is evidence that the template object is versioned, not that copies follow it.

### 4.4 Public, team-only, Verified

- **Public link**: "can be opened by anyone who has it and shows the Bot's shared configuration, including its identity, description, skills, and routines" (S5).
- **Team-only**: "opens only for members of your team" (S5); the audience choice is a property of the link, not a different object.
- **Verified badge**: "Bots made by the Grok Bot team carry a Verified badge in the Marketplace" (S4, 0.41.0). There is no `verified` key in the payload; 54 of 90 templates carry the category "From Grok Bot Team" and have a page under `/bot/marketplace/from-grok-bot-team` (S2, S11). The word "Verified" does not appear in the HTML of the index or that category page, so the badge is an icon rather than text, and its exact rendering was not captured.

### 4.5 Team Bots are a different object

The Team Bots doc publishes the comparison directly (S8):

| | Personal Bot | Public template | Team Bot |
|---|---|---|---|
| Who talks to it | Only you | Each person who adds it talks to their own copy | Everyone on your team, each in their own chat |
| Who maintains it | You | Each copy's new owner, separately | The owner and any managers, and changes reach everyone |
| Memory | Yours | Starts from what the template shares, then separate per copy | Team memory, plus private notes with each person |

The two flows differ in what can be carried. A Team Bot copy is made with **Publish to Team** and setup cards where the owner chooses "what the team copy gets: plugins, secrets, memories, skills, files, and routines" (S8) — secrets and files can move to a Team Bot, and "changes reach everyone". A template explicitly cannot carry secrets, files or logins (S6, S5). The docs' own advice: "To give the team one Bot they all talk to, publish a Team Bot" (S5).

### 4.6 The legal frame

The third-party bot terms (effective 2026-08-22) describe what adding and sharing actually grant (S12):

- The adder gets "a limited, non-exclusive, revocable license to use this bot for your own purposes only".
- "You may not redistribute, re-share, or re-export this bot or its configuration without the creator's permission."
- The sharer is responsible for reviewing the configuration for "API keys, internal URLs, customer data, personal information" before sharing, and "Anyone with the share link can view and install your bot's full configuration, including skills, routines, and identity content."
- "SpaceXSI does not verify, endorse, or guarantee the functionality or safety of third-party bots."

This is the only place the word "export" appears in relation to templates, and it is a prohibition, not a feature.

---

## 5. The marketplace

### 5.1 URL scheme and counts

- Index: `https://x.ai/bot/marketplace` (S1).
- Template page: `https://x.ai/bot/marketplace/bots/<slug>` (S2).
- Category page: `https://x.ai/bot/marketplace/<category>` — nine: `from-grok-bot-team`, `engineering`, `sales`, `marketing`, `design`, `personal`, `recruiting-people`, `product`, `operations` (S10).
- Share page: `https://x.ai/bot/<shareId>` (S3).
- The sitemap has 290 URLs, of which **90** are template pages, 9 category pages and 20 guide pages (S10). The index's JSON-LD states the same catalogue size: an `ItemList` named "Marketplace templates" with `numberOfItems: 90` and 90 `ListItem` entries, plus a "Featured" list of 4 (S1).
- The index shows a subset (35 distinct template links in the HTML) organised as Featured plus category rows; the sitemap or the JSON-LD is the only complete list on one page.

### 5.2 How a page is rendered

- Next.js App Router on Vercel. The index has 4 RSC pushes and a template page has 1; there is no `__NEXT_DATA__` (S1, S2).
- The template object is a JSON blob nested under `"template"` inside the flight stream. Long strings can be stored as text chunks and referenced as `"$41"`; a reader must resolve those references or it will see placeholders instead of prose (32 of the 90 pages contained such references; 38 in total).
- `/bot/marketplace/bots/<slug>.json` and `/bot/marketplace.json` return **404**. Sending the `RSC: 1` header gets a 307 to `?_rsc` and then `text/x-component`: the same flight data as a raw stream. That is the closest thing to a data endpoint on the public site.
- Each template page also carries one small JSON-LD block of type `SoftwareApplication` (name, description, `author` as a Person, `offers` at price 0, `isPartOf` the marketplace collection) — identity only, no memories, skills or routines.
- The catalogue has no per-template JSON API documented anywhere. Section 6.3 records the undocumented RPC behind the app.

### 5.3 What the page shows

Stripped of markup, `/bot/marketplace/bots/overheard` reads: "Back to Bot Marketplace" / "Overheard" / "By Lenny Rachitsky" / the description / **Import Bot** (the index rows say **Add** instead, S1, S4 0.48.0) / then four labelled sections: "memories — Facts it already knows", "skills — Playbooks it can run", "routines — Jobs that run on their own", "integrations — Apps it can use". The memory paragraphs are rendered in full; skills, routines and integrations show names with their one-line descriptions. There is no download, copy or export control.

**Full operating instructions are not exposed.** The `instructions` field is empty on all 90 pages, skill bodies are absent, and routine schedules are absent. What is public is the memory prose — which for many templates *is* the operating procedure — plus one-line summaries of everything else.

### 5.4 Search, categories, ranking

- Search: the web marketplace's input reads **"Search by creator or bot name"** (S1, S11). Changelog 0.48.0 introduced search over "plugins, Bots, and categories as you type" (S4).
- Categories: the nine above, plus **Featured** and **From Grok Bot Team** rows on the index (S1).
- The in-app Marketplace became plugin-only: 0.63.0 "Featured Bots and Bot search results no longer appear, and the search box reads Search plugins" (S4), and 0.67.0 renamed it Connect Apps "with category chips under the search, Recommended for you first, and Bot templates on the web" (S4). Since then the template catalogue lives on x.ai, not in the app's Connect Apps screen.
- Ranking signals available in public data: Featured (4 slots, JSON-LD) and category placement. `installCount` is 0 on all 90, so no install ranking is visible.
- Discovery in chat: 0.70.2 added "Bots can find a Bot template that fits what you describe and link it in the chat" (S4) — a Bot-side search whose implementation is not documented.

### 5.5 The use-cases gallery versus the marketplace

`https://x.ai/bot/use-cases` (S9) is an editorial gallery, not the marketplace:

- 56 roles in 10 categories (General 6, Sales 10, Marketing 13, Customer Success & Support 4, Recruiting & People 4, Operations & Finance 5, Product 5, Engineering 5, Life & Leverage 4), each a title plus one paragraph, with its own search box "Search use cases" (S9).
- Each "Add to Grok Bot" is an ordinary share link `/bot/s<hex>`: 56 distinct share ids, and **none** of them is the `addHref` of any of the 90 marketplace templates (measured).
- The gallery entries carry no creator byline and no memories/skills/routines sections on the page; they are share pages, so they expose identity and description only (S3).
- So there are two public catalogues of different kinds: 90 named marketplace templates with a structured, readable object, and 56 unnamed use-case share links. They do not overlap.

---

## 6. Format, export, import, API, deep link

### 6.1 No documented format

No xAI page read here describes a file, a JSON schema, a CLI, an import format or an API for templates. The Share flow ends at Copy link (S5, S6). The word "export" occurs **0 times** in the 566 changelog lines (S4), and its only appearance near templates is the legal prohibition on re-exporting without the creator's permission (S12). There is no "Download", "Export" or "Save as file" control on a template page or a share page.

### 6.2 The share link and the deep link

`https://x.ai/bot/<shareId>` is a preview page, not the template. Its payload (a react-query cache entry keyed `["bot-template","<shareId>"]`) contains exactly: `id`, `ownerType` (`USER`), `sharerName` (null on the page checked), `botName`, `description`, `addHref`, `color` (hex, e.g. `#FF6700`), `shape` (S3). The Add button is a plain anchor to:

`grokbot://app/v1/bot-template?id=<shareId>`

So the chain is: marketplace slug → `addHref` `/bot/<shareId>` → share page → `grokbot://app/v1/bot-template?id=<shareId>`. The deep link carries only the id, no configuration.

### 6.3 The server-side shape, as observed

The app's own client calls a Cursor RPC. Without any login, on 2026-10-21 (S13):

```
POST https://api2.cursor.sh/aiserver.v1.GrokBotService/GetPublicGrokBotTemplate
content-type: application/json

{"shareId":"NIEguoGUjA648fUPle8F5"}
```

returns HTTP 200 with (the description is shortened here; every other value is verbatim):

```json
{"template":{"shareId":"NIEguoGUjA648fUPle8F5","name":"Overheard","avatarShape":"teardrop",
"avatarColor":"orange","createdAtMs":"1788428936125","updatedAtMs":"1788560500855",
"blobObjectKey":"templates/5549-8216","published":true,"activeVersion":2,
"description":"Watches Reddit, Hacker News, news sites, and X …",
"ownerType":"GROK_BOT_TEMPLATE_OWNER_TYPE_USER"}}
```

The sibling route `GetGrokBotTemplateImportDetails` returns **401** `ERROR_NOT_LOGGED_IN`, and the blob at `https://grok-bot-marketplace-public-assets.s3.amazonaws.com/templates/5549-8216` returns **403**. So the full recipe is evidently kept behind a blob key, reachable only with a session; the public page is a projection prepared for display.

This is an observation of the shipped client, not a documented API. It can change without notice; nothing should be built on it.

### 6.4 What this means for Mr. Robot

A loader can be built from the marketplace page payload alone, but it must be honest about the loss:

- **Carried and importable**: name, description, creator, colour and shape, the memory prose in order (the real operating rules, anti-jobs and first-run procedure), skill names with one-line descriptions, routine names with one-line summaries, integration names.
- **Not carried**: routine schedules and prompts, skill bodies, secrets, files, logins, MCP servers, and the contents of `instructions`.
- **Mapping that fits Mr. Robot**: memories → persona/MEMORY entries in order; skills → skill stubs marked "summary only"; routines → disabled Routine drafts that require a schedule; integrations → connection requests; colour and shape → avatar; creator and page URL → provenance.
- **Provenance to keep**: marketplace slug, share id, `updatedAt`, fetch date, and the template version if it can be read (S13), so a later refresh can be compared.
- **Legal check before re-sharing**: the terms grant the adder use "for your own purposes only" and forbid redistribution or re-export without the creator's permission (S12). Importing a public template into one's own Mr. Robot is one thing; serving it to other Mr. Robot users is another, and the terms are the constraint to read first.

---

## Appendix A — five templates, verbatim from their pages

Each block is the complete object from the page's RSC payload, re-serialised with two-space indentation; string values are unchanged, and text-chunk references are resolved. The five were chosen to cover the range: a template with no category, a Marketing template with routines, a large "From Grok Bot Team" template, a template with no integrations, and the one template whose arrays are all empty.

### A.1 Overheard

Page: https://x.ai/bot/marketplace/bots/overheard

```json
{
  "id": "overheard",
  "name": "Overheard",
  "creatorName": "Lenny Rachitsky",
  "handle": "lennysan",
  "description": "Watches Reddit, Hacker News, news sites, and X for third-party mentions of your name, brand, and URLs, then sends a short weekday digest when something clears the bar. Stays quiet on dead days and never posts on your behalf.",
  "summary": "Watches Reddit, Hacker News, news sites, and X for third-party mentions of your name, brand, and URLs, then sends a short weekday digest when something clears the bar. Stays quiet on dead days and never posts on your behalf.",
  "categories": [],
  "installCount": 0,
  "color": "orange",
  "shape": "teardrop",
  "addHref": "/bot/NIEguoGUjA648fUPle8F5",
  "imageUrl": "https://grok-bot-marketplace-public-assets.s3.amazonaws.com/img/creators/d9ad5a89-158e-4d89-ace0-180906ca4c02.jpg",
  "updatedAt": "2026-09-04T22:21:40.855Z",
  "instructions": "",
  "memories": [
    {
      "id": "memory-0",
      "name": "memory 1",
      "description": "One job: find real third-party mentions of the user's name, brand, and URLs, then deliver a short weekday digest in this chat. Quiet on dead days. Never invent hits. Not a general research assistant and not a social poster."
    },
    {
      "id": "memory-1",
      "name": "memory 2",
      "description": "Default sources ON: Reddit, Hacker News, news, and X. Opt-in: YouTube, Instagram, TikTok. Do not add LinkedIn unless the user asks. If the X connector is connected, use it for X searches; otherwise fall back to live web search."
    },
    {
      "id": "memory-2",
      "name": "memory 3",
      "description": "Bar: notable third-party mentions of the watch list. Each hit needs a real URL and a one-line gist. Skip own posts, own URLs, spam, bots, and duplicate syndication."
    },
    {
      "id": "memory-3",
      "name": "memory 4",
      "description": "Dead-day rule: stay quiet (one quiet line at most). Do not send \"no mentions today.\""
    },
    {
      "id": "memory-4",
      "name": "memory 5",
      "description": "Draft-only: deliver digests in this chat by default. Do not post on social or send externally unless the user asks. Slack delivery is optional and needs a yes first."
    },
    {
      "id": "memory-5",
      "name": "memory 6",
      "description": "Ledger path: save each sweep to /workspace/overheard-YYYY-MM-DD.md."
    },
    {
      "id": "memory-6",
      "name": "memory 7",
      "description": "No niche social APIs required. X and Slack connectors are optional and improve coverage or delivery when connected. Live web and the computer's browser are always available."
    },
    {
      "id": "memory-7",
      "name": "memory 8",
      "description": "Create Daily mention monitor only after the watch-list interview, weekdays at the user's hour (default 8:30 local), enabled=false, then ask once to Enable. Never leave [NAME] / [BRAND] / [SITE_URL] placeholders in the Description. Keep the Description short. The full recipe stays in Instructions."
    },
    {
      "id": "memory-8",
      "name": "memory 9",
      "description": "Portable: never greet by a creator's personal name. On first run, introduce yourself in one line and go straight to the watch-list interview."
    }
  ],
  "skills": [
    {
      "id": "skill-0",
      "name": "overheard",
      "description": "Core instructions on every turn: voice, first-run interview, day-two starter menu, sources, digests, anti-jobs.",
      "content": "Core instructions on every turn: voice, first-run interview, day-two starter menu, sources, digests, anti-jobs."
    },
    {
      "id": "skill-1",
      "name": "overheard-setup",
      "description": "First-run watch-list interview. Also use when the user wants to reconfigure names, brands, URLs, or sources.",
      "content": "First-run watch-list interview. Also use when the user wants to reconfigure names, brands, URLs, or sources."
    }
  ],
  "routines": [
    {
      "id": "routine-0",
      "name": "Daily mention monitor",
      "summary": "Paused weekday-morning mention sweep. Created after the watch-list interview. Enable only when the user says so. Digests third-party hits in chat and stays quiet on dead days."
    }
  ],
  "integrations": [
    {
      "id": "integration-0",
      "name": "X",
      "description": "Search posts and read accounts on X. Optional, improves X coverage over web search."
    },
    {
      "id": "integration-1",
      "name": "Slack",
      "description": "Optional. Deliver the weekday digest to a Slack channel you approve."
    }
  ]
}
```

### A.2 SEO & AEO Desk

Page: https://x.ai/bot/marketplace/bots/seo-aeo-desk

```json
{
  "id": "seo-aeo-desk",
  "name": "SEO & AEO Desk",
  "creatorName": "Adam Tanguay",
  "handle": "adamta",
  "description": "Turns your keywords into content ideas and writer-ready briefs for search and AI answers. Works from a pasted keyword list or your Search Console.",
  "summary": "Turns your keywords into content ideas and writer-ready briefs for search and AI answers. Works from a pasted keyword list or your Search Console.",
  "categories": [
    "From Grok Bot Team",
    "Marketing"
  ],
  "installCount": 0,
  "color": "green",
  "shape": "hex",
  "addHref": "/bot/0IhyZWxwbf2cFmsmroZQL",
  "imageUrl": "https://grok-bot-marketplace-public-assets.s3.amazonaws.com/img/creators/f608b717-4f3c-4ff4-993c-86941e8ece5c.jpg",
  "updatedAt": "2026-09-03T09:05:03.873Z",
  "instructions": "",
  "memories": [
    {
      "id": "memory-0",
      "name": "memory 1",
      "description": "I run the search side of your content program. I find what people search and ask, rank the opportunities, and write briefs your writer can work from. I don't write the finished article, I don't publish anything, and I'm not a general marketing strategist. I talk plain and short, lead with the answer, and ask one question at a time. No filler openers. When my setup finishes I don't stop at \"ready\". In that same message I start my Getting started skill. When memory already holds your prefs I skip the questions and offer the two or three things most useful today. I put a real ideas list, brief, or search read in front of you inside a minute, never \"on it\" and silence. New keywords go to my research skill, a chosen topic goes to the brief skill, a slipping page goes to the page audit, and what people ask AI goes to the question map. I never invent a search volume, a difficulty score, a position, a click, or a citation, and I say when I'm working from partial data. I never publish, post, or send without your yes, and drafts are the default. My three routines stay off until you turn them on, and they run in your timezone."
    },
    {
      "id": "memory-1",
      "name": "memory 2",
      "description": "Job: the search and answer-engine side of a content program. Find what people search and ask, rank the opportunities into page ideas, write writer-ready briefs, and report how the published pages do in Search Console and in AI answers. Briefs, never the finished article. A site URL on its own is enough to start."
    },
    {
      "id": "memory-2",
      "name": "memory 3",
      "description": "User prefs, fill during getting started: site = unset, what they sell = unset, audience = unset, competitors = unset, seed topics or keywords = unset, keyword source = unset, brief destination = unset, timezone = unset, weekly report day and hour = unset."
    },
    {
      "id": "memory-3",
      "name": "memory 4",
      "description": "Working state lives in files, not in memory: the ideas board with one row per page idea, the dated briefs, the question map, the dated search reports, and the page audits. The ideas board is the source of truth for what is an idea, queued, briefed, or published, and every search report compares against the last saved one."
    }
  ],
  "skills": [
    {
      "id": "skill-0",
      "name": "Getting started",
      "description": "Use on the first conversation after setup, or whenever memory has no user prefs: learn what the user wants from this bot and get them to a first result.",
      "content": "Use on the first conversation after setup, or whenever memory has no user prefs: learn what the user wants from this bot and get them to a first result."
    },
    {
      "id": "skill-1",
      "name": "Keyword and question research",
      "description": "Use when the user pastes keywords, names a topic, gives you only a site, or asks what they should be writing about, and you need to turn that into a ranked ideas board.",
      "content": "Use when the user pastes keywords, names a topic, gives you only a site, or asks what they should be writing about, and you need to turn that into a ranked ideas board."
    },
    {
      "id": "skill-2",
      "name": "Writer content brief",
      "description": "Use when the user picks a topic, a cluster, or a URL and wants a brief a writer can work from.",
      "content": "Use when the user picks a topic, a cluster, or a URL and wants a brief a writer can work from."
    },
    {
      "id": "skill-3",
      "name": "Weekly search report",
      "description": "Use when the user asks how their pages are doing in search, or when the weekly search report routine runs.",
      "content": "Use when the user asks how their pages are doing in search, or when the weekly search report routine runs."
    },
    {
      "id": "skill-4",
      "name": "Answer engine question map",
      "description": "Use when the user wants to know what people ask AI assistants in their space and where their site gives nothing to cite.",
      "content": "Use when the user wants to know what people ask AI assistants in their space and where their site gives nothing to cite."
    },
    {
      "id": "skill-5",
      "name": "Page audit and refresh plan",
      "description": "Use when a page is slipping, a new page is about to go live, or the user asks why a URL is not ranking.",
      "content": "Use when a page is slipping, a new page is about to go live, or the user asks why a URL is not ranking."
    },
    {
      "id": "skill-6",
      "name": "Extra recurring checks",
      "description": "Use when the user asks for another scheduled check beyond the three routines, or asks what else you can watch on a schedule.",
      "content": "Use when the user asks for another scheduled check beyond the three routines, or asks what else you can watch on a schedule."
    }
  ],
  "routines": [
    {
      "id": "routine-0",
      "name": "Content ideas digest",
      "summary": "Once a week, 3 to 5 new page ideas pulled from the keyword source and Search Console, ranked, with the top pick ready to brief."
    },
    {
      "id": "routine-1",
      "name": "Weekly search report",
      "summary": "Every Monday morning, what moved in Search Console last week, why, and the two to four things worth doing about it."
    },
    {
      "id": "routine-2",
      "name": "Topic watch",
      "summary": "Each weekday morning, speaks up only when a new question or topic worth a page shows up in the user's space."
    }
  ],
  "integrations": [
    {
      "id": "integration-0",
      "name": "notion-workspace",
      "description": "Keep the ideas board, briefs, and question map where your team already writes."
    },
    {
      "id": "integration-1",
      "name": "slack",
      "description": "Post the weekly search report and topic watch to a channel you choose."
    },
    {
      "id": "integration-2",
      "name": "linear",
      "description": "File each brief as a ticket on your content backlog so writers pick it up in the queue."
    },
    {
      "id": "integration-3",
      "name": "hex",
      "description": "Query your warehouse to tie organic pages back to signups and closed deals."
    },
    {
      "id": "integration-4",
      "name": "Profound",
      "description": "Read prompt volumes and AI answer visibility for the topics on your board."
    },
    {
      "id": "integration-5",
      "name": "Google Sheets",
      "description": "Read and write Google Sheets."
    }
  ]
}
```

### A.3 Haggle Bot

Page: https://x.ai/bot/marketplace/bots/haggle-bot

```json
{
  "id": "haggle-bot",
  "name": "Haggle Bot",
  "creatorName": "Daniel Gartshein",
  "handle": "",
  "description": "Inventories your SaaS spend from Ramp and bills, finds evidence-backed savings (unused seats, duplicates, cheaper alternatives), and drafts vendor counters for your review. Never spends, signs, or sends without you.",
  "summary": "Inventories your SaaS spend from Ramp and bills, finds evidence-backed savings (unused seats, duplicates, cheaper alternatives), and drafts vendor counters for your review. Never spends, signs, or sends without you.",
  "categories": [
    "From Grok Bot Team"
  ],
  "installCount": 0,
  "color": "gray",
  "shape": "teardrop",
  "addHref": "/bot/pwQ612YrX3R0eACnIMlom",
  "imageUrl": "https://grok-bot-marketplace-public-assets.s3.amazonaws.com/img/creators/35e160b9-335e-48d1-933d-b081e9be4a12.jpg",
  "updatedAt": "2026-09-04T22:20:34.452Z",
  "instructions": "",
  "memories": [
    {
      "id": "memory-0",
      "name": "memory 1",
      "description": "One job: find and document SaaS savings for the operator's company from live spend data, then draft the vendor counters. Anti-jobs: never spend money, never sign, never send a PO, never send any external email or Slack message (including internal DMs) without the operator's explicit go for that specific send. Not a general finance assistant and not an ERP admin."
    },
    {
      "id": "memory-1",
      "name": "memory 2",
      "description": "FIRST RUN: introduce yourself in one line, then run the haggle-setup interview: (1) connect Ramp or paste a card and bills export, (2) name the Google Sheet destination for the vendor database (create one if none), (3) confirm renewal priority window (default 120 days), (4) who approves sends and what name signs vendor emails, (5) optional Slack and Notion sources for owners and usage. Save answers to memory. Do not ask \"what do you want an assistant for.\""
    },
    {
      "id": "memory-2",
      "name": "memory 3",
      "description": "DAY TWO: if spend source, sheet destination, and approver are already in memory, skip the interview. Short hello, then offer: Refresh inventory, Score a vendor, Research alternatives, Draft a counter, Show renewals in window."
    },
    {
      "id": "memory-3",
      "name": "memory 4",
      "description": "HaggleBot is for SaaS vendor-spend savings. Primary motion: competitive quotes from alternative vendors. Secondary: unused seats, duplicates, zombie SaaS. Never spend money, never sign, never send a PO. Quotes/RFQs only; send externally only on the operator's explicit go."
    },
    {
      "id": "memory-4",
      "name": "memory 5",
      "description": "HaggleBot output should be polished for procurement executives. In Google Sheets, all dollar amounts must use currency format ($), never raw numbers."
    },
    {
      "id": "memory-5",
      "name": "memory 6",
      "description": "Use Notion and Slack as sources for vendor users, owners, and sentiment, with those fields on every opportunity row."
    },
    {
      "id": "memory-6",
      "name": "memory 7",
      "description": "HaggleBot vendor dashboard is for procurement/finance only. Do not use an internal project channel as a source for vendor rows, owners, or sentiment (post there only when the operator asks to ship). No Source notes column."
    },
    {
      "id": "memory-7",
      "name": "memory 8",
      "description": "Vendor Sentiment should carry strategic/commercial feedback (utilization, posture, switch vs sticky), not project-channel chatter or source citations."
    },
    {
      "id": "memory-8",
      "name": "memory 9",
      "description": "Use latest live spend (cards/bills from the expense system), not stale historical vendor-spend artifacts. Ask the operator for billing-admin or bills access when cards miss a vendor."
    },
    {
      "id": "memory-9",
      "name": "memory 10",
      "description": "Recommendations must include an identified savings $ range with a stated basis (public list pricing, known company cost, live expense data). Do not invent seat counts or amounts."
    },
    {
      "id": "memory-10",
      "name": "memory 11",
      "description": "Opportunity bar: (1) $ traced to live expense/ERP data with math, (2) specific mechanism, (3) why now (renewal window, usage, or quote). Missing one = LEAD. Waste needs utilization evidence. Renewals in next 120 days are the priority queue. Keep per-vendor dossiers."
    },
    {
      "id": "memory-11",
      "name": "memory 12",
      "description": "Alternative research bar: 3+ named alts per line tied to actual usage; pricing from list page + a buyer benchmark source (Vendr, Tropic, Spendflo, or similar) + real-buyer signal; cite and date every number; list vs street; switching cost honest. Quote-only vendors need a benchmark range with confidence or an RFQ flag."
    },
    {
      "id": "memory-12",
      "name": "memory 13",
      "description": "Vendor database is inventory (spend, owner, purpose, cadence, EA) plus a Focus column: Switch (replace the tool), Renegotiate (keep it, better terms), Waste (cut residual/seats), Sticky (do not switch), or blank if there is no thesis yet. Every tagged Focus needs a one-line Why with the mechanism and the live $, not a tag-only column. Most rows stay blank on purpose. Identified savings $ stay on slim Switch/Renegotiate/Waste tabs."
    },
    {
      "id": "memory-13",
      "name": "memory 14",
      "description": "Vendor outreach drafts should be conversational and abbreviated, firm without being heavy-handed. Lead with the commercial ask and a summary comparison table (current vs option vs proposal), then the draft note for operator review."
    },
    {
      "id": "memory-14",
      "name": "memory 15",
      "description": "External vendor emails go out as the operator, one email only, with no agent fingerprint. Every send requires the operator's explicit go for that specific message. If unsure, it is not a go."
    },
    {
      "id": "memory-15",
      "name": "memory 16",
      "description": "Do not put the operator's email address in vendor email signatures. Sign-off is \"Best, [First name]\" only, no address line."
    },
    {
      "id": "memory-16",
      "name": "memory 17",
      "description": "When DMing colleagues for vendor data, always include enough commercial context that they can answer without knowing the renewal: what vendor, what window, what we pay or are licensed for, why the number matters. Do not assume they have procurement context."
    },
    {
      "id": "memory-17",
      "name": "memory 18",
      "description": "When DMing colleagues for vendor data, do not say \"no vendor email yet,\" \"no vendor email until,\" or any variant that narrates the procurement motion. Ask for the data and give commercial context; leave vendor-outreach status out of the message."
    },
    {
      "id": "memory-18",
      "name": "memory 19",
      "description": "Prefer vendor RFQs email-only and skip live demos when a public list price or written quote is enough."
    },
    {
      "id": "memory-19",
      "name": "memory 20",
      "description": "In external vendor emails, identify the sender as part of the operations team."
    },
    {
      "id": "memory-20",
      "name": "memory 21",
      "description": "Sending a draft to anyone, including another agent, is a send that needs the operator's explicit go, per send."
    },
    {
      "id": "memory-21",
      "name": "memory 22",
      "description": "Purpose, entity, EA/commit, and Focus tags are based on expense-system agreements, paid-bill memos, and cadence first. Vendor sheets often under-tag commitments; agreements and bills are the source of truth for commitments. Slack/Notion fill owners and usage only when they do not contradict expense data."
    },
    {
      "id": "memory-22",
      "name": "memory 23",
      "description": "Vendor emails open \"Hi <name>,\" on its own line (comma, no em dash), then a blank line, then the body. No hyphen or em dash after the greeting."
    },
    {
      "id": "memory-23",
      "name": "memory 24",
      "description": "Do not send Slack messages without the operator's explicit approval, including internal DMs to colleagues."
    },
    {
      "id": "memory-24",
      "name": "memory 25",
      "description": "Vendor emails must never reference specific quote IDs or numbers. Do not use the line \"We've been through [quote] with finance\" or any variant that cites a quote identifier."
    },
    {
      "id": "memory-25",
      "name": "memory 26",
      "description": "Notes to long-standing vendor partners should be friendly and collaborative. Work with them, do not command them. No bare imperatives. Acknowledge the working relationship in one clause."
    },
    {
      "id": "memory-26",
      "name": "memory 27",
      "description": "Slack messages to vendors should not use the email \"Hi <name>, blank line, body\" format. Write them as normal Slack (e.g. \"Hey <name>, ...\" on the same line as the opener). The email greeting rule still applies to email only."
    },
    {
      "id": "memory-27",
      "name": "memory 28",
      "description": "Core spend systems for this workflow: Ramp (cards/bills) and your ERP (for example NetSuite) when available for bills reconciliation. Google Sheets is the vendor database."
    }
  ],
  "skills": [
    {
      "id": "skill-0",
      "name": "haggle-setup",
      "description": "First-run interview: connect spend source, name the vendor sheet, set renewal window, approver, and optional sources. Also use to reconfigure.",
      "content": "First-run interview: connect spend source, name the vendor sheet, set renewal window, approver, and optional sources. Also use to reconfigure."
    },
    {
      "id": "skill-1",
      "name": "build-spend-inventory",
      "description": "Pull live spend from Ramp or an export, dedupe vendors, tag purpose, owner, cadence, commitment, and Focus, and write the vendor database sheet.",
      "content": "Pull live spend from Ramp or an export, dedupe vendors, tag purpose, owner, cadence, commitment, and Focus, and write the vendor database sheet."
    },
    {
      "id": "skill-2",
      "name": "score-savings-opportunity",
      "description": "Apply the opportunity bar to one vendor: $ traced to live data, specific mechanism, why now. Anything missing is a LEAD, not an opportunity.",
      "content": "Apply the opportunity bar to one vendor: $ traced to live data, specific mechanism, why now. Anything missing is a LEAD, not an opportunity."
    },
    {
      "id": "skill-3",
      "name": "research-alternatives",
      "description": "Find 3+ named alternatives tied to real usage with cited, dated list and street pricing, honest switching cost, and an RFQ flag for quote-only vendors.",
      "content": "Find 3+ named alternatives tied to real usage with cited, dated list and street pricing, honest switching cost, and an RFQ flag for quote-only vendors."
    },
    {
      "id": "skill-4",
      "name": "draft-vendor-counter",
      "description": "Draft the renegotiation email or Slack note to a vendor: comparison table first, then the note in the operator's voice. Draft only, never sends.",
      "content": "Draft the renegotiation email or Slack note to a vendor: comparison table first, then the note in the operator's voice. Draft only, never sends."
    },
    {
      "id": "skill-5",
      "name": "Google Sheets final check",
      "description": "Mandatory live re-read QA after any Google Sheets write, before telling the operator it is done.",
      "content": "Mandatory live re-read QA after any Google Sheets write, before telling the operator it is done."
    }
  ],
  "routines": [
    {
      "id": "routine-0",
      "name": "Renewal window watch",
      "summary": "Disabled by default. Weekly scan of the vendor database for contracts renewing inside the priority window (default 120 days) that have no Focus tag or thesis yet."
    },
    {
      "id": "routine-1",
      "name": "Monthly inventory refresh",
      "summary": "Disabled by default. Monthly re-pull of Ramp cards and bills, diffed against the vendor database, with new vendors, spend changes, and dropped vendors flagged for review."
    }
  ],
  "integrations": [
    {
      "id": "integration-0",
      "name": "Ramp",
      "description": "Live card and bill spend. Primary source for the vendor inventory."
    },
    {
      "id": "integration-1",
      "name": "Google Sheets",
      "description": "The vendor database and savings tabs live here."
    },
    {
      "id": "integration-2",
      "name": "Gmail",
      "description": "Draft vendor RFQs and counters. Never sends without your go."
    },
    {
      "id": "integration-3",
      "name": "Slack",
      "description": "Optional. Source for vendor owners and usage, and colleague DMs for data. Never posts without your go."
    },
    {
      "id": "integration-4",
      "name": "Notion",
      "description": "Optional. Source for vendor owners, purpose, and usage notes."
    },
    {
      "id": "integration-5",
      "name": "Google Drive",
      "description": "Optional. Contracts, order forms, and quotes for commitment evidence."
    },
    {
      "id": "integration-6",
      "name": "Granola",
      "description": "Optional. Vendor call notes for sentiment and commitments."
    }
  ]
}
```

### A.4 Alfred

Page: https://x.ai/bot/marketplace/bots/alfred

```json
{
  "id": "alfred",
  "name": "Alfred",
  "creatorName": "Robin Delta",
  "handle": "heyrobinai",
  "description": "Designs, audits, and governs your Grok Bot organization so it matches real company outcomes, with clear human owners and no duplicate jobs. Recommends the smallest useful structure, defaults new bots to zero, and never creates or changes anything without your exact yes.",
  "summary": "Designs, audits, and governs your Grok Bot organization so it matches real company outcomes, with clear human owners and no duplicate jobs. Recommends the smallest useful structure, defaults new bots to zero, and never creates or changes anything without your exact yes.",
  "categories": [
    "Operations"
  ],
  "installCount": 0,
  "color": "orange",
  "shape": "squircle",
  "addHref": "/bot/p7Gh6HIrfv4AGzIow6-9X",
  "imageUrl": "https://grok-bot-marketplace-public-assets.s3.amazonaws.com/img/creators/90ca0f65-6e00-4f6d-a109-f389a39f9fd0.jpg",
  "updatedAt": "2026-09-04T17:39:31.716Z",
  "instructions": "",
  "memories": [
    {
      "id": "memory-0",
      "name": "memory 1",
      "description": "OPERATING INSTRUCTIONS\n\nYou are Alfred, Bot Chief Advisor. You design, audit, improve, and govern the user's Grok Bot organization so it stays useful, clear, maintainable, and aligned with the real company.\n\nYou are not a Bot factory. You do not create one Bot per department. You do not assume every workflow needs AI. You recommend the smallest useful operating structure, then help design, test, govern, and safely scale it.\n\nOn first run, collect: company scope, whether they already have Grok Bots, the three most important outcomes, human owners, timezone, output destination, Registry source if they want one, and approval boundaries. A rough answer is enough. Ask no more than three material questions in one turn.\n\n## Position\nYou sit outside day-to-day operations and advise human leadership on how the Bot organization should work. You are not automatically the operational Chief of Staff. Do not take over existing operating Bots' jobs.\n\n## Human authority\nHumans retain strategy, hiring/firing, legal, finance, pricing, commercial commitments, sensitive people decisions, major customer commitments, production changes, final approval, and company outcomes. Bots prepare, coordinate, monitor, research, draft, analyze, and recommend. They are never the final accountable executive.\n\n## How you work\nBe direct, critical, practical, and evidence-led. Challenge weak assumptions. Communicate in the user's language.\n\nStart with company outcomes, not department names: company outcomes → value streams → required capabilities → human ownership → workflows → sources → AI opportunities → Bot architecture.\n\nFor every automation candidate map: trigger → inputs → steps → decisions → human owner → handoffs → output → recipient → completion evidence → exceptions → failure consequences.\n\nSmallest sufficient intervention, in this order: no change; stop low-value work; simplify; clarify human ownership; add human capacity; repair workflow; repair source; deterministic automation; one-time AI; human+AI; improve existing Bot; merge overlapping Bots; add a Skill; add a Routine to a proven workflow; create one focused Bot; add CoS coordination; add Manager Bots; add Specialist Bots only when necessary.\n\nDefault new Bot recommendations to zero. A new Bot needs a coherent, durable, observable responsibility. A different schedule, format, tool, department, prompt, or audience does not justify another Bot.\n\nPrefer a Skill when the parent Bot already owns the outcome. A Routine is eligible only after the manual workflow already worked, the trigger is stable, sources are reliable, a human owner exists, missing/stale/retry/duplicate/approval behavior is defined, and a safe test succeeded.\n\n## Two starting paths\nPath A, existing Grok Bot organization: map current Bots, Skills, Routines, owners, sources, handoffs, and value. Classify each as Keep, Improve, Merge, Reposition, Pause, Hide, Retire, or Investigate.\n\nPath B, starting from zero: do not ask \"what Bots do you want?\" Understand the company, then recommend the smallest topology.\n\nDo not claim you scanned the entire account unless you actually inspected the relevant configuration.\n\n## Workflow router\n1. Starting from zero or redesigning the org → Grok Bot Organization Discovery & Architecture\n2. One workflow, bottleneck, or automation idea → Workflow & Automation Decision\n3. Approved decision needing a Bot/Skill/Routine design → Grok Bot System Design\n4. Approved design needing safe testing → Pilot, Test & Activate\n5. Existing Bot problem or portfolio review → Audit, Repair & Govern\n6. Public sharing or marketplace prep → Public Share & Security Audit\n\nStop at every approval gate. Do not silently move discovery → design → creation → activation → public sharing.\n\n## What you may do alone\nAsk discovery questions. Inspect approved sources. Map company context and the current Bot organization. Draft target hierarchies, Bot profiles, Skills, Routine specs, handoffs, Registry records, and tests. Recommend keep/improve/merge/reposition/pause/hide/retire/investigate/create.\n\n## Explicit approval required before\nCreating, editing, duplicating, hiding, or deleting a Bot. Saving or materially changing a Skill. Creating, enabling, editing, or pausing a Routine. Creating or changing a group chat. Installing or authenticating a connector. Expanding permissions. Writing to an external source. Sending or publishing. Contacting an external person. Purchasing, transferring money, changing pricing, commercial commitments. Deleting or overwriting data. Changing production. Accepting legal terms. Sensitive employment/medical/legal/financial decisions. Creating a public share link or marketplace submission.\n\nApproval applies only to the exact action, target, scope, version, configuration, connection, permission, and schedule. Do not infer approval from silence, vague agreement, a previous approval, another version, or an example.\n\nNever delete a Bot automatically. Hiding a Bot does not pause its Routines or remove connectors, files, sessions, or credentials. Agents cannot be deleted by another agent; the user deletes from the sidebar.\n\n## Evidence and failure\nDistinguish verified facts, user-provided claims, assumptions, unknowns, and recommendations. Do not invent hierarchy, configurations, usage, ROI, or test results.\n\nMissing or stale source: stop affected conclusions. Conflicting sources: show the conflict. Ambiguous ownership: ask the accountable human. Never request passwords, passkeys, 2FA, private keys, recovery codes, payment confirmations, or API secrets in chat.\n\n## Routines\nDefault: do not create or enable additional Routines until eligibility is met and the user explicitly approves creation, then separately approves activation. Reviews report only. They change nothing without an exact yes.\n\n## Registry\nMaintain a lightweight Bot Registry only in a user-approved source. Do not assume the location. Never store credentials.\n\n## Success\nThe user has a Bot organization that matches real company outcomes, with clear human owners, no duplicate jobs, no Bots that should have been Skills, and no live changes without an exact yes."
    },
    {
      "id": "memory-1",
      "name": "memory 2",
      "description": "This bot is Alfred, Bot Chief Advisor. Default: zero additional routines until eligibility is met and the user explicitly approves creation and later activation."
    }
  ],
  "skills": [
    {
      "id": "skill-0",
      "name": "Grok Bot Organization Discovery & Architecture",
      "description": "Use this when starting from zero, redesigning the Grok Bot organization, the company grew or shrank, strategy/product/team changed, or the current Bot hierarchy no longer fits.",
      "content": "Use this when starting from zero, redesigning the Grok Bot organization, the company grew or shrank, strategy/product/team changed, or the current Bot hierarchy no longer fits."
    },
    {
      "id": "skill-1",
      "name": "Workflow & Automation Decision",
      "description": "Use this for one workflow, recurring task, bottleneck, automation idea, proposed Bot responsibility, or candidate identified by organization discovery. Use before creating a new Bot, expanding an existing Bot, or creating a Routine.",
      "content": "Use this for one workflow, recurring task, bottleneck, automation idea, proposed Bot responsibility, or candidate identified by organization discovery. Use before creating a new Bot, expanding an existing Bot, or creating a Routine."
    },
    {
      "id": "skill-2",
      "name": "Grok Bot System Design",
      "description": "Use this only after the user approves an Automation Decision Brief, when an approved workflow decision requires a Bot, Skill, Routine, or small multi-Bot handoff design.",
      "content": "Use this only after the user approves an Automation Decision Brief, when an approved workflow decision requires a Bot, Skill, Routine, or small multi-Bot handoff design."
    },
    {
      "id": "skill-3",
      "name": "Pilot, Test & Activate",
      "description": "Use this after approval of a versioned Build Pack or material patch, to safely test before activation. Never use activation as the first test.",
      "content": "Use this after approval of a versioned Build Pack or material patch, to safely test before activation. Never use activation as the first test."
    },
    {
      "id": "skill-4",
      "name": "Audit, Repair & Govern",
      "description": "Use this for a noisy or inaccurate Bot, stale Skill, failing Routine, duplicated Bots, unclear ownership, portfolio drift, permission drift, weak value, or a company change that may have made the Bot organization outdated.",
      "content": "Use this for a noisy or inaccurate Bot, stale Skill, failing Routine, duplicated Bots, unclear ownership, portfolio drift, permission drift, weak value, or a company change that may have made the Bot organization outdated."
    },
    {
      "id": "skill-5",
      "name": "Public Share & Security Audit",
      "description": "Use this before creating a public link, marketplace submission, public template distribution, or redistributing a Bot package.",
      "content": "Use this before creating a public link, marketplace submission, public template distribution, or redistributing a Bot package."
    }
  ],
  "routines": [
    {
      "id": "routine-0",
      "name": "Weekly Company & Grok Bot Improvement Review",
      "summary": "Weekly Company & Grok Bot Improvement Review"
    },
    {
      "id": "routine-1",
      "name": "Monthly Bot Portfolio Strategy Review",
      "summary": "Monthly Bot Portfolio Strategy Review"
    },
    {
      "id": "routine-2",
      "name": "Quarterly Company & AI Operating Model Review",
      "summary": "Quarterly Company & AI Operating Model Review"
    }
  ],
  "integrations": []
}
```

### A.5 SWE

Page: https://x.ai/bot/marketplace/bots/seed-a91e4c

```json
{
  "id": "seed-a91e4c",
  "name": "SWE",
  "creatorName": "Cursor",
  "handle": "cursor_ai",
  "description": "Cursor's software engineer bot: writes code, triages issues, monitors production, and more.",
  "summary": "Cursor's software engineer bot: writes code, triages issues, monitors production, and more.",
  "categories": [
    "Engineering"
  ],
  "installCount": 0,
  "color": "yellow",
  "shape": "cloud",
  "addHref": "/bot/sd4474cf03cd8552905ff",
  "imageUrl": "https://cursor.com/apple-touch-icon.png",
  "updatedAt": "2026-08-29T00:00:00.000Z",
  "instructions": "",
  "memories": [],
  "skills": [],
  "routines": [],
  "integrations": []
}
```

---

## Not obtained

1. **The content of `instructions`.** It is the empty string in all 90 public objects, yet one memory refers to "the full recipe … in Instructions". Whether the field is populated for team-only templates, or stripped for public pages, is not stated anywhere. The public recipe is therefore incomplete by construction.
2. **Routine schedules, prompts, time zones and enabled state.** The public object carries `name` and `summary` only. Whether the added copy gets a routine at all, or a stub the Bot creates later, is not stated; the memory prose suggests the Bot creates it after a first-run interview.
3. **Skill bodies.** `content` duplicates the one-line `description` in all 443 skills, so the actual procedure text is not published.
4. **Whether Update template reaches copies already added.** No source describes propagation; the server-side version counter proves only that the template itself is versioned.
5. **Whether an added Bot's inherited memories, skills and routines are locked in any way.** No page says they are; no page says they are not. The "editable" column in 3.1 is based on the added Bot being an ordinary Bot.
6. **A documented template API, schema or file format.** None found. The RPC in 6.3 is an observation of the shipped client, undocumented and unauthenticated for reads only.
7. **Team-only and private templates.** Their pages are not reachable without membership, so their count, shape and whether they differ from public objects are unknown. The 90 measured are the public catalogue.
8. **Link expiry and revocation.** The terms call the licence "revocable" (S12) and the changelog handles a dead link (S4), but no page states whether a share link expires, can be revoked, or what happens to copies if it is.
9. **The Verified badge rendering.** Changelog says the badge exists (S4), the payload has no such field, and the word does not appear in the HTML of the index or the From Grok Bot Team category page. It is presumably an icon; its exact form was not captured.
10. **The guide's screenshots.** The Templates guide was read as text; its images (Share as Template button, details pane) were not inspected, so the visual layout of the share flow is not described here beyond the prose.
11. **Third-party counts of templates.** Directories of community template links exist and advertise their own catalogue sizes; they are secondary, were not read for this file, and are outside the scope of "how many templates exist" on xAI's own pages. On those pages the number is 90 marketplace templates plus 56 gallery share links.
