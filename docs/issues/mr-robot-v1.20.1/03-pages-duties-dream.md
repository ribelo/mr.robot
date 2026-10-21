# 03: Shared Pages follow their owner; duties never re-arm in the past; dream pricing and Space default

**What to build:** Decisions 5 and 6. Findings: cross#3 and the paused/setup PDF finding; the 03:00 alarm storm; the dream-hour close ignoring defaultDreaming; the dream priced at the Robot's model.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Workerd test: a removed Member's share answers 404; a paused Robot's page serves and its PDF answers 503
- [x] Workerd test: a busy Robot at the dream hour re-arms at now + heartbeat, never earlier; the dream-hour close follows the Space default; the dream's usage row carries the dream model's price

## Closing note

All cited findings confirmed in the code:
- cross #3: removing a Member left their shared_page rows, and /p checked neither the Member nor the Robot;
- cross #12: pagePdf asked only checkLimits, which passes a paused or setup Robot;
- the 03:00 storm: a refused duty's nextAt stayed in the past, so the alarm re-armed at once until the Robot was idle;
- the dream-hour close read only the Robot's own dreaming flag;
- accountTurn priced every Turn at the Robot's model.

apps/worker/test/shares-duties.test.ts:
- a paused Robot's shared Page serves and its PDF answers 503, and after its Member is removed both answer 404;
- a busy Robot at the dream hour re-arms its alarm more than ten seconds ahead;
- with the Space default off, the dream-hour close does nothing on a Robot without its own setting;
- the dream on a priced dream model books a cost under memory, where the Robot's model would have booked none.

Decisions:
- A removed Member's shares are deleted (Member.stopAllSharing, called by the Space's remove). /p also asks the Space whether the Member is active, so a share of a Member removed before this fix answers 404 too. The ticket's 404 for a removed Member and its "page serves, PDF 503" for a paused or setup Robot are both in place. A deleted Robot already answered 404.
- Duties: Duties.nextAt clamps a moment at or before now to now + DUTY_RETRY_MS (30 s, the heartbeat). A duty that refuses (busy) keeps its due moment and is tried again then. This is the one place for it, so it holds for every duty.
- The dream-hour close takes dreamingOn: the Robot's setting, else the Space's defaultDreaming, as the dream does. The duty's nextAt still reads only the Robot's flag, so with the Space default off the duty wakes once a night and does nothing.
- Pricing: accountTurn prices at the Turn's route (the dream's own when it has one). Usage rows have no model column; the cost is what carries the price.
