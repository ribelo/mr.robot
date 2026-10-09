# 06: Review Ask: approve a list of items

**Parent:** mr-robot-v1.6 (../mr-robot-v1.6.md) — stories cd-dt2x, cd-ueft, cd-7gwt

**What to build:** A Robot proposes a review: a titled list of items (id, title, body, optional action label). The owner sees it in place of the composer with per-item checkboxes, Approve all, Approve selected and Reject. The answer wakes the Robot with the approved and rejected ids; the Conversation shows the decided card with counts.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] ProposalKind review and tool propose_review exist; partial approval is one answer, not a new proposal
- [x] AskBar renders checkboxes and the three actions; the decided card shows counts (component test)
- [x] The wake-up carries { approved: string[], rejected: string[] } rendered for the model (workerd test)
