# 04: Windows Host: build, pwsh, restricted-token sandbox

**What to build:** The Host app builds for Windows (electron-builder nsis, unsigned) with the same pairing, tray and status (ob-szqb); its shell is pwsh 7 through DSH's tool-pwsh and pwsh-sandbox with the ACL runner, reporting partial enforcement honestly (ob-e68m); the Robot's directory is %USERPROFILE%\mr-robot\<robot>\; the heartbeat carries shell and platform and the runtime section names them per Host (ob-vyyg). A missing pwsh 7 is reported in the app with the installer link.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] By hand on Windows: pairing, a confined run, a denied write, a job (ob-szqb, ob-e68m)
- [ ] Workerd test: shell and platform in the Hosts line from the heartbeat (ob-vyyg)
- [ ] The Windows installer is a deploy artefact listed in the README
