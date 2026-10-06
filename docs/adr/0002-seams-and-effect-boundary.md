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

**schedule is not used.** DSH's schedule service needs storage-domain, session-controller and
host timers, and schedules belong to a session the host controller wakes. A Robot has one endless
Conversation and is woken by its own Durable Object alarm, which also carries outbox retries and
Turn recovery. Routines are therefore the Robot's own table and alarm (apps/worker/src/robot/schedule.ts),
exposed to the model as routine_* tools. Revisit if DSH ships a schedule seam without the host services.

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

The three Durable Object classes are still plain classes with async RPC methods. That contradicts the owner's instruction (Effect as much as possible on the Cloudflare side) and is open work: ticket 23.

## The one patch on a DSH package

patches/@deepseek-ai__dsh-llm@0.2.0-rc.2.patch replaces `createRequire(import.meta.url)("../package.json")`
with the version string. workerd has no module path for createRequire, so dsh-llm cannot load in a
Worker otherwise. No behaviour changes; drop the patch when DSH stops reading package.json at runtime.
