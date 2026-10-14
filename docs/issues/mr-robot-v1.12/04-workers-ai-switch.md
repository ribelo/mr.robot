# 04: Workers AI switch and Admin model combobox

**Parent:** mr-robot-v1.12 (../mr-robot-v1.12.md) — stories ux-101w, ux-xsnr, ux-zh1l, ux-mz3h, ux-jseo, ux-3l7i

**What to build:** Home settings gain a Workers AI switch (default on). Off: Workers AI models leave every model chooser and catalogue, the Provider card says "Disabled by the admin", model chains skip its entries with the reason "disabled by the admin", a Robot with nothing left blocks with that reason and resumes at its next Wake-up when the switch goes back on, and the Home default model moves to the first usable model with a note telling the admin what it changed to. The default model for new Robots is chosen with the Provider-grouped ModelSelect combobox.

**Blocked by:** 01 (UI primitives)

**Status:** ready-for-agent

- [ ] Switch off filters providers view, settings catalogue and Home settings models (workerd test)
- [ ] Chain skips Workers AI with the reason; all-unusable blocks with it; resume after switch on (workerd test with the scripted model)
- [ ] Default model moved on switch off, returned in the response and shown as a note
- [ ] Admin uses ModelSelect for the default model (component test)
