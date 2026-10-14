# 10: Session capture in the desktop app (Slack, Discord)

**Parent:** mr-robot-v1.12 (../mr-robot-v1.12.md) — stories ux-taxm, ux-66a4, ux-wgok, ux-jpwz, ux-j7m1, ux-cbo3

**What to build:** In the desktop app, Connect Slack and Connect Discord as you open a sign-in window in an isolated browser session; when the person has signed in, the app reads the session (Slack: the xoxc token from localConfig_v2 and the d cookie; Discord: the user token) and the page posts it to the connection endpoint; the window closes and the isolated session is cleared. Ten minutes without a session ends the attempt with a message. "Sign in again" reconnects through the same window. "Paste a session instead" keeps the current fields as the fallback. The captured session is never shown to the person or to a Robot.

**Blocked by:** 09 (Discord as you)

**Status:** ready-for-agent

- [ ] Host app IPC captureSession(kind) with timeout and session clearing; page uses it when the bridge is present, else shows paste
- [ ] Paste fallback visible in both apps (component test)
- [ ] Manual on heisenbug: Slack and Discord connect, timeout, sign in again (recorded in the ticket on completion)
