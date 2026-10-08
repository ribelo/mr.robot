# 08: Empty, loading and error states; polish pass over every page

**Parent:** mr-robot-v1.3 (../mr-robot-v1.3.md) — stories pl-fxge, pl-qdle

**What to build:** Shared state components used on every page; a page-by-page pass for spacing, alignment, typography, widths and small screens against the Grok Bot screens for simple views and the DSH conversation for tool cards, with before/after screenshots recorded here.

**Blocked by:** 03 Markdown, streaming and Work details levels; 05 Native notifications in the app and unread badges; 06 Delete robot, clear history, reset everything; 07 Search, file preview and download, host action log

**Status:** done

- [x] Every route has empty, loading and error states
- [x] Before/after screenshots for each page in this ticket
- [x] Owner's earlier alignment complaints (hosts table, inputs, checkboxes) verified fixed on the live app

## What changed

- **Shared states** (components/States.tsx: Loading, Empty, ErrorState), used on every route instead of bare "Loading…" and raw server text:
  - App start, home ("Pick a robot"), conversation loading and errors (with Try again and All robots), trajectory, settings, takeover, file list and file errors, pairing, admin, This computer and its log, robot and routine sheets.
  - An unknown address now shows "Nothing here".
  - Error messages read as sentences; the list says when the filter matches nothing.
- **Phone fixes:**
  - The robot list overflowed sideways: rows were 100% wide plus padding without border-box sizing.
  - File rows now put size and date under the name instead of breaking names mid-word.
  - Narrower page padding, a narrower search field, and wrapping table cells.
- **Earlier pass** (2026-10-07, commit c3ecd1e): one control height, tables across the column, centred cells, checkbox rows on one line, consistent section spacing. Your hosts row is checked again below.
- **Small fixes found in this pass:**
  - The memory/world.md placeholder.
  - The Hosts description now describes pairing from the app.
  - Link-styled buttons in the file view use the text colour.
  - The "Type … to confirm" label stays on one line.
  - Page-state classes renamed after they clashed with the state pills in Admin.
- **Model:** simple views follow the reference screens in docs/reference (list, chat, panel, sheets); tool cards follow DSH's conversation (ticket 03).

## Verified

- **Component test** states.test.tsx: loading role and text, empty title, error as a sentence with Try again and Back.
- All web (17) and worker (169) tests pass.
- **Live before/after, 2026-10-08** (desktop 1894×943 in Leash; phone as a 390×844 frame of the same signed-in app):

| Page | Desktop before | Desktop after | Phone before | Phone after |
|---|---|---|---|---|
| home | ![](img/08/home-desktop-before.webp) | ![](img/08/home-desktop-after.webp) | ![](img/08/home-phone-before.webp) | ![](img/08/home-phone-after.webp) |
| chat | ![](img/08/chat-desktop-before.webp) | ![](img/08/chat-desktop-after.webp) | ![](img/08/chat-phone-before.webp) | ![](img/08/chat-phone-after.webp) |
| panel | ![](img/08/panel-desktop-before.webp) | ![](img/08/panel-desktop-after.webp) | ![](img/08/panel-phone-before.webp) | ![](img/08/panel-phone-after.webp) |
| settings | ![](img/08/settings-desktop-before.webp) | ![](img/08/settings-desktop-after.webp) | ![](img/08/settings-phone-before.webp) | ![](img/08/settings-phone-after.webp) |
| files | ![](img/08/files-desktop-before.webp) | ![](img/08/files-desktop-after.webp) | ![](img/08/files-phone-before.webp) | ![](img/08/files-phone-after.webp) |
| file | ![](img/08/file-desktop-before.webp) | ![](img/08/file-desktop-after.webp) | ![](img/08/file-phone-before.webp) | ![](img/08/file-phone-after.webp) |
| trajectory | ![](img/08/trajectory-desktop-before.webp) | ![](img/08/trajectory-desktop-after.webp) | ![](img/08/trajectory-phone-before.webp) | ![](img/08/trajectory-phone-after.webp) |
| profile | ![](img/08/profile-desktop-before.webp) | ![](img/08/profile-desktop-after.webp) | ![](img/08/profile-phone-before.webp) | ![](img/08/profile-phone-after.webp) |
| admin | ![](img/08/admin-desktop-before.webp) | ![](img/08/admin-desktop-after.webp) | ![](img/08/admin-phone-before.webp) | ![](img/08/admin-phone-after.webp) |
| thiscomputer | ![](img/08/thiscomputer-desktop-before.webp) | ![](img/08/thiscomputer-desktop-after.webp) | ![](img/08/thiscomputer-phone-before.webp) | ![](img/08/thiscomputer-phone-after.webp) |
| pair | ![](img/08/pair-desktop-before.webp) | ![](img/08/pair-desktop-after.webp) | ![](img/08/pair-phone-before.webp) | ![](img/08/pair-phone-after.webp) |
| missing | ![](img/08/missing-desktop-before.webp) | ![](img/08/missing-desktop-after.webp) | ![](img/08/missing-phone-before.webp) | ![](img/08/missing-phone-after.webp) |

- Some "before" frames are the previous page: the screenshot tool returned a stale frame. The "after" set was taken with a second capture per page.
- **Hosts row on the live profile** (your 2026-10-07 example): name, online, sharing and Unpair on one line, Unpair at the right edge (![hosts](img/08/profile-hosts-after.png)). Inputs and checkboxes, as in the Admin and Advanced settings shots above.
