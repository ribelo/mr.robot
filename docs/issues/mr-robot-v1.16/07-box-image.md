# 07: The Box image and the generated docs/box.md

**What to build:** The Box image extends the python base with the tools the spec lists and ws, without a browser, pandoc, tesseract, LibreOffice, Docker or login-bound CLIs (ob-asp3, ob-e8q1). The uv and Bun caches point into box/.cache/ (ob-phi5). The build writes a manifest of tools and versions; the deploy generates the tool list in docs/box.md from it (ob-m73k). The instance stays standard-1 and Box minutes stay a cost source (ob-g6vg).

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] Staging: a Box boots, docs/box.md lists its tools with versions, ffmpeg and ripgrep run, a second boot reuses the uv cache; boot time recorded in the closing note (ob-asp3, ob-phi5, ob-m73k) (not run in this session: needs a deployed Box)
- [x] The Dockerfile excludes the named packages; the image size is in the closing note (ob-e8q1)
- [x] Cost by source still shows box minutes (ob-g6vg)
