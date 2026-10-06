# 09: Live view and takeover from the phone

**Parent:** mr-robot-v1 (../mr-robot-v1.md) — stories robot-ksvy, robot-g6qb, robot-doqx, robot-j4ll, robot-ueh0

**What to build:** The Member watches the robot's browser live in the panel. When a page needs a human (login, 2FA), the robot asks for a takeover, its turn is suspended, and a push says the robot needs you; the Member opens the takeover screen, taps and types in the robot's tab, and hands it back; the turn resumes with a note of what happened. The robot fills carts and prepares orders but stops before payment.

**Blocked by:** 08 Browser Rendering provider with Leash primitives; 11 Web Push and notification settings

**Status:** in-progress

- [x] Screencast frames reach the PWA through the Robot DO WebSocket
- [x] Takeover forwards taps and keys; another Member cannot claim the same tab
- [x] Turn state is 'waiting for takeover' until handed back; the resumed turn sees the return note
- [x] Push 'needs you' is sent on takeover request

Reopened 2026-10-07 by the story verification (verification.md): stories 39, 40 (PWA live view and takeover screen not tried live), 41, 42 (stub-only).
