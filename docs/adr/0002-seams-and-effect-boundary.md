# 0002: Which DSH seams Mr. Robot plugs into, and where Effect stops

Status: accepted
Date: 2026-10-06
Spec: docs/issues/mr-robot-v1.md, "Assembled from DSH Cordis packages" and robot-naul

## Seams

Mr. Robot plugs its own Cordis adapters into these DSH seams:

| seam | adapter | file |
|---|---|---|
| session-persistence | Conversation log on DO SQLite | apps/worker/src/agent/session-log.ts |
| credentials | read-only over the Member and Home DOs | apps/worker/src/agent/seams.ts |
| browser-use | registers Browser Rendering as the provider | apps/worker/src/agent/seams.ts |
| ptc-runtime | Worker Loader isolate (ADR 0001) | apps/worker/src/agent/ptc.ts |
| web, skill, compaction, token meter, llm | DSH packages with Mr. Robot providers | apps/worker/src/agent |

**schedule is ported onto Durable Object alarms** (2026-10-07; the earlier decision not to use it was reversed at the owner's request). The Robot's composition provides `ctx.schedule` (apps/worker/src/agent/schedule.ts) and attaches DSH's own schedule_create / schedule_list / schedule_update / schedule_delete tools, so a Robot schedules exactly as the desktop harness does. Records, recurrence and reminder framing are DSH's; what DSH keeps in a Host storage domain and drives with timers is the Robot's routine table and its alarm. DSH's update rule is restated locally because the published package does not export it.

**Browser actions are Mr. Robot tools.** browser-use in DSH 0.2.0-rc.2 is only an exclusive provider
registration; the operations themselves live in experimental MCP packages for desktop Chrome. The
Leash-style primitives over Browser Rendering are browser_* tools; the registration is made so DSH
sees the provider.

**The file and command tools are Mr. Robot tools (v1.16).** run, read, write, edit, glob, grep,
delete_file, copy and the job tools (apps/worker/src/agent/tools/places.ts) name their Place with
`on` and go through apps/worker/src/places/places.ts to the Workspace, the Box or a Host. DSH's
tool-fs works on one local file system and its search runs ripgrep, which a Worker cannot; no DSH
file or shell tool is mounted.

## Effect

**The Workspace has one access path (v1.16).** The Robot's files are not behind a DSH fs seam any more: the file tools, copy, the Box's door (ws) and the edge all reach R2 through the Effect Workspace service (apps/worker/src/workspace/workspace.ts: read, stat, write, remove, list, page, open, removeUnder). Nothing else reads or writes the Files bucket for a Robot's prefix. Presigned links are the one exception that never touches the bytes: the Worker only signs them (workspace/object-store.ts, places/transfers.ts). A GET link is for a key the Workspace service has just looked at; a PUT link (a single upload or the parts of a multipart one) is for a key that the write rules of the file tools accept (writableWorkspaceKey in places/files.ts), which may not exist yet.

Effect owns: the edge API (router, errors, request decoding), the Workspace (R2), the Vault,
OAuth, Web Push, skill sync, and the scope of every Cordis composition (closing the scope disposes
the agent and its plugins: `composeScoped` in apps/worker/src/agent/compose.ts).

The three Durable Objects run their work as Effect programs over services (platform/durable.ts; member/member.ts; home/home.ts; robot/programs.ts, views.ts, browsing.ts); each class declares its tables and adapts RPC and the alarm. Typed failures (NotFound, Invalid, Conflict) cross RPC with a status the edge maps to HTTP. Plain code remains at the boundaries: the Turn driver feeding DSH's agent loop, the WebSocket handlers, and the CDP page driver (ticket 23). The places (apps/worker/src/places: dispatch, jobs, copies) are plain async code too, with tagged errors (places/errors.ts); a Host call's failure crosses from the Member DO to the Robot as a Schema-encoded tagged value (member/host-call.ts) and is decoded there. Converting the places to Effect services was left out of v1.16 (deep review P16).

## The one patch on a DSH package

patches/@deepseek-ai__dsh-llm@0.2.0-rc.2.patch replaces `createRequire(import.meta.url)("../package.json")`
with the version string. workerd has no module path for createRequire, so dsh-llm cannot load in a
Worker otherwise. No behaviour changes; drop the patch when DSH stops reading package.json at runtime.
