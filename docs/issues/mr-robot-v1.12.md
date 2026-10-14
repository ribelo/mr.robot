---
title: "Mr. Robot v1.12 — first owner review: UI primitives, profile layout, connections as you, avatars, groups, limits"
status: ready-for-agent
story-prefix: ux
parent: mr-robot-v1.11.md
---

# Mr. Robot v1.12 — first owner review

## Problem Statement

The owner used the app for a day as a Member would and collected what got in his way. Most of it is not single bugs but three causes:

1. **No shared UI primitives.** Each spec added its own way to save (a loose "Saved." text next to the button on the profile, "Saving…" on the button in Advanced settings, a message above the form in Admin), its own confirmation and its own select. The "Saved." text is not aligned with the button. The Save button that changes to "Saving…" changes width. Rename of a Provider account and the new local skill in Files use `window.prompt()`, which the Electron desktop app does not implement: the button does nothing. "Check now" gives no sign that anything happens.
2. **Settings pages without an information architecture.** The profile is in the order the specs landed: You, theme, work details, **Reset everything**, notifications, Providers, Connections, Logins, Hosts, Member files. The notifications card in the desktop app has nothing to switch and talks about quiet hours that sit three sections above. The name in the sidebar foot wraps after a rename. The "Add login" button floats far from its list. Selects show the browser chevron. Admin picks the default model from a plain select while the New robot dialog has a searchable Provider-grouped combobox. Spend limits have three meanings of "empty" (no limit, Home default, unlimited).
3. **Connection flows designed around pasting secrets.** Slack asks the person to open DevTools and copy a token and a cookie. The platform already has a browser the person can take over, a Host browser, and a desktop app with its own browser session; none of them is used to connect. Discord can only be a bot, which needs a server admin's consent; the owner wants to read the servers he is on as himself. Connections that act as a person (Slack session, Google account) can be shared with the Home, which means another Member's Robot acts as that person.

Smaller things seen on the way: no nickname for the owner, no avatar for a Member, all Robot avatars are the same circle in a different colour, Workers AI cannot be switched off for the Home, the stored WireGuard configuration shows nothing about where the VPN goes, Robot tool settings do not say that Connections are the plugin tools and list Host facets flat, the New robot dialog asks "What should it do?" although the Robot interviews the person anyway, and the sidebar has only pin and hide where the owner wants groups.

Checked and left alone: host_run already requires the host and runs in the home directory; Host online status is already in `my_capabilities` and the runtime section of the prompt, and a call to an offline Host fails at once with a clear message; the product docs are in the prompt; a per-Robot spend limit exists. OpenCode Go has no account on the live Home (the owner adds the key again; if it vanishes again it is a bug).

## Solution

**One set of primitives.** A `SaveButton` (Save → Saving… → Saved for two seconds → Save, fixed width) replaces every "Saved." text and every per-page variant. An inline editor replaces every `prompt()`. Every select gets the app's own chevron and the same style; where a model is chosen, the Provider-grouped combobox is used. "Check now" shows "Checking…" and then the result with the time.

**Profile in order.** You (name, nickname, time zone, quiet hours, notifications on this device) → Appearance (theme, work details) → Providers → Connections → Logins → Hosts → What your Robots know about you → Reset everything. In the desktop app the notifications card goes; one sentence under quiet hours says that the app shows them natively. The sidebar foot shows the Member's avatar and a name that never wraps. Logins get a tidy list and button.

**Nickname and avatars.** A Member has an optional nickname; the runtime section of every Robot's prompt names the owner and, when set, how to address them. A Member has an avatar: a colour with initials, or an uploaded picture. A Robot's avatar is a generated flat cartoon ball (own SVG, countryball style, animated), deterministic from a seed stored with the Robot; "Another look" in the Robot's profile draws a new seed. The colour stays as the tint behind it.

**Home controls.** Workers AI gets a switch in Home settings. Off: it disappears from every model chooser, Provider cards show "Disabled by the admin", model chains skip its entries, and a Robot with nothing left blocks with that reason until the admin switches it on or the chain changes. The default model for new Robots is chosen with the Provider-grouped combobox. Spend limits become a type: the Home limit is *no limit* or *an amount in USD (at least 1)*; a Robot's limit is *the Home's*, *no limit*, or *an amount*. The forms are segmented controls; an amount field appears only for an amount. The WireGuard card shows, after saving, the non-secret part: endpoint, the server name from Proton's comment lines, and the country when the name carries it.

