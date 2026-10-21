# Mr. Robot

Self-hosted robots on Cloudflare: persistent agents with one endless conversation each, built from DeepSeek Harness packages, surrounded by Effect, deployed with Alchemy, driven from a phone PWA.

- GLOSSARY.md: vocabulary
- docs/issues/: specs and tickets (start with mr-robot-v1.md)
- docs/adr/: decisions
- docs/reference/: UI reference screenshots

## Layout

- `apps/worker`: the edge Worker and the Robot, Member and Space Durable Objects
  - `src/robot`: one Robot (turn queue, Task Wake-ups and attempts, chapters, the stored chat and cold chapters, rewind, messaging, browser, takeover)
  - `src/agent`: the DSH composition inside a Robot (session log on DO SQLite, tools, code mode, providers)
  - `src/edge`: HTTP API behind Cloudflare Access
- `apps/web`: the PWA (React)
- `packages/protocol`: shapes shared by both
- `infra`: the Alchemy stack (`alchemy.run.ts` at the root)

## Commands

- `pnpm test`: everything (workerd tests for the Worker, component tests for the PWA, the Alchemy plan test)
- `pnpm lint:deps`: no Node-bound DSH package and no Effect inside DSH packages in the Worker bundle
- `pnpm dev`: local server on http://127.0.0.1:8787, signed in as owner@example.com
- `pnpm cloudflare-login`: one-time Cloudflare login for deploying (Alchemy profile `mr-robot` in ~/.alchemy-mr-robot)
- `pnpm deploy`: build the PWA and deploy every resource; prints the URL
- `pnpm --filter @mr-robot/host dist:win`: the Windows installer of the Host app, `apps/host/release/mr-robot-host-setup-<version>-x64.exe` (NSIS, per user, unsigned: SmartScreen warns on first run). On a machine that is not Windows, electron-builder needs Wine in the PATH to write the uninstaller (`nix shell nixpkgs#wineWow64Packages.stable -c pnpm --filter @mr-robot/host dist:win`). `pack:win` stops at the unpacked folder and needs no Wine
- `pnpm --filter @mr-robot/worker test:integration`: deploys a staging Worker, checks real Browser Rendering (actions, screenshot, cookies, screencast), deletes it; needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID

After the first deploy, open the URL, sign in with the e-mail code, and add a DeepSeek key (or a subscription) on your profile page; the first person to sign in is the Space admin.

## Deploy artefacts

- The Worker and the PWA: `pnpm deploy`.
- The Host app for NixOS: `nix-build apps/host/package.nix`.
- The Host app for Windows: the installer from `pnpm --filter @mr-robot/host dist:win` (above). Install PowerShell 7 on the computer first; the app tells the owner when it is missing.