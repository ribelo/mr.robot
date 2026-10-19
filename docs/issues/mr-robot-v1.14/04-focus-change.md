# 04: Changing focus with a reason

**What to build:** task_focus takes the Task to focus on or none, plus a reason, and may be called any number of times in a Turn (ao-lj6z). Changing or clearing focus ends the previous Attempt as skipped with the reason as its first line, starts an Attempt for the new Task, and updates the Home registry row so Mission Control shows the new focus at once (ao-cvpx). A later Wake-up of the dropped Task starts a fresh Attempt as today (ao-n2fo). The tasks product doc and the prompt's Tasks section describe it.

**Blocked by:** 03

**Status:** done

- [x] task_focus({ task_id: string | null, reason: string }); the once-per-Turn refusal is gone
- [x] Workerd test: focus A, then focus B with a reason: A's Attempt is skipped with the reason, B's is running, the registry row shows B (ao-lj6z, ao-cvpx)
- [x] Workerd test: focus A, then none: A's Attempt skipped, the row shows no Task (ao-lj6z)
- [x] Workerd test: the dropped Task's next scheduled Wake-up starts a fresh Attempt (ao-n2fo)
- [x] Component test: a Mission Control row updates its Task cell on the registry change (ao-cvpx)

**Closing note:** The tool takes `task_id: "none"` for no Task instead of null: DSH's code-mode SDK cannot type a string-or-null parameter. Focusing the Task the Turn already works on changes nothing. The Fleet row follows the registry at its next refresh (Mission Control polls every 10 seconds), and the Robot reports the change at once.
