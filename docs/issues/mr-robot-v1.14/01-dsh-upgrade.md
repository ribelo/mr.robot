# 01: DSH 0.2.1-rc.2 upgrade

**What to build:** The Worker and the PWA build on DSH 0.2.1-rc.2 (ao-ejub, ao-ggzv, ao-wzw9). Every @deepseek-ai/dsh-* dependency moves together; the spill, spill-policy, tool-subagent (in-process spawn and fork), subagent-control packages become available to later tickets but are not yet mounted. A person opens an existing Robot after the deploy and its Conversation and Trajectory render and continue.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] All DSH packages at 0.2.1-rc.2; pnpm test green in workerd and the PWA
- [x] Dependency lint passes: no Node-bound DSH package, no Effect inside DSH packages in the Worker bundle (ao-ggzv)
- [x] Workerd test: a session log written by the previous version renders and a new Turn appends to it (ao-wzw9)
- [x] Breaking API changes between 0.2.0-rc.2 and 0.2.1-rc.2 listed in the ticket's closing note

## Closing note

- **Versions:** every `@deepseek-ai/dsh-*` dependency of the Worker and the PWA is at 0.2.1-rc.2. The new DSH needs cordis 4.0.5, cosmokit 1.8.6 and schemastery 3.18.5; these moved too.
- **Available, not mounted:** dsh-spill, dsh-spill-policy, dsh-subagent, dsh-subagent-spawn-in-process, dsh-subagent-fork-in-process, dsh-tool-subagent and dsh-tool-subagent-control (send_message, interrupt_agent, list_agents) are direct Worker dependencies. Nothing imports them yet.
- **dsh-llm patch:** still needed. 0.2.1-rc.2 still reads its version from package.json with `createRequire`, which fails in workerd. The patch moved to patches/@deepseek-ai__dsh-llm@0.2.1-rc.2.patch.
- **Breaking API changes, 0.2.0-rc.2 → 0.2.1-rc.2:**
  1. New required service `workingDirectory` (new package dsh-working-directory). dsh-tool-fs and dsh-tool-skill inject it and do not load without it. `run_code` fails without it. Mr. Robot mounts its own `RobotWorkingDirectory` (apps/worker/src/agent/seams.ts) at the composition root. It always answers /workspace and refuses a change. DSH's own service is not used: it writes a working-directory event into every session log and adds a line to every prompt.
  2. dsh-tools: `ToolPresentationMode` lost `'both'`. `createRunCodeTool` takes `ctx` as a third argument. `renderToolsSdk` has an optional program format.
  3. dsh-tool-fs: `sessionCwd` was removed. `sessionResolveOptions(ctx, exec)` is now async.
  4. Additive only: dsh-llm `LlmCallControls` and `ConfigureCall`; dsh-session plugin records (`appendPluginRecord`, `pluginRecordOf`). Several packages no longer peer on dsh-invariants.
  5. The agent inbox API (`steer`, `followup`, `inject`, `send`, `inbox`) did not change.
- **Session logs:** the session header stays version 4. apps/worker/test/session-log-upgrade.test.ts stores a log captured from a real Turn on the 0.2.0-rc.2 build. That log renders the same Conversation and Trajectory, and a new Turn appends to it with the old Turn as history.
- **For implementers:** ../notes/dsh-0.2.1-upgrade.md (outside the repository, in the worktree notes) has the details. It lists the inbox signatures, which new packages import Node modules (dsh-subagent uses node:fs), and the NODE_BOUND entries ticket 06 must remove from the dependency lint.
