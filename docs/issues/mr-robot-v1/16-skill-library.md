# 16: Home skill library and per-robot skill grants

**Parent:** mr-robot-v1 (../mr-robot-v1.md) — stories robot-7qpi, robot-qjvu, robot-lszy, robot-jqfw, robot-icrv

**What to build:** The Home has one skill library in R2, synchronised from the admin's skills Git repository. A robot can write a skill and propose it; a Member approves it into the library. Skills are granted per robot; only granted skills appear in the robot's catalog.

**Blocked by:** 07 Code mode executor, tool grants, advanced settings

**Status:** done

- [x] Sync pulls the configured repository and lists its skills
- [x] Robot proposal shows as a question; approval publishes the skill
- [x] Ungranted skill is absent from the robot's skill catalog
- [x] Private skill is visible only to its author's owner
