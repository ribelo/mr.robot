# Grok Bot templates: downloadable as data, and published outside the marketplace

Research date: 2026-10-21. Scope: whether a Grok Bot template can be obtained as structured data today, what shape that data takes, and which public collections exist outside x.ai.
Question asked by the owner: could Mr. Robot import them.
Method: every page fetched with a desktop browser User-Agent (Chrome 141 on macOS); where a page is JS-rendered, the Next.js React Server Component (RSC) flight payload was parsed out of the HTML. Numbers below are from my own fetches on this date, not from a write-up.

---

## 1. Sources

| # | Source | URL | What it gave |
|---|--------|-----|--------------|
| S1 | Marketplace index | https://x.ai/bot/marketplace | Raw HTML 409,105 B; 4 RSC pushes, 166,065 chars of flight data; one JSON-LD block (11,485 B) with a `CollectionPage`, a `Featured` list (4) and an `ItemList` "Marketplace templates" with `numberOfItems` 90 |
| S2 | Marketplace template page | https://x.ai/bot/marketplace/bots/overheard | Raw HTML 135,935 B; one RSC push; the full template object in the flight data |
| S3 | x.ai sitemap | https://x.ai/sitemap.xml | 290 URLs; 90 of them `/bot/marketplace/bots/<slug>`, 9 category pages, 21 `/bot/guides` URLs (one is the index) |
| S4 | Template share page | https://x.ai/bot/NIEguoGUjA648fUPle8F5 | Raw HTML 103,638 B; `["bot-template", id]` metadata only, plus the app deep link `grokbot://app/v1/bot-template?id=…` |
| S5 | Cursor public RPC, unauthenticated | POST https://api2.cursor.sh/aiserver.v1.GrokBotService/GetPublicGrokBotTemplate | 200 with `{"shareId":"<id>"}`; returns template identity, version, `blobObjectKey`, description, owner display name |
| S6 | Cursor template routes, unauthenticated | POST …/GetGrokBotTemplateImportDetails; S3 public assets bucket | Import route: 401 `ERROR_NOT_LOGGED_IN`; `grok-bot-marketplace-public-assets.s3.amazonaws.com/templates/<key>`: 403 `AccessDenied` |
| S7 | Docs: Create and manage Bots | https://docs.x.ai/grok-bot/bots | "Share a Bot" section: Create template, Copy link, View template details, Update template, Public link / Team-only |
| S8 | Docs: FAQ | https://docs.x.ai/grok-bot/faq | "Can I share a Bot with someone else? Yes. Open the Share menu and choose Create template, then Copy link…" |
| S9 | Guide: Templates for Grok Bot (2026-09-08, Matt Palmer) | https://x.ai/bot/guides/templates-for-grok-bot | What a template packages; Share as Template → Publish → Copy Link → Add to Grok Bot |
| S10 | Changelog | https://x.ai/changelog/bot | 0.30.0 "Share a Bot as a template…"; 0.67.0 "…and Bot templates on the web"; 0.70.2 "Bots can find a Bot template…"; the word "export" appears 0 times in the whole changelog |
| S11 | GitHub: awesome-grokbot-templates | https://github.com/cs68614-hash/awesome-grokbot-templates | `data/templates.json` (1.5 MB), 4,583 entries, CC0-1.0 |
| S12 | GitHub: awesome-grok-bot-templates | https://github.com/Maimuzamilhu/awesome-grok-bot-templates | `catalog.json` (5.8 MB), `count` 5,482, derived from botsdots.site |
| S13 | GitHub: grokbot-marketplace (Chinese detail library) | https://github.com/wasabihu/grokbot-marketplace | 90 files in `data/source/` that are the marketplace objects verbatim; 91 Markdown files; no licence |
| S14 | GitHub: grok-bots-for-deepseek-harness | https://github.com/brokep/grok-bots-for-deepseek-harness | 90 DeepSeek Harness plugin bundles, 1,805 files; no licence |
| S15 | GitHub: grokbot-pi-templates | https://github.com/Shixuuu/grokbot-pi-templates | 56,062 files (56,021 under `templates/`), converter pipeline, `research/FULL-RECIPE-ACCESS.md` (secondary) |
| S16 | GitHub: liquid-gold-grok-bot | https://github.com/Ormus-Solutions/liquid-gold-grok-bot | 201 files, `bots/<name>/{instructions,plugins,routines,template}.md` + `skills/*/SKILL.md`; MIT; template links "pending publish" |
| S17 | GitHub: awesome-grokbot-templates (lroolle) | https://github.com/lroolle/awesome-grokbot-templates | Link list, snapshot 2026-09-03 |
| S18 | GitHub: grokbot-templates (echris6) | https://github.com/echris6/grokbot-templates | 287 files, commercial bundles sold through Whop; no licence |
| S19 | GitHub: smaller template repos | https://github.com/ChamathRosh/grok-bot-templates · https://github.com/MrBekoX/root-agent-skill-framework · https://github.com/meir-bot/grokbot-executive-team · https://github.com/Boom-Vitt/grok-bot-creator-packs | 6 / 20 skill files / 16 agent files / 4 files; MIT or no licence |
| S20 | npm: @cursor/bdk | https://registry.npmjs.org/@cursor%2Fbdk | Bot Development Kit 0.2.27, "bots as Markdown and TypeScript"; `bdk init --template` |
| S21 | npm: grok-bot-cli | https://registry.npmjs.org/grok-bot-cli | Unofficial CLI 0.12.4, MIT: create/update bots, groups, messages; no template commands |
| S22 | npm: grokbot-core, grokbotagent-cli, @adam91holt/grokbot-sdk | https://registry.npmjs.org/grokbot-core | SDKs and RPC clients; no template collection |
| S23 | Hugging Face API | https://huggingface.co/api/models?search=grokbot ; `/api/datasets` | 0 models, 0 datasets for "grokbot", "grok bot", "grok-bot" |
| S24 | Grok Bot Wiki (third party) | https://www.grokbotwiki.com/ | "3,471 community templates, each link re-checked… checked 2026-10-14" |
| S25 | Grok Bot Templates (third party) | https://grokbottemplates.app/api/v1/feed.json | v1 feed, 463 items, generated 2026-10-20; note: "Templates carry share_url … instead of a prompt" |
| S26 | Bots Dots (third party) | https://botsdots.site/catalog.json | 5,482 entries, generated 2026-10-21T06:02Z; detail pages say "Open the x.ai page and read the full instructions" |
| S27 | Get Grok Bot (third party) | https://getgrokbot.com/ | Directory of public share links from X; "not an official xAI product"; stores the link, not the recipe |
| S28 | TemplateBot (third party) | https://templatebot.lol/ | Independent marketplace with free and paid listings; `/api/agent/templates` returns 401 without a token |
| S29 | TemplatesGrokBot (third party) | https://templatesgrokbot.com/ | Catalog with sign-in/pricing; 0 x.ai share links on the home page |
| S30 | Dead or broken third-party endpoints | https://grokbot-templates.com/ (HTTP 500) · https://thedailybot.com/ (TLS connect failure, curl 35) | Recorded as unavailable on this date |

