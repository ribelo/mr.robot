# 06: Mission Control: Fleet and Tasks tables

**Parent:** mr-robot-v1.13 (../mr-robot-v1.13.md) — stories mc-m1aa, mc-m2bb, mc-m3cc, mc-m4dd, mc-m5ee, mc-m6ff, mc-m7gg, mc-m8hh, mc-m9ii, mc-n5ee

**What to build:** Route `#/mission` reached from the sidebar and the home page. `GET /api/mission` returns the Fleet (RobotSummary rows from the Home registry, working first, then waiting for you, then by last activity) and the Tasks (TaskView rows the Member may see; `scope=home` for the admin) in pages of 200 with filters (state, q) and grouping (assignee, parent, time). A `WindowedTable` component (fixed row height, visible window plus margin, no dependency) renders both tables, dense: one line per row, fixed columns, no cards. Fleet columns: avatar and name, state, woke by (kind and from), task, tool, since, last line; owner in Whole Home. Tasks columns: state, title (with parent breadcrumb), assignee, when (at / next / deadline), last attempt, children. Overdue marked. Grouping, state filter and Whole Home live in the Member's list preferences. One click on a Fleet row opens the Robot; Back returns to Mission Control through the `dsh` back counter fallback. One click on a Task row opens its detail sheet (fields, children, attempts) in place. The Whole Home switch shows only for the admin.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Route, sidebar and home entry; `GET /api/mission` with paging, filters, grouping; MissionView in the protocol
- [ ] WindowedTable; Fleet and Tasks tables; group headers; overdue mark
- [ ] Whole Home switch (admin only); preferences remembered
- [ ] Back from a Robot opened here returns here
- [ ] Component tests: window rendering, row contents, grouping and filters, admin switch, back; workerd test for paging and ordering
