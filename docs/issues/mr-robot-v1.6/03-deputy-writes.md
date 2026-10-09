# 03: Deputy writes: files, settings and identity of another Robot

**Parent:** mr-robot-v1.6 (../mr-robot-v1.6.md) — stories cd-30lq, cd-hpkr, cd-28og, cd-zm8u, cd-2zx9

**What to build:** Mr. Robot writes and deletes another Robot's Workspace and Persona files (that Robot gets a change note at its next step), patches its settings except grants, spend limit and sharing, and changes its whole identity through robot_configure. Each change appears in the target Robot's Conversation as a labelled system line naming Mr. Robot.

**Blocked by:** 02 Deputy reads

**Status:** done

- [x] robot_file_write and robot_file_delete land in the target Workspace and the target Robot receives the existing memory-changed note with Mr. Robot as actor
- [x] robot_settings_set accepts model, thinking, codeMode, contextBudget, compactionInstruction, discordChannel, discordProactive, browserBackend, notifications, wakeOnScreenNotifications and rejects grants, spendLimitUsd and sharing by schema
- [x] robot_configure sets name, title, description and avatarColor
- [x] The target Conversation shows a system line per change; workerd tests cover each write and the rejections
