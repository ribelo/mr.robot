# 01: Capabilities as Cordis plugins mounted by grant

**Parent:** mr-robot-v1.3 (../mr-robot-v1.3.md) — stories pl-vfxd, pl-rsoy, pl-d1oz, pl-kdmm

**What to build:** Every capability becomes a Cordis plugin with a config schema; a robot's composition mounts exactly the plugins its grants allow; behaviour is unchanged and the existing Robot DO tests pass with only wiring changes. Plugins free of Workers bindings expose a build loadable in the desktop DeepSeek Harness.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] robot.ts no longer assembles tool lists by hand; each capability is a plugin under packages/ or apps/worker/src/plugins
- [x] Robot DO test: an ungranted capability's plugin is not mounted (no tools, no prompt section)
- [x] All v1–v1.2 Robot DO tests pass
- [x] One pure-TS plugin (Exa or grant proposals) loads in a desktop DSH profile as a smoke check

## How it works

- **Plugin modules:** apps/worker/src/plugins/ has one Cordis plugin per capability: conversation, grant-proposals, setup, files, browser, logins, messaging, notify, robots, exa, host, skills, routines, web, credentials. Each follows the DSH plugin convention (name, inject, Schemastery Config, apply). Its Config carries its settings and the Robot as host (`z.any()` fields, as ptc.ts already did). apply registers its tools on ctx.tools and its standing rules as a system-prompt section. The browser takeover rule and the login_fill rule moved out of the platform prompt into the browser and logins plugins.
- **DSH seams:** where a capability needs a DSH seam (fs over R2, web, browser-use, skills, schedule), the module's `seams` step mounts it at the composition root. Cordis injects are always required, so a seam that provides its own service cannot be mounted from inside the capability's restricted context.
- **Composition:** Robot.mounts(config) picks the plugins from the grants (setup: conversation, setup, files). compose.ts mounts exactly those, and nothing else registers tools. toolNames() comes from the mounted plugins.
- **Desktop build:** packages/dsh-mr-robot-exa builds the Exa plugin from the same source as a DSH bundle (dsh.bundle + cordis.patch.yml).

## Verified

- All 154 earlier Robot DO tests pass without changes to them.
- New test (plugins.test.ts): without the browser and logins grants, a Robot has no browser_* or login_* tools and no takeover or login_fill rule in its system prompt. With them it has the tools and both rules.
- **Desktop smoke check** (2026-10-07): `dsh plugin --profile mr-robot-smoke add packages/dsh-mr-robot-exa`, then `dsh --profile mr-robot-smoke --patch probe.patch.yml headless`. A probe plugin in the booted desktop harness reported `web_search_exa=registered crawling_exa=registered get_code_context_exa=registered exa_agent_create_run=absent` (agentRuns: false in the bundle's config). The test profile was then removed.
