# 08: Two browsers: remove Container Chrome and its variants

**What to build:** Container Chrome, via VPN and via proxy are removed with infra/chrome, wireproxy, the WireGuard and proxy Home credentials and their admin cards (ob-ltsr). The Home default becomes Browser Rendering and Robots on a removed backend move to it at the upgrade (ob-l24v). The backend picker and docs/browser.md show Browser Rendering and Host browsers; the block message suggests the other (ob-myzd). Past usage rows keep their backend names (ob-0c3o).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] Workerd test: the backend union, the migration of Robots and the Home default, old usage rows kept (ob-ltsr, ob-l24v, ob-0c3o) (apps/worker/test/two-browsers.test.ts; the block message in browser-backends.test.ts, ob-myzd)
- [x] Component test: the picker with two choices (ob-myzd) (apps/web/test/browser-picker.test.tsx)
- [x] Alchemy plan test: the Chrome container and its credentials gone (ob-ltsr) (infra/stack.test.ts; the credentials are Home settings, not plan resources, and the Workerd test shows them deleted)
