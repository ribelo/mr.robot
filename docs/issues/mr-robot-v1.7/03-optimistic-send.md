# 03: Optimistic send with retry

**Parent:** mr-robot-v1.7 (../mr-robot-v1.7.md) — stories ap-3si6, ap-ceqx, ap-7b3p

**What to build:** On Enter the message appears at once in the chat as pending and the composer clears. When the server conversation contains it, the pending item is replaced. A refused send stays marked 'not sent' with the error and a Retry button that resends with the same client id, which the Worker deduplicates.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] The send API accepts a client id and deduplicates on it (workerd test)
- [x] Component tests: pending item appears immediately, replaced on confirmation, failure shows Retry and resends once
- [x] Pending items show a clock mark instead of a time
