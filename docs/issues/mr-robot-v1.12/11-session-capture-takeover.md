# 11: Session capture through Takeover (PWA)

**Parent:** mr-robot-v1.12 (../mr-robot-v1.12.md) — stories ux-8pek, ux-wgok, ux-j7m1

**What to build:** In the PWA, Connect Slack and Connect Discord as you open Mr. Robot's browser on the service's sign-in page under Takeover; when the person hands back, the platform reads the cookies and storage of the service origins through the browser driver seam, creates the Connection through the same path as a paste, closes the tab and discards that tab's state so the session lives only in the Connection. Ten minutes without a session ends the attempt with a message.

**Blocked by:** 09 (Discord as you)

**Status:** done

- [x] Connect through browser creates the Connection from a fake driver's cookies and storage and leaves no session in the browser state (workerd test: apps/worker/test/session-capture.test.ts)
- [x] Timeout path tells the person (workerd test: apps/worker/test/session-capture.test.ts; the PWA message in apps/web/test/takeover-sign-in.test.tsx)
- [x] PWA shows the Takeover and the result (component test: apps/web/test/takeover-sign-in.test.tsx)
