# 03: Remove zustand, immer, TanStack; guard the tree

**Parent:** mr-robot-v1.4 (../mr-robot-v1.4.md) — stories fe-mza0, fe-iqay

**What to build:** zustand, immer and every @tanstack package are gone from package.json and the lockfile; the dependency lint fails if any returns.

**Blocked by:** 02 Trajectory, conversation grouping and tool cards on Atom; own virtualiser

**Status:** ready-for-agent

- [ ] pnpm why zustand / immer / @tanstack/* returns nothing for the web app
- [ ] Dependency lint has the rule and passes
- [ ] Build and all suites green; deployed
