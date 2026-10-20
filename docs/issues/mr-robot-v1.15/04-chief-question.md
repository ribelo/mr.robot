# 04: The chief question and the end of need_help

**What to build:** Every Robot is created with a recipient Grant to its owner's Mr. Robot, shown in its Grants and removable; existing Robots gain it at the upgrade (gb-qmnc). robot_send takes a question flag that labels the message [Question from <robot>] in the chief's Conversation (gb-l1x1). need_help, help_requests, help_answer, the help plugin and the 30-minute escalation are removed; open help Asks keep their answer path until closed (gb-c0ub). Mr. Robot's prompt gains the rule: answer only from what you hold, you may know but may not consent, ask your owner and forward what you cannot answer; a Robot's prompt names the two addressees (gb-2o04, gb-84zu; the final wording lands in ticket 13).

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Workerd test: a new Robot holds the chief recipient Grant; the migration gives it to an existing Robot; removing it makes robot_send to the chief refuse (gb-qmnc)
- [ ] Workerd test: the question flag labels the delivered message (gb-l1x1)
- [ ] Workerd test: need_help and the help tools are absent from every composition; an open help Ask from before still closes with an answer (gb-c0ub)
- [ ] The chief rule and the addressee rule are in the prompt sections role and how-you-work (gb-2o04, gb-84zu)
