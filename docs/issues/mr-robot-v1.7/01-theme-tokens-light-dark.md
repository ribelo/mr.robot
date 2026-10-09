# 01: Theme tokens, light and dark themes, override in profile

**Parent:** mr-robot-v1.7 (../mr-robot-v1.7.md) — stories ap-qb2y, ap-p00m, ap-itj1, ap-udc9

**What to build:** One JSON token file (colours by role, radii, spacing, font sizes) with a light and a dark set generates the CSS variables under [data-theme]. The app follows the system theme by default; the profile offers System / Light / Dark, stored per Member and applied before first paint. The identity colour picker offers the token palette plus a custom hex.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Every CSS variable used by the stylesheets (including the DSH trajectory theme where it uses variables) is defined by the token file in both themes (test)
- [ ] Theme setting in the profile, persisted with the Member's UI settings, no flash on load
- [ ] Colour picker shows the palette and a hex input; old colours remain valid
