# 05: Marketplace and definitions

**What to build:** Decisions 10, 11, 12 and 13. Findings: v1.18#1, #2, the malformed-form deletion, the scrub ordering and confinement, presigned writes bypassing history, the trim on write only, the unbounded Grok fetch.

**Blocked by:** 01

**Status:** done

- [x] Workerd test: Add returns a RobotSummary and a repeated Add does not create a second Robot; the admin sees unpublished definitions of a Member; a malformed repository form keeps the last good definition and shows the error
- [x] Workerd test: the scrub runs after tasks.yaml and README exist, writes only under the staged prefix, and publishing without a completed scrub is refused
- [x] Workerd test: presign refused for a tracked path; the trim runs in the tidy pass
- [x] Workerd test: the Grok fetch refuses another host, a body over 5 MB and a slow server

## Closing note

Confirmed in the code:
- v1.18-review #1: Add returned a RegistryEntry, which the PWA could not decode as a RobotSummary.
- #2: the Hosts select still had value "home" (fixed in passing, one line).
- #3: the admin did not see a Member's unpublished definitions.
- #4: a broken repository form deleted the last good copy.
- #7: the scrub could write anywhere on the Workspace.
- #10: presigned PUTs bypassed the file history.
- #13: history was trimmed only on write.
- #15: tasks.yaml and the README were written after the scrub.
- #17: the Grok fetch was unbounded.
- v1.20-review #2: a code-mode scrub published unscrubbed copies.

apps/worker/test/definitions-fixes.test.ts (in code mode) covers:
- Add answers a RobotSummary, and a second Add returns the same Robot.
- The admin sees Ben's unpublished definition.
- A broken grants.yaml keeps the last good Helper, marked invalid with the error, and the next good sync clears the mark.
- The scrub reads the staged tasks.yaml with the owner's name in it, is refused a write to MEMORY.md, and rewrites tasks.yaml under its draft; the saved tasks.yaml has no owner name.
- A scrub cut at its step limit saves nothing and leaves no draft.
- A version older than 90 days goes in the daily tidy.
- The Grok fetch: a 6 MB page is refused, a redirect is refused, another host is refused before any fetch, and a hanging server is given up after 15 s.

files-without-limit.test.ts: ws put is refused for MEMORY.md, SOUL.md and a daily note. Existing tests that expected the admin not to see Ben's definitions now expect the admin to see them unpublished.

Decisions:
- Add: the edge answers the Robot from the Member's Robot list. The Space keeps definition_add (member, slug, robot), and an Add while that Robot is still in setup returns it.
- The admin's Marketplace and /api/definitions list every definition, with published false for the unpublished ones. The Marketplace shows "the repository's version is refused" with the error on an invalid one. A repository sync keeps the admin's published flag of a Git row (v1.18-review #19 for Git rows; a re-imported Grok brief still unpublishes, accepted).
- The scrub: tasks.yaml and a README from the identity are staged in the draft before it; grants.yaml (kinds and sites only) is the platform's, written after. Its fence allows the file tools on the Workspace, and write and edit only under the draft. Publishing requires a step that ran and that the model ended; otherwise the draft is removed and the call answers 409. Every file is masked (ticket 02).
- Presigned writes: Transfers refuses a writable key in the tracked set (persona, memory, daily notes, dreams). The Member files were already refused.
- History trim: FileHistory.trimAll removes every version older than 90 days under the Robot's base, in the daily tidy (tidySpill). The Member's and the Space's history are still trimmed only on write; accepted, since they are written rarely and small.
- The Grok fetch moved to the edge (fetchGrokPage): x.ai only through the address check, redirect manual and refused, 5 MB read cap (content-length and streamed), 15 s timeout. The Space DO gets the URL, slug and text only.
- Accepted, with why:
  - #5, #6: persona-fold edge cases on a fold that failed halfway; it runs once per Robot and has.
  - #8: sweep writes outside the tracked set are visible in the Trajectory's tool calls.
  - #11, #12: concurrent writes and restores: Robot writes happen inside a Turn, and the owner's restore is a new version.
  - #14: Reset leaving Member history; the history API is the owner's own.
  - #16, #31: no size caps on download and YAML; the library is the admin's repository.
  - #18: the Grok slug truncation for 61-character slugs.
  - #20: sync rewrites every definition, so dates are of the last sync.
  - #21: a failed pause after create is logged by the Space.
  - #22: logins shared by the Space are not counted as met.
  - #23: the remaining wire alias for mission.wholeHome.
  - #24: the plan test for renamed_classes, which is ticket 06.
  - #25 to #28: prompt and test wording.
  - #29, #30: the one-time Space move, done on the deployment.
  - #32: four R2 operations per tracked write.
  - #33: a definition without forms.
