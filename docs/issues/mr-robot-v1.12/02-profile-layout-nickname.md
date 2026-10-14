# 02: Profile layout, nickname, sidebar foot, Logins

**Parent:** mr-robot-v1.12 (../mr-robot-v1.12.md) — stories ux-ag0j, ux-etwn, ux-bune, ux-kopg, ux-mhji, ux-aor9, ux-i8ff, ux-nwi1, ux-xzdh

**What to build:** The profile reads You (name, nickname, time zone, quiet hours, notifications on this device) → Appearance (theme, work details) → Providers → Connections → Logins → Hosts → What your Robots know about you → Reset everything. In the desktop app the notifications card is replaced by one sentence under quiet hours. The optional nickname is stored on the Member; the runtime section of every Robot's prompt and my_capabilities carry the same Owner line ("Rafał Krzywaźnia, address them as Rafał"). The sidebar foot shows the name on one line with an ellipsis; the Logins list and its Add login button sit together. Back still goes where the person came from.

**Blocked by:** 01 (UI primitives)

**Status:** done

- [x] Section order as above; desktop sentence instead of the card (component test)
- [x] Nickname saved and returned by the profile API; Owner line in the prompt preview and in my_capabilities (workerd test)
- [x] Name in the sidebar foot does not wrap; Logins gap gone
