# 05: Dreaming

**What to build:** The dream plugin: alarm at 03:00 in the owner's zone, skip rule, model setting with Space default, a Turn with cause dream and its chapter, the tool allow-list with ask once, the fixed instruction and the supplied inputs, the dated dream file, the AGENTS.md section within 30 lines, proposals, the morning ask with dismiss_on_move_on, usage under memory, settings in the Robot page and the deputy tool (dm-hx44 to dm-buya).

**Blocked by:** 01, 02, 03

**Status:** done

- [x] Workerd test: trigger and skip; the model; inputs; outputs; one ask only; no world tool; chapter and usage; settings and Space defaults
- [x] Component test: the dreaming switch and model
- [x] docs/dreaming.md written with the contract verbatim

## Closing note

apps/worker/test/dreaming.test.ts: the dream hour planned at 03:00 in the Robot's zone; the dream on the Space's dream model with its inputs in the Wake-up; say and web_fetch refused; an ask without dismiss_on_move_on refused, one ask kept, a second refused; dreams/<date>.md by "the dream"; the AGENTS.md section cut to 30 lines with the rest of the file kept; no reply in the chat; usage under memory; the next Turn back on the Robot's model; no dream without evidence; none with dreaming off on the Robot, nor with the Space default off. apps/web/test/robot-settings-sections.test.tsx: the dreaming select and the dream model.

Decisions:
- plugins/dream.ts holds the contract, the instruction (dreamNote), the argument check and the duty (order 96, after the dream-hour close at 95, so a chapter still open is closed first). docs/dreaming.md is the contract for the Robots.
- The dream is a queued platform Wake-up with payload dream: true, so it is a Turn like any (Trajectory, chapters, accounting) with its own cause. While it runs, the step fence allows only the contract's tools (Mr. Robot also robot_files, robot_file_read, robot_file_write for ticket 06), on the Workspace only; other tools stay listed (the prompt prefix does not change) but every call is refused. A step counter cancels it at 12 model steps. No safety net after it.
- One ask: the argument check allows a single ask, and only with dismiss_on_move_on true. Whether PROACTIVE_PREFERENCES.md allows a question is the instruction's rule, not code.
- The model: dreamModel, else the Space's defaultDreamModel, else the Robot's own. The composition is keyed by its route too, so the dream builds one on its route and the next Turn builds the Robot's again.
- Evidence: daily notes uploaded since the last dream, chapters closed since, Attempts of this Robot that failed or were skipped since, and Asks answered since (all count for the skip rule; the dismissed and rejected ones are listed). The dream's date is the owner's local date six hours before the dream (the day that ended).
- The 30-line section is enforced after the dream: the platform cuts a longer "## How to act for <owner>" section and writes AGENTS.md as the platform. dreams/ files are tracked by the file history.
- Settings: Robot dreaming (null: the Space default) and dreamModel; Space defaultDreaming (on) and defaultDreamModel; the Robot settings page, the Admin page and the deputy's robot_settings_set edit them.
- The prompt's 2 900-word budget: the docs index has the line for dreaming.md; the hosts line was shortened to pay for it.
