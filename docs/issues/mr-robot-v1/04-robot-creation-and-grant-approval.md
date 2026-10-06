# 04: Robot creation interview, grant approval, Mr. Robot bootstrap

**Parent:** mr-robot-v1 (../mr-robot-v1.md) — stories robot-mn09, robot-1xbe, robot-btct, robot-cobv, robot-hpj1, robot-bld3, robot-qo06, robot-70kf

**What to build:** The application starts with no robots. On first sign-in the Member gets Mr. Robot. Tapping New robot opens a conversation in which the robot interviews the Member, drafts its own identity, and ends with one summary listing the grants it asks for; approving it activates the robot and it appears in the list. Robots are private by default and can be shared with the Home; the owner can pause, resume and delete a robot. Mr. Robot holds recipient grants to every robot the Member can reach (kept in sync on create and share).

**Blocked by:** 03 A Robot Durable Object runs one turn

**Status:** in-progress

- [x] New robot creates a Robot DO in setup state and opens its conversation with the kickoff turn
- [x] Setup may only ask questions and propose; approval is a compare-and-swap on the proposal revision
- [x] Only grants are approved; persona drafts are not shown for approval
- [x] Shared robot appears for the other Member; private does not
- [x] Pause stops wake-ups, resume restores them, delete keeps the archive
- [x] Mr. Robot recipient grants update when a robot is created or shared

Reopened 2026-10-07 by the story verification (verification.md): stories 5, 12 (not tried live in a one-person Home), 14 (robot_create not tried live).