Secondary material is marked "(secondary)" in the text. S15's research note is a write-up by another researcher; I used it only as a pointer to primary routes and re-tested each route myself.

---

## 2. Verdict

**Yes, a template can be downloaded as data — but only the 90 templates on the official marketplace pages, and only as a lossy projection of the real recipe.**

- There is **no export button**, **no documented API**, and **no published schema**. The app's own share flow ends at "Copy link" (S7, S8, S9), and "export" occurs **0 times** in the rendered changelog (S10; the 566 release-note lines catalogued in [grok-bot-release-notes.md](grok-bot-release-notes.md) contain no such line either).
- The recipe is nevertheless embedded in the HTML of every marketplace detail page as a JSON object of **17 keys** inside the Next.js RSC payload (S2), and the whole catalogue of **90 slugs** is machine-readable from the page's JSON-LD and the sitemap (S1, S3).
- The **share link** `x.ai/bot/<id>` — the form users actually circulate — carries **metadata only** (S4). An undocumented, unauthenticated Cursor RPC returns the same metadata in clean JSON, including a blob key; the blob itself is not fetchable and the import route requires a login (S5, S6).
- The real recipe — routine schedules, full skill bodies, plugin configuration — never leaves the server without a session, so what is downloadable is **not** enough to reconstruct a template faithfully.

Outside the marketplace, people publish four distinct things: link directories (4,583 and 5,482 entries), verbatim mirrors of the same 90 marketplace objects, derived re-formattings of those objects, and original recipes that were never on the marketplace. Nobody publishes a full, faithful export.

