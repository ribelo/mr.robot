# 06: need_help: a Robot asks, the owner answers

**Parent:** mr-robot-v1.11 (../mr-robot-v1.11.md) — stories sk-kf74, sk-fcr1, sk-jpyv, sk-81hw, sk-9mvx

**What to build:** Every active Robot except Mr. Robot has need_help(doing, tried, need, urgent) without any Grant. The call stores an Ask of kind help, shown in the Robot's Conversation and panel with a text answer box; the Turn ends as waiting for help; the owner's answer wakes the Robot with a labelled reply and closes the request. robot_send to Mr. Robot still needs a recipient Grant.

**Blocked by:** 01 (labels and the language rule)

**Status:** done

- [x] need_help registered for every active ordinary Robot; absent for Mr. Robot
- [x] Help Ask card with answer box; the answer wakes the Robot with the label and closes the request
- [x] Workerd tests: request, owner answer, resume, no Grant needed, robot_send still gated
