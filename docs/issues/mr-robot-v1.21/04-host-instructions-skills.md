# 04: Instructions and skills from the Host

**What to build:** WorkspaceOpen, WorkspaceState, SkillLoad, WorkspaceClose; the chain computed with DSH's file logic and the app's carrier, confined to the repository, delivered as its own platform message with its budget, refreshed on cd and on deeper touches, digests; the skill catalog merged with the code's precedence; the shared-Host note (cw-ec6f, cw-o2qo, cw-hm3d, cw-jc3f, cw-s2rt, cw-zwhg, cw-rkud).

**Blocked by:** 02, 03

**Status:** done

- [x] Workerd test from a stub tree: chain, overlays, duplicates, budget, own message, refresh on cd and on a deeper edit, changed and removed files, symlinks skipped; the merged catalog and a loaded Host skill; digests
- [x] Host Node tests: the walk and the symlink rule
- [ ] By hand: the owner's real tree on NixOS (see below)

## Closing note

Tests:
- apps/host/test/workspace-context.test.ts runs DSH's real loader and skill provider over a temporary home and repository, through the Host protocol:
  - The global files come first, then the root, its .local overlay and the current directory, broad to specific. A CLAUDE.md that repeats AGENTS.md renders once. A CLAUDE.md linked to a file outside the repository is not read. Nothing below the current directory is in the baseline.
  - The budget holds, and the most specific rule survives it.
  - A read in app/lib adds app/lib/AGENTS.md as a nested file. Only that file's content is sent; the rest go as digests. A catalog the Worker already holds is not sent again.
  - Home and repository skills are listed with their scope, and a body loads.
- apps/worker/test/host-instructions.test.ts (workerd, fake Host):
  - The chain is its own hidden platform message, after the Wake-up and the memory message, never in the system prompt.
  - A cd gives a new baseline without the linked file. A deeper read adds "(new)".
  - A changed file comes with its new text; a removed one with a notice. A Turn with no change gets no message and asks WorkspaceState with digests only.
  - The budget holds.
  - The catalog has the Host home and repository skills. The platform skill `hosts` keeps its name and notes "(also: Desk repository skill of the same name, shadowed)". A Host skill loads through SkillLoad.
  - The fake app stands in for DSH's loader with the same order, overlay, duplicate and link rules. The real loader is the app's test above.

Decisions:
- No DSH Agent on the Host. The chain is `loadBaselineInstructions` from @deepseek-ai/dsh-agent-instructions (DSH's discovery, overlays, duplicate collapse and broad-to-specific budget, 65,536 bytes). It runs over a file system of the app's own with the three methods the loader calls (resolve, stat, streamText). A candidate whose real path is outside the repository is "not there". The two global files ($DSH_HOME or ~/.dsh, and $DSH_AGENTS_HOME or ~/.agents, AGENTS.md) are the OS user's and are allowed. Only DSH's candidate names are read (cw-jc3f).
- Touches: the Workspace session records the directory of every Read and Write in the repository that carries the Workspace. The instruction files between the current directory and a touched directory are the nested files, appended after the baseline as DSH appends them. The Worker asks again after a read, write or edit on "workspace" (Places marks the agent's session) and at the first step of every agent run.
- Delivery (Worker): plugins/workspace-instructions.ts, a pre-step hook like the memory plugin. Its message source is `workspaceInstructions: 'baseline' | 'changes'`, hidden. A session with no chain, or one that changed directory, gets WorkspaceOpen and the whole chain under one heading that names the Host, repository and directory. Otherwise it gets WorkspaceState with the digests it holds. A new or changed file is sent with its content, a removed one with a notice, and nothing is sent when the digest is the same. A new chapter is a new session, so it gets the whole chain at its first step. The live session's state is kv `workspace-chain`; Subagents' states are in memory.
- Digests: one per file (sha1 of the text) and one for the chain. The Host omits the content of every file whose digest the Worker sent, and the skill catalog when its digest matches (cw-rkud). The rendered baseline is sent only on WorkspaceOpen.
- Skills: the app composes DSH's skill registry with @deepseek-ai/dsh-skill-filesystem (watch off; the Worker asks at its Turns). DSH's roots include .dsh/skills beside .agents/skills, as DSH reads them. A skill from a project-* root is "repository", every other one "home". In the Robot's catalog, the code's precedence stays (confirmed by the planning session): platform -1, then the Space library and Host home skills 0, then local and Host repository skills 1. Lower wins, so a cloned repository cannot shadow a platform skill. The winner of a shared name notes "also: <source> skill of the same name, shadowed". The Host skills come with the Workspace (the files facet of its Host), not with the skills group. The spec's story text was fixed to the code's order in this commit.
- Protocol: WorkspaceOpen, WorkspaceState and SkillLoad (protocol 2). A Host that is offline or older adds nothing to the context; the Robot works without it (requiresHosts is unchanged).
- docs/hosts.md says that a shared Host's OS user's global AGENTS.md and home skills reach every Robot with a Workspace there (cw-zwhg). The doc is at 899 words; ticket 11 rewrites the docs.
- The Host's pnpm dependencies changed (dsh-subprocess in ticket 01; dsh-agent-instructions, dsh-skill-filesystem and dsh-home-paths here). apps/host/package.nix has the new pnpmDeps hash, and `nix-build apps/host/package.nix` builds.

By hand (the owner, on NixOS, with this repository as a Workspace): start the app built from this commit (`nix-build apps/host/package.nix`), give a Robot the files facet and the Workspace ~/projects/ribelo/mr.robot, and send it "what instructions do you have?". Its Trajectory should show one hidden "Workspace instructions" message with ~/.agents/AGENTS.md first, then this repository's AGENTS.md chain. After `working_directory` with cd apps/host, the next step should show the deeper chain. The catalog should list the skills of ~/.agents/skills.

Review findings: #1 confirmed and avoided (no DSH Agent; the pure exported loader and the provider are used). #2 confirmed: the homes are the app process's, so on a service Host they are the service user's (docs, cw-zwhg). #3 confirmed: refresh is touch-driven, with the app's own touches. #4 confirmed: the project root is the stored repository root, and nothing above it is read except the two global files. #5 confirmed and fixed by the confined file system. #6, #7: the chain has its own budget and its own message. #34: the code's order kept, the spec text fixed. #70: a Turn's start is one WorkspaceState with digests. #72: said in the docs.

Found here: plugins/memory.ts keyed its baseline by `String(agent.session)`, which is "[object Object]" for a DSH Session, not the session id. So the Robot's "memory-baseline" mark was the same for every session, and a Subagent's session (whose id starts "sa-") was never told apart. Fixed at the planning session's word in its own commit right after this ticket ("Memory baseline keyed by the session id, not the Session object (v1.21 side fix)"):
- plugins/memory.ts now uses `agent.session.id`, as the Workspace instructions do.
- A chapter roll hands the Workspace chain's state to the new session, as it hands over the memory mark: the seed carries both. A compaction clears both.
- apps/worker/test/chapters.test.ts checks that a seeded chapter gets no second baseline, and that a Subagent gets its own baseline without a second one for the Robot. It fails on the old keying.
- The tests' wakeOf helper (stub-llm.ts) now skips the memory and Workspace baselines after a Wake-up, since a Rewind's new chapter now correctly gets a fresh memory baseline there. Three Rewind tests read the label through it.
