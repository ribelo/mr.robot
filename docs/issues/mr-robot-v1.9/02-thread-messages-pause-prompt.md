# 02: Thread messages, the 20-message pause and the prompt rule

**Parent:** mr-robot-v1.9 (../mr-robot-v1.9.md) — stories ch-jnet, ch-6ymu, ch-iy16, ch-408z, ch-k2tp, ch-v1p8

**What to build:** In an open Thread, thread_send delivers a message through the Robot message outbox (kind thread) and wakes the other chief with the topic, that chief's own scope and the message. Both Conversations show labelled messages ('Anna's Mr. Robot') and a Thread card with state and count. The 21st message is refused until the owner approves a 'continue' Ask; usage counts as any Turn. Mr. Robot's platform prompt carries the Thread scope rule.

**Blocked by:** 01 Thread object and symmetrical invitations

**Status:** ready-for-agent

- [ ] Messages both ways in a workerd test; Wake-up carries topic and scope; chain limit not applied inside a Thread
- [ ] 21st message refused; continue Ask approval resets the counter
- [ ] Prompt test for the rule; Thread card component test
