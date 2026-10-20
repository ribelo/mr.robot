# 08: Connection instructions

**What to build:** A Connection carries custom instructions the owner writes in its settings (gb-wzl9). A Robot granted the Connection reads them in its prompt's runtime section, named by Connection (gb-j887). Mr. Robot's deputy connection tools read and set them (gb-q55x).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Workerd test: instructions saved on a Connection appear in the prompt of a Robot holding it at allow or ask and not in the prompt of a Robot without it (gb-wzl9, gb-j887)
- [ ] Workerd test: the deputy tool sets and reads the instructions (gb-q55x)
- [ ] Component test: the instructions field in the Connection's settings (gb-wzl9)
