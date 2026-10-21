# 01: One mode: code mode everywhere, direct mode removed

**What to build:** The codeMode flag, the direct composition, its settings and deputy fields and its tests go; setup runs in code mode; tests rewritten (td-2z82).

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Workerd test: the settings refuse codeMode; a setup Robot runs a program
- [x] Every former direct-mode test runs in code mode

## Closing note

Tests: apps/worker/test/code-mode.test.ts has two new cases. A PATCH of the settings with codeMode (true or false) answers 400, the panel has no codeMode, and the model is offered run_code alone. A Robot in setup runs a program that writes and reads SOUL.md. Every worker test now runs in code mode. The tests that ran each case twice (snapshot, memory sweep, dreaming, chief dream, idle, warming and closing, people pages, memory search) run it once. So the suite has 1,140 tests, not 1,166.

Decisions:
- Removed: codeMode in RobotSettings, SettingsPatch, DeputySettingsPatch, RobotConfig, the settings notice, the Advanced settings checkbox, the field of robot_settings_set and the words "code mode" in robot_settings. The composition always mounts the program runtime and presents every agent (the Robot, a Subagent, a Robot in setup) as ptc. A stored config that still holds codeMode keeps it and nothing reads it; there is no migration.
- The settings route decodes its body strictly: a key the schema does not name answers 400, so codeMode is refused rather than ignored. This also found a test that sent subagentModels inside grants (platform-skills.test.ts). The deputy's patch was already strict.
- Four things worked only with direct calls. Code mode is now the only mode, so they now work in a program too:
  - The external fence. A program gets an external tool's value, not its fenced text, and can return any part of it. The text result of a program that called an external tool is now fenced whole, with the source naming those tools (compose.ts, a tools/post-execute listener). The inner calls are not fenced separately.
  - The Code view. POST /conversation/calls also returns the calls a program made, each with `program` (the program's call id; ToolCallDetail gains this optional field). The PWA renders them inside the program's card through the same renderers. When none has a renderer, the plain program card stays.
  - Task cards. A Task created in a program now has its id on the card: the chat fold keeps the id and title of an inner call's result.
  - The Fleet's running tool. It names the inner call that started and has not settled (tool/ptc-dispatch-start), not "code".
- Kept as it was: a program that only said or reacted shows a "code" activity in the chat. Earlier tests already pinned this (robot-turn, the 0.2.0-rc.2 log fixture). Tests that read the last chat item as the reply now skip that activity.
- Test support:
  - The scripted model turns each scripted call into its own run_code program in the same step. Each call still has its own result, and a failed call fails only its program. A call marked `native: true` is sent as a native call, for a log from before v1.22 (places.test.ts, the removed box_ and host_ tools).
  - boundTools and boundToolNames (api.ts, from the Robot's registered tools) replace reading request.tools, which now holds run_code alone.
  - declaredTools(request) reads the names of the SDK block, for a Subagent's request.
