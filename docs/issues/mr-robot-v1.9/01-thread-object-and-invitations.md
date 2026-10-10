# 01: Thread object and symmetrical invitations

**Parent:** mr-robot-v1.9 (../mr-robot-v1.9.md) — stories ch-c2xa, ch-l4jg, ch-vrl7, ch-hikl, ch-fri7, ch-0cn1, ch-rqnf

**What to build:** Mr. Robot lists the other chiefs of the Home and opens a Thread on a topic with a proposed scope. Both owners see an invitation Ask with the topic and an editable scope field; the Thread opens only when both approve, both chiefs are woken with 'Thread opened'; a decline ends it and the other chief learns only that. Only Mr. Robots have the tools.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Thread registry in the Home; ProposalKind thread with a scope text the owner edits in the AskBar before approving
- [ ] thread_chiefs and thread_open exist for Mr. Robot only; workerd test with two Members and two chiefs covers open-after-both, decline, and that an ordinary Robot lacks the tools
- [ ] Component test: invitation Ask shows topic and scope field
