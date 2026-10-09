# 02: Deputy reads: Mr. Robot sees every reachable Robot

**Parent:** mr-robot-v1.6 (../mr-robot-v1.6.md) — stories cd-ibix, cd-gjhb, cd-jltk, cd-9te1, cd-r9g5, cd-jc8f, cd-0rqn, cd-ojeh, cd-2u0h

**What to build:** A new tool group deputy, mounted only for a Robot of kind mr-robot, lets Mr. Robot list the Robots his owner reaches and read one Robot's Conversation (paged, searchable), a byte-capped Trajectory excerpt around an item, Workspace files, Grants and open proposals, Routines with runs, and settings. Every call checks the owner reaches the target and refuses Mr. Robot himself.

**Blocked by:** 01 Conversation search

**Status:** done

- [x] robot_list, robot_conversation, robot_trajectory, robot_files, robot_file_read, robot_grants, robot_routines, robot_settings exist for Mr. Robot and are absent for an ordinary Robot
- [x] Reads reuse the Robot DO methods the PWA uses; the data matches the PWA view in a workerd test with an owner, Mr. Robot and two Robots
- [x] A Robot the owner cannot reach is refused with a clear message; robot_trajectory output is capped (state the cap in the description)
