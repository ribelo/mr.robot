# 09: Cache warming and idle compaction

**What to build:** Two Robot settings, cacheWarming and idleCompaction, plus idleCompactionFloorTokens (default 20 000). Nothing acts inside a Turn or while anything is queued; when a Turn ends with an empty queue the Robot sets an alarm for the first idle moment, and any Wake-up clears the plan (ao-8hi8). Warming refreshes the provider cache with a minimal request at 54, 108 and 162 minutes of idle on a one-hour cache; on by default for Mr. Robot (ao-jlr0). Idle compaction compacts once at 54 minutes on the warm prefix if the live context is above the floor; on by default for other Robots (ao-f4sp, ao-z22f). Right before it, the Robot gets one bounded platform step telling it compaction is coming so it writes what matters to memory, without replying to the owner (ao-7bq9). Moments depend on the Provider's cache window; providers without a known window get no warming and compaction at 54 minutes (ao-c3er). Mr. Robot's deputy settings tool edits the switches and the floor (ao-5zin).

**Blocked by:** 01

**Status:** done

- [x] Settings and defaults at creation: Mr. Robot warming on / compaction off; other Robots the reverse (ao-jlr0, ao-f4sp)
- [x] Workerd test: a Turn ending with an empty queue sets the idle alarm; a Wake-up before it clears the plan and no warming or compaction happens (ao-8hi8)
- [x] Workerd test with the scripted model: warming requests at 54, 108, 162 minutes replay the cached prefix (ao-jlr0)
- [x] Workerd test: idle compaction at 54 minutes runs the memory step first, then compacts, and the next Turn starts from the summary with a fresh memory baseline (ao-f4sp, ao-7bq9)
- [x] Workerd test: a context below the floor is not compacted (ao-z22f)
- [x] Workerd test: a Provider without a cache window gets no warming request (ao-c3er)
- [x] Deputy settings tool and advanced settings edit both switches and the floor (ao-5zin)

**Closing note:** The moments count from the end of the Turn (the owner's desktop warmer counts from the last model request; the two differ by the length of the last step). Only Claude (provider `anthropic`) has a known window (one hour). The replay is the last ordinary request of the Robot's session, kept in the Robot's storage when the idle plan is made, sent with one output token; the Anthropic adapter honours that limit for a `cache-warm` request. A model with a fixed thinking budget is not warmed (its budget must be below max_tokens). When both switches are on, the idle compaction at 54 minutes replaces the warming. A warming more than five minutes late is skipped. The memory step is limited to four steps; a Wake-up during it cancels the compaction. Warming and the memory step are billed as the Robot's model cost.
