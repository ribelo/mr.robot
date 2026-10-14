# 01: UI primitives: SaveButton, inline edit, select style, Check now

**Parent:** mr-robot-v1.12 (../mr-robot-v1.12.md) — stories ux-jefs, ux-ivf4, ux-h9wl, ux-kjli, ux-17sq, ux-5o28, ux-xbt3

**What to build:** Every form in the app saves through one SaveButton (Save → Saving… → Saved for two seconds → Save, fixed width); the loose "Saved." texts on the profile, in the Admin page, the memory file editors and the Files editor are gone; failures still show next to the button. Renaming a Provider account and naming a new local skill in Files use an inline field (Enter or blur saves, Escape cancels) instead of window.prompt(), so they work in the desktop app. "Check now" on an account shows "Checking…" and then the result with the time. Every select has the app's own chevron and one style.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] SaveButton with the four states and a width that does not change; used by Profile, Admin, Advanced settings, Robot profile, Files editor, Home memory, Member files
- [x] No `prompt(` call in the PWA source; a source test asserts it
- [x] Inline rename of an account and inline name of a new local skill (component tests)
- [x] Check now shows Checking… and the result with a time (component test)
- [x] One select style with the app's chevron
