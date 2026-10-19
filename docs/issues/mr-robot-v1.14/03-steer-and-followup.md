# 03: Steer and follow-up delivery

**What to build:** A Wake-up carries a delivery decided from its sender: the owner (through the app or any Channel that identifies him) and the owner's Mr. Robot acting as deputy steer; Tasks, webhooks, other Robots, Threads and platform notices follow up (ao-9570, ao-ti08, ao-rsfo, ao-8848, ao-m648). A steer reaches a running Turn at its next step through agent.steer(); when no Turn runs, both kinds start a Turn. Ctrl+Enter in the composer forces a follow-up (ao-q2z4). Follow-ups from one sender queued together join into one Turn with a separator the prompt explains; a Task Wake-up never joins (ao-rdhs). A steer that arrives during a pending Takeover or an awaited Subagent report is delivered when the Turn resumes (ao-zk5r). The Conversation and the Trajectory show the steer at the point where the Robot consumed it, with no label about which reply answers it (ao-lfxt). The platform prompt tells the Robot a steer may change what it is doing and that it says so in its own words (ao-03p5).

**Blocked by:** 01

**Status:** done

- [x] Wake-up row has delivery: steer | followup; the drain hands a steer to the running agent at once and starts Turns for the rest as today
- [x] Workerd test: an owner message during a scripted Task Turn is consumed at the next step; a webhook during the same Turn waits for its own Turn (ao-9570, ao-m648)
- [x] Workerd test: owner through a Discord event steers; a Robot message follows up; Mr. Robot's deputy message steers (ao-rsfo, ao-8848)
- [x] Workerd test: three queued owner follow-ups become one Turn; a Task Wake-up queued among them keeps its own Turn (ao-rdhs)
- [x] Workerd test: a steer during a pending Takeover is delivered on resume (ao-zk5r)
- [x] Workerd test: the projection places the steer at its consumed sequence (ao-lfxt)
- [x] Component test: Ctrl+Enter sends with the follow-up flag, Enter without (ao-q2z4)
- [x] Platform prompt has the steering section; prompt preview shows it (ao-03p5)

**Closing note:** The decision lives in apps/worker/src/robot/delivery.ts. The owner on Discord is the Discord user of the owner's own "Discord as you" connection; a webhook never steers. A steer leaves the queue when it is handed to the running agent (the DSH inbox keeps it durably), so a restart does not replay it as a Turn; an Interrupt keeps the inbox, so an unread steer reaches the next Turn. A reply to a Turn that a Channel steer reached goes back to that Channel. Steers queued during a Takeover reach the hand-back Turn: the hand-back Wake-up starts first, and the steers are read at its next step. Follow-ups from one sender are joined in one model message; the Conversation shows them as the messages they were (each with its client id). wakeup-order.test.ts (one Turn per message) is replaced by steering.test.ts.
