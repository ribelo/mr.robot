# 06: Shared Pages

**What to build:** A Share switch in the reading view mints a public link with a signed, revocable token; /p/:token serves the title, content and PDF without Access and nothing of the app; shared HTML carries a sandboxing CSP and no cookies; the profile lists every shared Page with Stop sharing; the Robot has no share tool (dp-hf7v, dp-jl3d, dp-zq16, dp-62di, dp-p5yn).

**Blocked by:** 05

**Status:** done (staging check open)

- [x] Workerd test: share mints a token; /p/:token serves without Access; revoke makes it 404; the shared HTML response carries the sandbox CSP; no Robot tool can share; the profile lists shares (dp-hf7v, dp-jl3d, dp-zq16, dp-62di, dp-p5yn)
- [x] Component test: the Share switch and the profile list (dp-hf7v, dp-zq16)
- [ ] Staging: a shared link opened in a private window (dp-jl3d) — open: needs a deploy
