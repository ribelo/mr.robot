# 03: Avatars: Member (colour or picture) and Robot (bottts)

**Parent:** mr-robot-v1.12 (../mr-robot-v1.12.md) — stories ux-2ft4, ux-s88l, ux-g4l9, ux-0zm6, ux-h0s4, ux-4fgy, ux-n1mw

**What to build:** A Member picks an avatar colour (initials on it) or uploads a picture (PNG/JPEG/WebP, resized client-side to 256 px, at most 1 MB, stored in R2 under the Member, served through the API) and can remove it to fall back to colour and initials. Every Robot shows a generated bottts robot (DiceBear, client-side) from a seed stored in its identity, tinted with its colour; a Robot without a seed uses its id; "Another look" in the Robot profile draws a new seed and shows it before saving. The avatar appears in the sidebar, the conversation header, the Admin fleet table and Robot messages. The DiceBear dependency and its licence are recorded in the commit message.

**Blocked by:** 02 (Profile layout)

**Status:** ready-for-agent

- [ ] Member avatar: colour, upload, serve, remove (workerd test through the API)
- [ ] Robot avatarSeed default from id and change through the Robot profile (workerd test)
- [ ] Avatar rendered in sidebar, header, Admin and messages; Another look changes the preview (component tests)