**Connections as you.** Slack and Discord get a second way to connect: *as you*. In the desktop app, Connect opens a sign-in window for the service; when the person has signed in, the app reads the session (Slack: the xoxc token and the d cookie; Discord: the user token) and hands it to the server; the window closes. In the PWA, Connect opens the Robot's browser on the service's sign-in page under Takeover; when the person hands back, the platform reads the same values from the browser's cookies and storage. Pasting stays as the fallback under "Paste a session instead". Discord *as you* reads through REST (no gateway), with read tools by default and write tools behind the write grant like Slack; the connect form carries one sentence that Discord forbids this and may close the account. Discord *as a bot* stays unchanged. Connections that act as a person (Slack, Google, Discord as you) cannot be shared with the Home: no checkbox, and the server refuses `shared` for them; an already shared one is unshared by a migration and the owner is told in a note.

**Robot settings.** The Connections section says it holds the plugin tools, one item per connected account, each labelled with its plugin ("Google · r.krzywaznia@gmail.com", "Discord bot · Mr. Robot"). Hosts are grouped under a heading per Host with its online/offline state; the facets (files, shell, browser) sit under it. The `web` group is labelled "Fetch pages by address (web_fetch, free; searching is Exa)".

**Sidebar groups.** A Member sorts the Robots they can reach into groups of their own (another Member has their own groups). A group has a name, collapses, and is reordered; a Robot moves by drag and drop in the sidebar or by "Move to…" in its menu; "Hidden" becomes a built-in collapsed group; pinned Robots stay on top of their group. Groups live in the Member's list preferences next to pinned and hidden.

**New robot.** The dialog keeps only the model; the Robot asks what it is for and proposes its name, as today.

## User Stories

### UI primitives
1. As a Member, I want one Save button everywhere that shows Saving… and then Saved for two seconds without changing width, so that I know a save happened and nothing jumps ^ux-jefs
2. As a Member, I want the loose "Saved." texts gone from the profile, the Admin page, the memory file editors and the Files editor, so that the feedback is always in the same place ^ux-ivf4
3. As a Member, I want to rename a Provider account with an inline field that works in the desktop app, so that Rename does something ^ux-h9wl
4. As a Member, I want to name a new local skill in Files with an inline field, so that it works in the desktop app ^ux-kjli
5. As a Member, I want "Check now" to show "Checking…" and then the result with the time, so that I see that the check ran ^ux-17sq
6. As a Member, I want every select in the app to look the same with the app's own chevron, so that forms look finished ^ux-5o28
7. As a developer, I want no call to window.prompt() to remain in the app, so that the desktop app never has a dead button ^ux-xbt3

### Profile layout
8. As a Member, I want the profile in the order You, Appearance, Providers, Connections, Logins, Hosts, What your Robots know, Reset everything, so that the dangerous action is last and related things sit together ^ux-ag0j
9. As a Member, I want quiet hours and the notifications switch in the same You section, so that the sentence about quiet hours stands next to them ^ux-etwn
10. As a desktop app user, I want no notifications card with nothing to switch; one sentence under quiet hours says the app shows them natively, so that the page does not pretend to offer a setting ^ux-bune
11. As a Member, I want my name in the sidebar foot on one line with an ellipsis, so that a long name does not break the layout ^ux-kopg
12. As a Member, I want the Logins list and its Add login button laid out without the gap, so that the section looks like the others ^ux-mhji
13. As a Member, I want the Back button on every settings page to go where I came from, as v1.11 decided, so that the new order does not change navigation ^ux-aor9

### Nickname
14. As a Member, I want an optional nickname in You, so that Robots can address me the way I like ^ux-i8ff
15. As an owner, I want the runtime section of every Robot's prompt to name me and, when set, my nickname as how to address me, so that each Robot uses it without being told ^ux-nwi1
16. As an owner, I want my_capabilities and the prompt preview to show the same owner line, so that the three never disagree ^ux-xzdh

