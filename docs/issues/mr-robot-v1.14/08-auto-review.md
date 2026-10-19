# 08: Auto review plugin and settings

**What to build:** A Robot's advanced settings get an Auto review switch, off by default, and the reviewer's provider, model and thinking effort with a Home default (ao-c8k9, ao-6m9i). When on, a pre-execute listener in the Robot's composition reviews every call of an item at level allow before it runs, with the same five-section prompt and strict { risk, decision, reason? } contract as DSH's experimental package; items at ask keep asking (ao-wkpt). A denied call becomes a tool-call Ask to the owner carrying the reviewer's reason; a malformed or failed review fails the call with its error and never runs it (ao-gf33). Subagents are reviewed with their Robot's setting (ao-6boj). Reviewer calls land on the Robot's usage with source review (ao-hfni). The Trajectory shows which calls were reviewed and the decision (ao-jn6z). Mr. Robot's deputy settings tool edits the fields.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] Robot settings autoReview: boolean and reviewer: { provider, model, effort } | null; Home default; advanced settings and deputy tool edit them (ao-c8k9, ao-6m9i)
- [ ] Workerd test with a scripted reviewer: allow runs the call; deny creates a tool-call Ask with the reason; an approved Ask runs it; malformed reviewer output fails the call; an ask-level item is not reviewed (ao-wkpt, ao-gf33)
- [ ] Workerd test: with ticket 06 present, a child's call is reviewed with the parent's setting (ao-6boj)
- [ ] Workerd test: reviewer usage on the Robot's rows with source review (ao-hfni)
- [ ] Tool events carry a review field; the Trajectory renders the decision (ao-jn6z)
- [ ] Component test: the switch and route controls in advanced settings (ao-c8k9)
