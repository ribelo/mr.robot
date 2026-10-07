# 0002: Which DSH seams Mr. Robot plugs into, and where Effect stops

Status: accepted
Date: 2026-10-06
Spec: docs/issues/mr-robot-v1.md, "Assembled from DSH Cordis packages" and robot-naul

## Seams

Mr. Robot plugs its own Cordis adapters into these DSH seams:

| seam | adapter | file |
|---|---|---|
| session-persistence | Conversation log on DO SQLite | apps/worker/src/agent/session-log.ts |
| fs (+ DSH tool-fs) | the Robot's R2 Workspace, Member files read-only | apps/worker/src/workspace/r2-filesystem.ts |
| credentials | read-only over the Member and Home DOs | apps/worker/src/agent/seams.ts |
| browser-use | registers Browser Rendering as the provider | apps/worker/src/agent/seams.ts |
| ptc-runtime | Worker Loader isolate (ADR 0001) | apps/worker/src/agent/ptc.ts |
| web, skill, compaction, token meter, llm | DSH packages with Mr. Robot providers | apps/worker/src/agent |

**schedule is ported onto Durable Object alarms** (2026-10-07; the earlier decision not to use it was reversed at the owner's request). The Robot's composition provides `ctx.schedule` (apps/worker/src/agent/schedule.ts) and attaches DSH's own schedule_create / schedule_list / schedule_update / schedule_delete tools, so a Robot schedules exactly as the desktop harness does. Records, recurrence and reminder framing are DSH's; what DSH keeps in a Host storage domain and drives with timers is the Robot's routine table and its alarm. DSH's update rule is restated locally because the published package does not export it.

**Browser actions are Mr. Robot tools.** browser-use in DSH 0.2.0-rc.2 is only an exclusive provider
registration; the operations themselves live in experimental MCP packages for desktop Chrome. The
Leash-style primitives over Browser Rendering are browser_* tools; the registration is made so DSH
sees the provider.

**Search over Workspace files (glob, grep) and delete are Mr. Robot tools.** DSH's tool-fs-search
runs ripgrep, which a Worker cannot.

## Effect

Effect owns: the edge API (router, errors, request decoding), the Workspace (R2), the Vault,
OAuth, Web Push, skill sync, and the scope of every Cordis composition (closing the scope disposes
the agent and its plugins: `composeScoped` in apps/worker/src/agent/compose.ts).

The three Durable Objects run their work as Effect programs over services (platform/durable.ts; member/member.ts; home/home.ts; robot/programs.ts, views.ts, browsing.ts); each class declares its tables and adapts RPC and the alarm. Typed failures (NotFound, Invalid, Conflict) cross RPC with a status the edge maps to HTTP. Plain code remains only at the boundaries: the Turn driver feeding DSH's agent loop, the WebSocket handlers, and the CDP page driver (ticket 23).

## The one patch on a DSH package

patches/@deepseek-ai__dsh-llm@0.2.0-rc.2.patch replaces `createRequire(import.meta.url)("../package.json")`
with the version string. workerd has no module path for createRequire, so dsh-llm cannot load in a
Worker otherwise. No behaviour changes; drop the patch when DSH stops reading package.json at runtime.