---

## 3. What the official marketplace page actually returns

### 3.1 Page shape

- Server: Next.js App Router on Vercel (`data-dpl-id` on `<html>`). **No `__NEXT_DATA__`** (0 occurrences). The data travels as RSC flight records: `self.__next_f.push([1,"…"])` — 4 pushes on the index, 1 on a template page.
- Decoding: take the string argument of each push, JSON-unescape it, concatenate. Index: 166,065 chars. Template page: 80,362 chars.
- JSON-LD (`<script type="application/ld+json">`): one block on the index with `Organization` (SpaceXSI), `CollectionPage` ("Bot Marketplace"), `ItemList` "Featured" (4 items) and `ItemList` "Marketplace templates" with `numberOfItems: 90` and one `ListItem` per template (`position`, `name`, `url`). A template page has one small JSON-LD block (`SoftwareApplication`: name, description, `author`, price 0, `operatingSystem`).
- `/bot/marketplace/bots/overheard.json`, `/bot/marketplace.json` and `/bot/sitemap.xml` all return **404**. `x.ai/sitemap.xml` lists the 90 template URLs plus 9 category pages, so the sitemap is the cheapest complete index.
- `?_rsc` alone returns HTML. Sending `RSC: 1` gets a 307 to `?_rsc`, and with the header kept curl receives **`text/x-component`** (77,801 B) — the same flight data as a raw stream. That is the closest thing to a "data endpoint" on the public site.

### 3.2 The template object: 17 keys

Every one of the 90 pages embeds one object with exactly these keys:

`id`, `name`, `creatorName`, `handle`, `description`, `summary`, `categories`, `installCount`, `color`, `shape`, `addHref`, `imageUrl`, `updatedAt`, `instructions`, `memories`, `skills`, `routines`, `integrations`.

Field semantics as observed:

| Field | Shape | Note |
|---|---|---|
| `id` | slug string | the URL slug |
| `addHref` | `/bot/<opaque id>` | the share id the app imports from |
| `instructions` | string | **empty in all 90** |
| `memories` | `[{id, name: "memory N", description}]` | full prose; this is where the persona text actually lives |
| `skills` | `[{id, name, description, content}]` | `content` equals `description`; one sentence, 96–232 chars in the six I checked — no SKILL.md body |
| `routines` | `[{id, name, summary}]` | no prompt, no schedule, no timezone, no enabled flag |
| `integrations` | `[{id, name, description}]` | name plus one sentence; no `installed` state |
| `installCount` | number | 0 on all 90 |
| `categories` | string array | `From Grok Bot Team`, `Sales`, `Marketing`, `Operations`, `Personal`, `Product`, `Design`, `Engineering`, `Recruiting & People`, or empty |

### 3.3 Measured coverage over all 90 templates

I fetched all 90 URLs from the sitemap (0.3 s apart) and parsed each payload; all 90 parsed, no failures.

| Measure | Count |
|---|---|
| Pages | 90 |
| Templates with non-empty `instructions` | **0** |
| Templates with memories | 85 (622 memories in total) |
| Templates with skills | 75 (443 skills) |
| Templates with routines | 67 (148 routines) |
| Templates with integrations | 68 (321 integrations) |
| Distinct creators (`handle`) | 40 |
| Templates with a non-zero `installCount` | 0 |
| Categories | From Grok Bot Team 54, Marketing 25, Sales 23, Personal 14, Engineering 8, Product 7, Design 4, Operations 4, Recruiting & People 2 |

These totals (622 memories, 443 skills, 148 routines, 321 integrations) match to the unit the numbers an independent public snapshot states for the same 90 templates (S13), which corroborates both the extraction method and the counts.

### 3.4 Raw example payload

