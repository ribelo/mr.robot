# Mr. Robot

Self-hosted robots on Cloudflare: persistent agents with one endless conversation each, built from DeepSeek Harness packages, surrounded by Effect, deployed with Alchemy, driven from a phone PWA.

- GLOSSARY.md: vocabulary
- docs/issues/: specs and tickets (start with mr-robot-v1.md)
- docs/adr/: decisions
- docs/reference/: UI reference screenshots

## Layout

- `apps/worker`: the edge Worker and the Robot, Member and Home Durable Objects
  - `src/robot`: one Robot (turn queue, Routines, rewind, messaging, browser, takeover)
  - `src/agent`: the DSH composition inside a Robot (session log on DO SQLite, tools, code mode, providers)
  - `src/edge`: HTTP API behind Cloudflare Access
- `apps/web`: the PWA (React)
- `packages/protocol`: shapes shared by both
- `infra`: the Alchemy stack (`alchemy.run.ts` at the root)

## Commands

- `pnpm test`: everything (workerd tests for the Worker, component tests for the PWA, the Alchemy plan test)
- `pnpm lint:deps`: no Node-bound DSH package and no Effect inside DSH packages in the Worker bundle
- `pnpm dev`: local server on http://127.0.0.1:8787, signed in as owner@example.com
- `pnpm login`: one-time Cloudflare login for deploying (Alchemy profile `mr-robot` in ~/.alchemy-mr-robot)
- `pnpm deploy`: build the PWA and deploy every resource; prints the URL
- `pnpm --filter @mr-robot/worker test:integration`: real Browser Rendering (needs Cloudflare credentials)

After the first deploy, open the URL, sign in with the e-mail code, and add a DeepSeek key (or a subscription) on your profile page; the first person to sign in is the Home admin.