### Avatars
17. As a Member, I want to pick an avatar colour and have my initials shown on it, so that I am recognisable in the sidebar and to other Members ^ux-2ft4
18. As a Member, I want to upload a picture as my avatar, stored by the platform and shown wherever my initials were, so that I can use my face ^ux-s88l
19. As a Member, I want to remove the picture and fall back to colour and initials, so that the choice is reversible ^ux-g4l9
20. As an owner, I want every Robot to have a generated robot avatar (own SVG ball) derived from a seed stored with the Robot, tinted with its colour, so that Robots look different from each other ^ux-0zm6
21. As an owner, I want "Another look" in a Robot's profile to draw a new seed and show the result before I save, so that I can pick one I like ^ux-h0s4
22. As a Member, I want existing Robots to get a seed from their id on first display, so that nothing changes for them until someone presses Another look ^ux-4fgy
23. As a Member, I want the avatar shown in the sidebar, the conversation header, the Admin fleet table and Robot messages, so that one look identifies a Robot everywhere ^ux-n1mw

### Workers AI switch
24. As the Home admin, I want a switch in Home settings that turns Workers AI off for the Home, so that nobody picks a model I do not want used ^ux-101w
25. As a Member, I want Workers AI models gone from every model chooser while it is off, and the Provider card to say "Disabled by the admin", so that I know why they are missing ^ux-xsnr
26. As an owner, I want a Robot's model chain to skip Workers AI entries while it is off and to block with "Workers AI is disabled by the admin" when nothing else is left, so that the Robot does not silently fail ^ux-zh1l
27. As an owner, I want a blocked Robot to resume at its next Wake-up when the admin switches Workers AI back on, so that nothing has to be re-created ^ux-mz3h
28. As the Home admin, I want the default model for new Robots to leave Workers AI when I switch it off, with a note telling me what it changed to, so that new Robots start on something that works ^ux-jseo