`https://x.ai/bot/marketplace/bots/overheard`, object trimmed to two memories, one skill and one integration for length (the page carries 9 / 2 / 1 / 2). Text is verbatim, not edited:

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
    }
  ],
  "skills": [
    {
      "id": "skill-0",
      "name": "overheard",
      "description": "Core instructions on every turn: voice, first-run interview, day-two starter menu, sources, digests, anti-jobs.",
      "content": "Core instructions on every turn: voice, first-run interview, day-two starter menu, sources, digests, anti-jobs."
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

### 3.5 What the rendered page shows, and its one call to action

Stripped of tags, `/bot/marketplace/bots/overheard` reads "Back to Bot Marketplace / Overheard / By Lenny Rachitsky", the description, an "Import Bot" control, then four labelled sections — "memories — Facts it already knows", "skills — Playbooks it can run", "routines — Jobs that run on their own", "integrations — Apps it can use" — of which only the memory prose is rendered as text; the other three sections show names. The single call to action is an ordinary anchor: `<a … href="/bot/NIEguoGUjA648fUPle8F5">Import Bot</a>`. There is no download, copy or export control anywhere in the DOM.

---

## 4. The share link, and an undocumented public RPC

### 4.1 `x.ai/bot/<id>` is metadata only

`https://x.ai/bot/NIEguoGUjA648fUPle8F5` (the "Import Bot" target, i.e. the same template as above) returns 103,638 B of HTML whose flight payload contains **no** `memories`, `skills`, `routines` or `instructions` strings. What it contains is a react-query cache entry:

```json
{"id":"HK7rbeEuMNDD3_RbYyvx6","ownerType":"USER","sharerName":"Michael Heckert",
 "botName":"Sponsor Scout","description":"Finds brands already sponsoring people like you…",
 "addHref":"grokbot://app/v1/bot-template?id=HK7rbeEuMNDD3_RbYyvx6",
 "color":"#FF6700","shape":"blob"}
```

with the query key `["bot-template","<id>"]`. So a share link is an **id plus a `grokbot://` deep link**, nothing more. The page title is "Alfred by Robin" style; the body is a card with "Add to Grok Bot".

### 4.2 The RPC behind it, usable without a login

The client query has a server counterpart. Verified by me on 2026-10-21:

```
POST https://api2.cursor.sh/aiserver.v1.GrokBotService/GetPublicGrokBotTemplate
content-type: application/json
{"shareId":"HK7rbeEuMNDD3_RbYyvx6"}
```

returns **HTTP 200**, unauthenticated:

```json
{"template":{"shareId":"HK7rbeEuMNDD3_RbYyvx6","name":"Sponsor Scout","avatarShape":"blob",
 "avatarColor":"orange","createdAtMs":"1792454055416","updatedAtMs":"1792464839168",
 "blobObjectKey":"templates/HK7rbeEuMNDD3_RbYyvx6_v3.json","published":true,"activeVersion":3,
 "description":"Finds brands already sponsoring people like you, finds the real way in, and drafts the pitch. You hit send. Built for fighters, athletes, newsletter writers, and creators.",
 "ownerType":"GROK_BOT_TEMPLATE_OWNER_TYPE_USER"},"ownerDisplayName":"Michael Heckert"}
```

The field name matters: `templateId`, `id`, `botTemplateId` and `template_id` all return 400 "share_id is not a valid template id"; `shareId` returns 200.

The same call worked on three ids taken from a community list (S11), not from the marketplace:

| shareId | Answer |
|---|---|
| `KZ9xav0Qad1U5QigEn7rh` | `Alfred`, v1, `templates/KZ9xav0Qad1U5QigEn7rh_v1.json`, owner "Robin" |
| `tII28kVM4dxPvzSLjwqko` | `Bodyguard`, v2, `templates/tII28kVM4dxPvzSLjwqko_v2.json`, owner "Liam" |
| `GiBPBQR2WrHNul4k9Tz6Q` | `Chieeeeefy`, v3, `templates/GiBPBQR2WrHNul4k9Tz6Q_v3.json`, owner "Naoufal El hassnaoui" |

So there **is** a public, machine-readable template-identity endpoint for any share id, and it is undocumented. It returns identity, version, description and a blob key — not the recipe.

### 4.3 The recipe blob is closed

- `grok-bot-marketplace-public-assets.s3.amazonaws.com/templates/<key>` (with and without `.json`): **403 AccessDenied**. The bucket serves creator images (`/img/creators/…`) but not `templates/`.
- `POST …/GrokBotService/GetGrokBotTemplateImportDetails` with `{"shareId": …}`: **401 `ERROR_NOT_LOGGED_IN`**. This is the route that would hand back a signed blob URL.
- `GetGrokBotTemplateDetails` and `GetGrokBotTemplate` are not routes (404 "Route … not found").
- Guessed blob hosts (`cursorblobstore.nyc3.digitaloceanspaces.com`, `api2.cursor.sh/templates/…`, `data.x.ai/templates/…`) all 404.

The template's authoritative recipe therefore sits behind a Cursor session. The public page payload of §3 is a *rendered projection* built server-side from that recipe.

### 4.4 What the official documents say about taking a template out

- Docs, "Share a Bot": "Open the Share menu and choose Create template. The Bot builds the template; when it is ready, **Copy link**, **View template details** and **Update template** appear. Choose who can open the link: Public link or Team-only." Nothing else. (S7)
- FAQ: "Open the Share menu and choose Create template, then Copy link…" (S8)
- The guide: Share as Template → choose team or public → Publish → **Copy Link** → the link opens the template page → **Add to Grok Bot** → review context and integrations → **Add Bot**. It also states what is packaged: "a copy of the bot's instructions, relevant memories and skills, and specific plugins"; "custom code and scripts are not included"; non-standard plugins and MCP servers are not included. (S9)
- Changelog: 0.30.0 introduced template sharing by link (S10). 0.37.0 moved Share as template / Update template / View template details into the share menu. 0.41.0 gave each Bot a Marketplace page with a Verified badge. 0.48.0 added "Add a Bot straight from its row". 0.67.0: "Marketplace is now Connect Apps … and **Bot templates on the web**" — the move that produced the pages studied here. 0.70.2: "**Bots can find a Bot template** that fits what you describe and link it in the chat". The string "export" occurs **0 times** on the whole changelog page; every "Download" on it belongs to the app download button or to a note about a downloaded update — none concerns a template. (S10)

Conclusion for this section: the product offers **share**, not **export**. The only public, complete-ish artefact is the marketplace page payload.

---

## 5. GitHub: what people publish outside the marketplace

Four genres, and they are not interchangeable.

### 5.1 Link directories (thousands of share ids, no recipes)

| Repo | Contents | Format | Licence | Volume | Official? |
|---|---|---|---|---|---|
| [cs68614-hash/awesome-grokbot-templates](https://github.com/cs68614-hash/awesome-grokbot-templates) | curated list + `data/templates.json` | JSON: `{name, description, category, twitter, share_url, scraped_at}` | CC0-1.0 | **4,583** entries (Assistants 1283, Life 722, Engineering 639, Money 599, Creative 528, Research 478, Sales 334); `scraped_at` runs 2026-08-29 → 2026-10-21 | community |
| [Maimuzamilhu/awesome-grok-bot-templates](https://github.com/Maimuzamilhu/awesome-grok-bot-templates) | mirror of botsdots.site plus 8 category Markdown files | JSON: `{source, generated, count, templates[]}`; each `{name, summary, category, cadence, risk, access, integrations, official, creator{name,handle,url}, add, page, firstSeen, score, license, sources[]}` | LICENSE present, GitHub reports NOASSERTION | **5,482** entries (repo description still says "3,300+") | community |
| [lroolle/awesome-grokbot-templates](https://github.com/lroolle/awesome-grokbot-templates) | link list + verification workflow | Markdown + `scripts/verify-list.py` | NOASSERTION | snapshot 2026-09-03 | community |

All three carry the same message in different words: share links and metadata, no prompts. S11 says it outright: "This list does not rehost prompts, packed configs, memory dumps, or secrets."

### 5.2 Verbatim mirrors of the same 90 marketplace objects

**[wasabihu/grokbot-marketplace](https://github.com/wasabihu/grokbot-marketplace)** — the closest thing to a download of the marketplace. `data/source/<slug>.json` holds **90 files**, and the one I opened (`account-book.json`) has exactly the 17 keys of §3.2 (`addHref, categories, color, creatorName, description, handle, id, imageUrl, installCount, instructions, integrations, memories, name, routines, shape, skills, summary, updatedAt`) — a copy of what the page embeds, same 17 keys and same text. 91 Markdown files under `templates/` are Chinese translations of the same material, and `data/catalog.json` wraps it with `source`, `fetchedAt`, `complete`, `translatedCount`, `bots`. **No licence file.** The site advertises "下载 Markdown" (download Markdown).

**[brokep/grok-bots-for-deepseek-harness](https://github.com/brokep/grok-bots-for-deepseek-harness)** — 90 DeepSeek Harness plugin bundles (1,805 files), one directory per marketplace slug: `package.json` (with `homepage` pointing at the x.ai marketplace URL and `license: "SEE README"`), `cordis.patch.yml` (an agent-preset row whose `persona.prefix` carries the bot's description and instructions), `skills.mjs`, `skills/<name>/SKILL.md`, `setup-prompt.md` (prompts that create the bot's routines through `schedule_create`), `README.md`. It says: "Every template here was written by the creator named in its README and published on x.ai. This repository only reformats them". **No licence file**; the bundle `package.json` points at the README instead.

Caveat that matters for import: the SKILL.md bodies are **not** from the marketplace. The marketplace carries one sentence per skill ("Use when the user wants a plan for winning or growing an account…"); the bundle ships a frontmatter copy of that sentence *plus* a multi-step procedure ("Inputs: … 1. Ask two things … 2. Write the plan in seven short parts …"). The procedure text is new writing, not downloaded content. The same is true of `setup-prompt.md`, which reconstructs routines that the payload only names.

**[Shixuuu/grokbot-pi-templates](https://github.com/Shixuuu/grokbot-pi-templates)** — 56,062 files, 56,021 of them under `templates/` (a `templates/builtin/<slug>/.pi` layout for a different agent runtime), plus `catalog.json`, `data/marketplace-details.json`, `data/convert-failures.json`, and a six-step pipeline (`01-enumerate` … `06-site`). No licence. Its `research/FULL-RECIPE-ACCESS.md` (2026-10-09) is a **secondary** write-up of the same question; it is where I first saw the `api2.cursor.sh` route named, and I then confirmed that route and the 401/403 walls myself (S5, S6).

### 5.3 Original recipes, published as files (not exports)

| Repo | Contents | Format | Licence | Volume | Relationship to the marketplace |
|---|---|---|---|---|---|
| [Ormus-Solutions/liquid-gold-grok-bot](https://github.com/Ormus-Solutions/liquid-gold-grok-bot) | per bot: `README.md`, `instructions.md`, `plugins.md`, `routines.md`, `template.md`, `eval.md`, `skills/<name>/SKILL.md`, `LEDGER.md`; plus `.grok/skills/verify-…` and `scripts/create-bot.sh` | Markdown + shell | MIT | 201 files, 143 Markdown, 7 bots, 13 `SKILL.md` | **original**; `template.md` says "Add to Grok Bot: **pending publish**" — no share link yet |
| [echris6/grokbot-templates](https://github.com/echris6/grokbot-templates) | `<product>/{TEMPLATE.md, profile.md, memories.md, routines.md, setup.md, kit/…}`, `_shared/{guardrails,quality-tiers,skill-format,whop}.md` | Markdown + Python kit | none | 287 files, several products | **original**, commercial ("Sells through Whop") |
| [meir-bot/grokbot-executive-team](https://github.com/meir-bot/grokbot-executive-team) | `agents/01-chief-of-staff.md` … `15-specialist-research.md` plus `project-ceo.md`, `setup-prompt.md`, guides | Markdown | MIT | 28 files, 16 agent files | original |
| [MrBekoX/root-agent-skill-framework](https://github.com/MrBekoX/root-agent-skill-framework) | `root-agent-template/{description.md, skills/*.md, INSTALL.md, SETUP-INSTRUCTIONS.md}`, `lead-template/` | Markdown | MIT | 63 files, 45 Markdown, 20 skill files | original |
| [ChamathRosh/grok-bot-templates](https://github.com/ChamathRosh/grok-bot-templates) | six one-job templates: `invoice-nudger.md`, `missed-call-follow-up.md`, `morning-brief.md`, `quote-chaser.md`, `review-reply-drafter.md`, `what-should-my-bot-do.md` | Markdown | MIT | 6 | original; a sibling repo (`ai-agent-templates`, CC-BY-4.0) holds 36 cross-platform prompts |
| [Boom-Vitt/grok-bot-creator-packs](https://github.com/Boom-Vitt/grok-bot-creator-packs) | Thai-language team templates | Markdown | none | 4 files, 1 Markdown | original |

Markdown is the de facto community format: a prose body, often behind YAML front matter naming the skill (as in brokep's `SKILL.md`), inside a per-bot folder. It resembles a skill file more than a machine format, and no two repos agree on the layout.

### 5.4 Single-template repos and gists

Searches also returned single-purpose repos that hold one template plus its landing page or kit — e.g. `jeffgreendesign/follow-through`, `devicki/feedhand`, `greedfi/dotmail`, `adamsonwalter/grokbot-phone-caller`, `Gitmaxd/grok-bot-rocket-template`, `noam99moyal/podcast-summary-bot` (all MIT or unlicensed, all community). **No gist surfaced.** GitHub gist search and code search both require an authenticated session, so this is a gap, not a negative result; grep.app answered 429 (Vercel checkpoint) and could not be used.

---

## 6. npm, Hugging Face and the community directories

### 6.1 npm

There is **no npm package that ships Grok Bot template content**. What exists is tooling and SDKs:

| Package | Version | Licence | What it is |
|---|---|---|---|
| `@cursor/bdk` | 0.2.27 | "SEE LICENSE IN LICENSE.md" | **Bot Development Kit**, published by Cursor (scope `@cursor`, repo `github.com/cursor/cursor`), not by xAI: "how Cursor builds bots and agents… a folder of Markdown and TypeScript", `bot/{agent.ts, instructions.md, tools, skills, mcp-connections, subagents, channels, hooks, schedules}`, `bdk init ./x --template security-reviewer`. Its own comparison table puts Grok Bot on the app side ("You define: instructions, skills, and connected tools in the app") and BDK on the repo side. One of its templates is `grokbot-agents` ("Consult named Grok Bot agents") — i.e. BDK *calls* Grok Bots, it does not import their templates. |
| `grok-bot-cli` | 0.12.4 | MIT | unofficial `gbot` CLI: reads the app's stored session, creates/updates bots, groups, messages. No template subcommand. |
| `grokbot-core`, `grokbotagent-cli`, `@adam91holt/grokbot-sdk`, `@roamhq/grokbot`, `grokbot-mcp` | — | MIT or none | SDKs, RPC clients, channel plugins; `grokbot-core` and `grokbot-mcp` are at 0.2.1. |

So the only *official* machine-readable bot definition in this ecosystem is BDK's, and it is for Cursor-hosted bots, not for Grok Bot templates.

### 6.2 Hugging Face

Nothing. `/api/models` and `/api/datasets` return `[]` for "grokbot", "grok bot" and "grok-bot" (S23).

### 6.3 Community directories

| Site | What it is | Where the content comes from | Machine-readable? |
|---|---|---|---|
| grokbotwiki.com (S24) | guide site with a directory: "**3,471** community templates, each link re-checked … checked 2026-10-14" | share links from creators/X | HTML only in what I read; `/templates` 404s, the directory lives under another path |
| grokbottemplates.app (S25) | "Public Grok Bot shares, one tap from your own Grok Bot"; 464 x.ai links on the home page | submitted/scraped share links | **yes**: `/api/v1/feed.json` (463 items, `generated_at` 2026-10-20, `schema_revision` 2026-08-29, per-item `detail_url`), `/api/templates.json`, `/templates.json`, `/api/v1/status.json`, chapters in `llms.txt`. Its own note: "Templates carry `share_url` (the Add to Grok Bot link) instead of a prompt." The detail record's `body` is its own editorial Markdown ("Open the share link and read the instructions it carries"). |
| botsdots.site (S26) | 5,482-entry catalogue with per-template pages | "Listing facts indexed from public catalogs; descriptive text via Submitted by the creator" | **yes**: `/catalog.json` (4.7 MB, `generated` 2026-10-21T06:02Z) |
| getgrokbot.com (S27) | directory of public share links seen on X; "not an official xAI product" | author-published links; "we store the link" | `llms.txt` present |
| templatebot.lol (S28) | independent marketplace: free listings plus **paid** installs, leaderboard, MCP | user submissions | `/api/agent/templates` → **401** without a token; `/api/v1/*` 404 |
| templatesgrokbot.com (S29) | "biggest catalog of Grok Bot templates", sign-in and pricing | own catalogue | 0 x.ai share links on the home page |
| grokbot-templates.com (S30) | the web front of S11 | community links | **HTTP 500** on 2026-10-21 |
| thedailybot.com (S30) | previously cited as a secondary source | — | **unreachable**: TLS connect failure (curl 35) |

None of these rehost recipe text. The strongest statement is botsdots' own: "Open the x.ai page and read the full instructions, skills and routines it ships with … The live configuration on x.ai is the source of truth."

---

## 7. Conclusion

**Is there a machine-readable template format today? No — not as a published format.** There is no schema, no export, no documentation and no supported API. The changelog page (0.17.0 to 0.71.2) does not contain the word "export" at all, and the app's own flow stops at a link.

**Is there machine-readable template data anyway? Yes — as an artefact of the website.** Each of the 90 marketplace detail pages embeds a stable 17-key JSON object (S2), the 90 slugs are enumerable from the sitemap or the page's JSON-LD (S1, S3), and no login is needed. That is a de facto format: undocumented, unversioned, and lossy in four specific ways — `instructions` is always empty, skills are one-liners, routines carry a name and a summary but no prompt or schedule, and integrations are name plus sentence. Share links outside the marketplace yield identity metadata only (§4).

**The most complete public collection of template content** is a tie between two mirrors of the same 90 objects, and neither is richer than the source:

1. **wasabihu/grokbot-marketplace, `data/source/*.json`** — 90 files, verbatim the 17-key object, plus Chinese Markdown renderings.
2. **brokep/grok-bots-for-deepseek-harness** — the same 90 objects re-expressed as runnable DeepSeek Harness bundles; adds *invented* skill bodies and setup prompts, which is useful to run but no longer evidence of what x.ai ships.

Beyond the 90, the largest public collections are **link catalogues, not content**: 5,482 entries (S12, S26) and 4,583 entries (S11), plus 3,471 (S24) and 463 (S25) in HTML/JSON directories. Their text is copied or derived from the public description; the recipes stay on x.ai.

**What that means for Mr. Robot import.** An importer is feasible and needs no credentials, but it can only be faithful to the summary the marketplace publishes:

- Enumerate: `https://x.ai/sitemap.xml` → 90 `/bot/marketplace/bots/<slug>` URLs (or the JSON-LD `ItemList` on the index).
- Fetch each page, take the RSC flight string, JSON-unescape and concatenate, locate `{"id":"<slug>"` and brace-match to the object. One request per template, ≈135 KB HTML, ≈80 KB flight text.
- Map: `name` → Robot name; `description`/`summary` → description; `memories[].description` → persona or memory entries; `skills[].name + description` → skill stubs whose bodies must be authored; `routines[].name + summary` → routines whose prompts and schedules must be authored; `integrations[]` → connector hints, not grants.
- Nothing in the payload carries routine schedules, skill bodies, plugin configuration, MCP servers or secrets, so an imported template is a **brief to be re-authored**, not a working bot. That is exactly the "recipe, not a meal" framing xAI itself uses (S9).
- If Mr. Robot ever needs more, the only paths are a logged-in Cursor session (`GetGrokBotTemplateImportDetails`, 401 today) or one of the community bundles, whose extra text is third-party writing of unknown provenance.
- Legal/ethical note: the payload is public web content, not licensed for redistribution; the community mirrors that copy it carry no licence (S13, S14, S15), while the link-only lists that avoid copying are the ones with explicit licences (CC0-1.0 at S11). Re-publishing template prose would repeat an unresolved question in that ecosystem, not settle it.

---

## 8. Not obtained

- **No gist search.** GitHub gist and code search need an authenticated session, which this session does not have; `grep.app` returned 429 (Vercel checkpoint). The absence of gists is unproven.
- **No authenticated view.** I could not call `GetGrokBotTemplateImportDetails` with a session, so the exact recipe blob format (`{"…":…}` inside `templates/<id>_v<n>.json`) is unknown. The key naming is the only evidence that it is JSON.
- **Blob contents.** All three plausible blob hosts 404 and the S3 public bucket 403s on `templates/`; I did not attempt to enumerate the bucket.
- **thedailybot.com** could not be reached (TLS connect failure) and **grokbot-templates.com** returned HTTP 500, so neither was assessed.
- **templatesgrokbot.com** was only seen at its front page (catalogue behind sign-in/pricing); whether its listings copy marketplace text was not verified.
- **templatebot.lol** API needs a token (401); its listing payload shape and whether paid listings contain prompts were not seen.
- **Grok Bot app internals.** No app binary or local data directory was inspected on this machine, so nothing here describes what the desktop app stores after an import.
- **Marketplace search across categories.** I enumerated from the sitemap (90 URLs) and did not drive the site's own filters, so a template that is listed but excluded from the sitemap would be missing. The JSON-LD `numberOfItems` (90) and the sweep (90) agree, which makes a hidden template unlikely but not impossible.
