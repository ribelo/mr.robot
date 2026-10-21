# 07: The Code view: setting and renderers

**What to build:** Work details per Robot with the Member default and the level Code; the Conversation at Code reads the page's tool events from the chapter log; one renderer set shared with the Trajectory (diff, fragment, command and output, lists, locations, copy); Code as the default for a Robot with a Workspace (cw-jy38, cw-sc3z, cw-1h3q).

**Blocked by:** 02

**Status:** done

- [x] Workerd test: the setting, the default, the page's tool events read from the log and bounded
- [x] Component tests: each renderer in the Conversation and in the Trajectory

## Closing note

Tests:
- apps/worker/test/code-view.test.ts:
  - The Fleet row has no Work details until the Robot gets its own, which it then shows. null returns it to the person's.
  - A Robot with a Workspace shows Code, and its own choice still wins.
  - POST /api/robots/:id/conversation/calls gives a 900-line write and its read in full, where the chat row holds a copy cut at 6,000 characters. It gives only the calls asked for.
  - More than 40 items is answered with truncated.
- apps/web/test/code-view.test.tsx:
  - Each of the nine renderers (edit, write, read, run, job_output, glob, grep, lsp, copy) in the Conversation at Code, from full calls replacing the clipped ones.
  - Another tool falls back to the plain card.
  - The same nine in the Trajectory's inspector, from the fixture session with its tool call rewritten each time.

Decisions:
- Protocol: WorkDetails gains 'code'. RobotSettings and SettingsPatch gain `workDetails` (null follows the default). RobotSummary gains `workDetails` only when it does not follow the person: the Robot's own choice, else 'code' when it has a Workspace (cw-1h3q). It is kept in the Space's robot table (column work_details). The PWA's level is `effectiveWorkDetails(robot, me.workDetails)`: the Robot's, else the person's, else Compact. The Robot's choice is kv `work-details` in the Robot DO. The person's setting on the profile page gains Code as well.
- The Code view reads the page's calls from the log, not the clipped chat rows. `useCodeCalls` sends the newest 40 activity items with calls on the loaded pages to POST /api/robots/:id/conversation/calls (`{ items: [{ id, calls }] }`), again when the page changes. The Robot finds each item's chapter and event (live SQL or the cold chapter in R2) and reads the events within 400 of it. It pairs tool/call with tool/result for the asked call ids, masks the secrets, and returns the arguments' JSON and the result text: at most 200,000 characters per text and 2,000,000 per request, with `truncated` when cut. The endpoint is open to whoever may read the Conversation.
- One renderer set, components/CodeRenderers.tsx (`codeCall`):
  - edit and write: a line diff (the `diff` package already in the PWA). A write is shown as a whole file of added lines, because its earlier content is not in the log.
  - read: the fragment, with the path, line endings and size of ticket 03.
  - run and job_output: the command, the output, the errors and the exit code or the job.
  - glob and grep: lists, with the cut flag.
  - lsp: locations and hover (cw-xxqw).
  - copy: from → to and the size and time.
  - Any other tool, or a call that cannot be read, gets no renderer and keeps the plain card.
  At Code the cards are open. The Trajectory's inspector shows the same renderer in its Summary tab for a tool or subtool record, above DSH's own panes, so DSH's code is changed in one place only.
- Robot settings get a "Work details" select under the model settings: the default ("Your default", or "Code" for a Robot with a Workspace) or one of the five levels.

Review findings: #31 confirmed and fixed (the clipped rows cannot render a diff: the Code view reads the log). #32: the page bound is 40 items and 2 MB. #42: Work details is per Robot with the person's value as the default. #43: the renderers are one set for the Conversation and the Trajectory.
