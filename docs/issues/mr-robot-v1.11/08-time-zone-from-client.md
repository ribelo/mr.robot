# 08: Time zone from the client

**Parent:** mr-robot-v1.11 (../mr-robot-v1.11.md) — stories sk-vpxv, sk-u3bv, sk-0vfm, sk-y38c, sk-hukg

**What to build:** The PWA sends the browser zone and the desktop app the system zone when the app opens; the profile updates unless the person pinned a zone by hand (the field shows the detected zone and "Use the app's zone" unpins). Robots read the owner's profile zone at every Turn and in Routine computation instead of a copy, get a memory note when it changes, and Routines keep their local times in the new zone. The PROACTIVE_PREFERENCES.md template refers to the profile's quiet hours instead of "09:00 to 21:30 local time".

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Header on /api/me updates the profile; manual pin and unpin in the Profile page
- [x] Robots use the profile zone live; note on change; Routine next runs recomputed
- [x] Workerd tests for header update, pinning, note, recomputation; template text updated