### Default model and spend limits
29. As the Home admin, I want to choose the default model for new Robots with the Provider-grouped searchable combobox, so that I see Provider and model like everywhere else ^ux-3l7i
30. As the Home admin, I want the Home spend limits (per Robot, per Member) as a choice between No limit and An amount, with the amount field only for An amount and at least 1 USD, so that the form has no empty-means-something field ^ux-dbx4
31. As an owner, I want a Robot's spend limit as a choice between the Home's, No limit and An amount, so that I can raise, lower or lift it for one Robot ^ux-q8ve
32. As an owner, I want the stored limit to be a typed value, never null or zero with a meaning, and existing settings migrated (null → the Home's for a Robot, null → No limit for the Home, 0 → No limit), so that no state can be misread ^ux-ommv
33. As an owner, I want the Admin fleet table and the Robot's settings to show the effective limit ("$20 (Home)", "no limit", "$50"), so that I see what applies ^ux-en86

### WireGuard
34. As the Home admin, I want the Proton VPN card to show, after saving, the endpoint, the server name from the configuration's comments and the country when the name carries it, so that I know where the VPN exits ^ux-t4wi
35. As the Home admin, I want the private key and preshared key never shown or stored outside the sealed configuration, so that the card leaks nothing ^ux-a3ec

### Connections as you
36. As a Member using the desktop app, I want "Connect Slack" to open a Slack sign-in window and, once I am signed in, to connect my workspace without me copying anything, so that connecting is one step ^ux-taxm
37. As a Member using the desktop app, I want "Connect Discord as you" to do the same with my Discord account, so that my Robots can read the servers I am on ^ux-66a4
38. As a Member using the PWA, I want "Connect Slack" or "Connect Discord as you" to open my Mr. Robot's browser on the sign-in page under Takeover and to connect when I hand back, so that the same works from a phone ^ux-8pek
39. As a Member, I want the sign-in window or Takeover to time out after ten minutes without a session and to tell me, so that an abandoned connect does not hang ^ux-wgok
40. As a Member, I want "Paste a session instead" to stay as a fallback with the current fields, so that I am never stuck when the automatic way fails ^ux-jpwz
41. As a Member, I want the session the app read to never be shown to me or to a Robot, so that it is as private as a pasted one ^ux-j7m1
42. As an owner, I want a Discord *as you* Connection to give Robots read tools (servers, channels, messages, threads, search, people) through Discord's REST API without a gateway connection, so that it behaves like the Slack reader ^ux-urf8
43. As an owner, I want Discord *as you* write tools (send, reply, react, mark read) only behind the Connection's write grant, so that reading is the default ^ux-l2ul
44. As a Member, I want one sentence on the Discord *as you* form that Discord forbids this and may close the account, so that I take the risk knowingly ^ux-gdg3
45. As a Member, I want both Discord ways (bot, as you) listed on the Discord row with their own Connect, so that I can have both ^ux-s8rx
46. As a Member, I want a Slack or Discord *as you* Connection whose session Slack or Discord rejects to show "Sign in again" and to reconnect through the same window or Takeover, so that recovery is the same one step ^ux-cbo3
47. As a Member, I want no "Shared with the Home" on Slack, Google and Discord *as you* Connections, and the server to refuse sharing them, so that no other Member's Robot acts as me ^ux-bk91
48. As a Member, I want an already shared Slack or Google Connection unshared by the update, with a note on the Connections section telling me what changed and which Robots lost it, so that nothing happens silently ^ux-cop2
49. As an owner, I want Robots of other Members who held a grant on my formerly shared Connection to lose the grant and be told at their next Turn, so that they do not fail without explanation ^ux-dz8p
50. As a Member, I want Discord bot, Provider accounts, Hosts and logins to keep "Shared with the Home", so that the rule only touches connections that act as a person ^ux-ro7d

### Robot settings
51. As an owner, I want the Connections section of a Robot's settings to say "Plugin tools: one item per connected account" and each item labelled with its plugin and account, so that I know what "r.krzywaznia@gmail.com" is ^ux-5g3w
52. As an owner, I want the Hosts section grouped under one heading per Host with its online/offline state, and the facets files, shell and browser under it, so that the list reads by computer ^ux-q8o6
53. As an owner, I want the web group labelled "Fetch pages by address (web_fetch, free; searching is Exa)", so that I know where it comes from ^ux-qm6u
54. As an owner, I want my_capabilities and the runtime section to carry the same labels, so that the Robot and I read the same names ^ux-ywxa

### Sidebar groups
55. As a Member, I want to create a named group in the sidebar, so that I can sort Robots by work, home or project ^ux-wxbm
56. As a Member, I want to rename, reorder and delete a group (its Robots go back to the ungrouped list), so that the structure follows my life ^ux-o7po
57. As a Member, I want to collapse and expand a group and have the state remembered, so that a group I do not use stays out of the way ^ux-xbvi
58. As a Member, I want to drag a Robot from one group to another in the sidebar, so that sorting is quick ^ux-0qjq
59. As a Member, I want "Move to…" in a Robot's menu with the list of groups, so that sorting works on a phone ^ux-sj2f
60. As a Member, I want "Hidden" to be a built-in collapsed group at the bottom, so that hiding is a case of grouping ^ux-dice
61. As a Member, I want pinned Robots on top of their group and unread marks unchanged, so that grouping does not lose the existing order ^ux-x62j
62. As a Member, I want my groups to be mine only, so that another Member sees their own sidebar ^ux-oltg
63. As a Member, I want the search to still find Robots across groups and show which group they are in, so that a collapsed group does not hide a match ^ux-gieb
64. As a Member, I want a Robot that is deleted or that I lose reach to to leave its group by itself, so that no group names a Robot that is gone ^ux-lywk

### New robot
65. As a Member, I want the New robot dialog to ask only for the model, so that I am not asked to write what the Robot will discover itself ^ux-hckf
66. As a Member, I want the sentence under the model to say that the Robot asks me what it is for and proposes its name, so that I know what happens next ^ux-1pjk

### Docs and prompt
67. As an owner, I want the product docs (connections, hosts, grants, members) updated for groups, avatars, nickname, connections as you and the Workers AI switch, so that a Robot answers questions about them correctly ^ux-2tdv
68. As an owner, I want the platform prompt to tell a Robot that Host online state is in its runtime section and in my_capabilities and that it does not probe a Host with a command, so that it does not waste a call ^ux-czg2

## Implementation Decisions

- **SaveButton** is one component in the PWA with a state machine idle → saving → saved → idle (saved lasts two seconds; a new press during saved returns to saving). Width is fixed to the widest label. Every form that saves uses it; the loose status texts and the Admin message for saves go. Failures still show next to the button as today.
- **Inline edit** is one component: a label that becomes an input on Edit/Rename, saves on Enter or blur, cancels on Escape. Used for the account label and the new local skill name. No `prompt()` remains; a lint rule or a test asserts it.
- **Select style**: one CSS rule set with `appearance: none` and the app's chevron for every select; the Provider-grouped `ModelSelect` is used in Admin's Home settings.
- **Profile order** is a reorder of sections in the Profile component; the desktop notifications card is replaced by one sentence under quiet hours when the host bridge reports native notifications.
- **Nickname**: a new optional field on the Member profile (`nickname` string, empty means none, in the API as an optional field). The runtime section of the platform prompt and `my_capabilities` render an "Owner" line from the same data: name, and "address them as X" when set.
- **Member avatar**: the profile stores `avatar` as a typed value: `{ kind: 'initials', color }` or `{ kind: 'picture', color, key }` where the picture lives in R2 under the Member and is served through the API with a short cache; uploads are limited (1 MB, PNG/JPEG/WebP, resized client-side to 256 px). The sidebar foot and the Admin members table render it.
- **Robot avatar**: the Robot identity gets `avatarSeed` (string). Avatars are rendered client-side with the app's own SVG ball generator (no dependency) from the seed, tinted with `avatarColor`; a Robot without a seed uses its id. "Another look" draws a random seed into the Robot profile draft. The dependency is new and client-side only; its licence (bottts: free for personal and commercial use) is recorded in the ticket.
- **Workers AI switch**: a Home setting `workersAiEnabled` (boolean, default true). The model catalogue, the Providers view, the Home settings view and the Robot settings catalogue filter it out when false. Chain walking treats a Workers AI entry as unavailable with reason "disabled by the admin"; the existing all-unusable block carries the reason; the existing resume-by-alarm covers switching back on. Switching off moves the Home default model to the first usable model of the admin's accounts and returns the new default in the save response for the note.
- **Spend limits as types** in the protocol: `HomeSpendLimit = { kind: 'none' } | { kind: 'usd'; amount: number }` (amount ≥ 1, integer dollars) and `RobotSpendLimit = { kind: 'home' } | HomeSpendLimit`. Stored as JSON; a one-time migration maps null/0 as the story says. The spend check resolves the effective limit through one function used by the Robot, the Admin table and the settings view.
- **WireGuard card**: on save the server parses the configuration (INI-like sections, `#` comments), stores the sealed whole as today, and stores beside it a public summary: endpoint host:port, server name (Proton writes it in a comment line; otherwise none) and country code (first two letters of a Proton server name like `PL#45` or `pl-free-12`). The Admin view returns the summary; the card shows it.
- **Session capture in the desktop app**: the host app gains an IPC command `captureSession(kind)` that opens a BrowserWindow in an isolated session on the service's sign-in URL, polls after each navigation for the markers (Slack: `localConfig_v2` in localStorage of app.slack.com and the `d` cookie; Discord: the `token` in localStorage of discord.com), returns them to the page and clears the isolated session. The page posts them to the existing paste endpoint. Ten-minute timeout. The page knows the bridge by the existing `mrRobotHost` global.
- **Session capture through Takeover**: a new API action "connect through browser" on Mr. Robot: it opens a tab on the sign-in URL, starts a Takeover, and on hand-back reads cookies and localStorage of the service origins through the browser driver seam, posts them to the same connection-creation path and closes the tab. The browser state of that tab is discarded afterwards (the session belongs to the Connection, not to the Robot's browser).
- **Discord as you**: a second connector kind `discord-user` in the plugin catalogue (same plugin row, two connect ways). Tools mirror the Slack connector's read set over Discord's REST endpoints with the user token in the Authorization header, and the write set behind the write grant. No gateway. A 401 marks the Connection "sign in again".
- **No sharing for person connections**: the connector spec gains `actsAsPerson: true` for Slack, Google and discord-user; the UI hides the checkbox and the PATCH/POST handlers refuse `shared` for them. A migration unshares existing ones, revokes grants on other Members' Robots and queues the note for the owner and a memory note for the affected Robots.
- **Robot settings labels**: capability items for connections carry the plugin title; host items are grouped by host id in the settings view (data already carries the host); the web group description changes in the catalogue. `my_capabilities` uses the same items, so it follows.
- **Sidebar groups**: list preferences gain `groups` (ordered list of `{ id, name, collapsed }`) and per Robot `groupId` (absent = ungrouped). Hidden stays a flag rendered as the built-in last group. Drag and drop uses the HTML drag API (no library); "Move to…" is a submenu. Search ignores collapsing and shows the group name under a match. A Robot that leaves reach is dropped from its group when the list is read.
- **New robot**: the dialog drops the brief field; the API keeps accepting an optional brief for Mr. Robot's own `create_robot` path.
- **Docs and prompt**: the product docs for members, connections, hosts and grants are extended; the tool-rules section of the platform prompt gets the Host sentence.

## Testing Decisions

A good test drives the system the way the person or the Robot does: through the edge API in workerd with the scripted model and stubbed service HTTP, or through the rendered PWA component with a stubbed API. No test touches the network.

- Workerd through the API (prior art: the v1.10 account tests, the v1.11 prompt-preview and capability tests): nickname in the runtime section and my_capabilities (ux-nwi1, ux-xzdh); Member avatar upload, serve, remove (ux-s88l, ux-g4l9); Robot avatar seed default and change (ux-0zm6, ux-4fgy); Workers AI off filters catalogues, chain skips with reason, block and resume, default model moved (ux-101w, ux-xsnr, ux-zh1l, ux-mz3h, ux-jseo); spend limit types, migration and effective limit in the views (ux-ommv, ux-en86); WireGuard summary from a recorded Proton configuration, no secret in the view (ux-t4wi, ux-a3ec); Discord as you tools against stubbed REST and the 401 path (ux-urf8, ux-l2ul, ux-cbo3); refusal of shared for person connections and the unshare migration with grant revocation and notes (ux-bk91, ux-cop2, ux-dz8p, ux-ro7d); capability labels and host grouping data (ux-5g3w, ux-q8o6, ux-qm6u, ux-ywxa); group preferences round trip and cleanup on lost reach (ux-wxbm, ux-o7po, ux-oltg, ux-lywk); Takeover connect reads cookies and storage from a fake driver and creates the Connection (ux-8pek, ux-j7m1).
- Component tests (prior art: theme-setting, time-zone-setting, model-select, chain-editor, workspace-hygiene tests): SaveButton states and fixed width (ux-jefs, ux-ivf4); inline rename and skill name (ux-h9wl, ux-kjli); Check now states (ux-17sq); profile order and desktop sentence (ux-ag0j, ux-etwn, ux-bune); Admin model combobox and limit segments (ux-3l7i, ux-dbx4, ux-q8ve); Connections row with two Discord ways, no shared checkbox, paste fallback, warning sentence (ux-s8rx, ux-bk91, ux-jpwz, ux-gdg3); Robot settings sections (ux-5g3w, ux-q8o6); sidebar groups: create, rename, collapse, move by menu, drag, hidden group, pinned order, search across groups (ux-wxbm, ux-o7po, ux-xbvi, ux-0qjq, ux-sj2f, ux-dice, ux-x62j, ux-gieb); New robot dialog (ux-hckf, ux-1pjk); a source test that no `prompt(` call exists in the PWA (ux-xbt3).
- Manual on heisenbug (the desktop app): Slack and Discord sign-in windows, timeout, sign-in-again (ux-taxm, ux-66a4, ux-wgok, ux-cbo3); avatar rendering; drag and drop feel.

## Out of Scope

Discord as you through the gateway (live events); a Slack bot connector; Google as a shared Connection; group sharing between Members; avatar pictures for Robots; per-group notification settings; a Members page for non-admins; Workers AI per-Member switches.

## Further Notes

The owner takes the Terms-of-Service risk of Slack and Discord sessions knowingly (session 2026-10-14). OpenCode Go has no account on the live Home; the owner adds the key again; if it disappears, that is a separate diagnosis.
