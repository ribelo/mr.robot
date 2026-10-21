# 02: Warming, then closing

**What to build:** Warm at 54, 108, 162, then sweep and compaction at 216; a Wake-up cancels; the dream-hour close; Mr. Robot's idleCompaction default removed (dm-2ilu, dm-76yv, dm-zyxz).

**Blocked by:** 01

**Status:** done

- [x] Workerd test: the schedule, the cancel, the dream-hour close, Mr. Robot included

## Closing note

apps/worker/test/warming-closing.test.ts: Mr. Robot on a one-hour cache plans warm at 54, 108, 162 and compact at 216; a message before resets the plan; three warmings, then the snapshot and the compaction close the chapter. The dream hour is the next 03:00 in the Robot's zone; then an open chapter closes (snapshot, compaction) whatever its size, and a chapter with nothing since is left alone. idle.test.ts now expects the close after the warmings and a compaction at 54 for a Provider without a cache window.

Decisions:
- idlePlan: a warming Robot gets three warmings and then the compaction, whatever its idleCompaction flag (the warming implies the close); a Robot that does not warm compacts at 54 when idleCompaction is on. idleCompaction now defaults to on for every Robot, Mr. Robot included, and a new Mr. Robot is created with it on; a stored off stays off for a Robot that does not warm. The floor still applies to idle compactions.
- The dream-hour close is a duty of the Idle plugin (order 95, active Robots): the next 03:00 in the Robot's time zone (which follows the owner's profile) is kept in kv dream-close-at; when it comes and the Robot is idle, a live chapter with events after its seed runs the idle sequence without the floor. A busy Robot skips that night.
- The dream hour belongs to dreaming: RobotConfig.dreaming (absent means on, ticket 05 adds the setting) gates it. Three alarm tests (deputy, task-scheduling, time-zone) switch dreaming off to read the Task moments alone.
