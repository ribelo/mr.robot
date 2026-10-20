# 02: The safety net

**What to build:** A Turn the owner caused (an owner message on any Channel, an Ask answer, a Takeover the owner returned) that ends without a say gets one bounded platform step telling the Robot to speak or end; if it still says nothing, the last assistant text becomes a reply marked as a fallback in the Trajectory (gb-xgd7, gb-7jqy). Turns caused by Tasks, Robot messages, Subagent reports and platform notices get the step and never the fallback (gb-3gp2). An owner Turn that runs ten minutes without a say gets one platform steer, once per Turn (gb-0skq). Mr. Robot's messages to his staff are not owner causes.

**Blocked by:** 01

**Status:** done

- [x] Workerd test: an owner Turn without say gets the step; a scripted say in the step ends it without a fallback; no say yields a fallback reply flagged in the item and the Trajectory; a Turn with no assistant text sends nothing (gb-xgd7, gb-7jqy)
- [x] Workerd test: a Task Turn without say gets the step and no fallback (gb-3gp2)
- [x] Workerd test: the ten-minute alarm injects one steer and not a second one in the same Turn; a say before the alarm cancels it (gb-0skq)
- [x] The Trajectory shows the fallback marker; the Conversation shows the reply as any other
