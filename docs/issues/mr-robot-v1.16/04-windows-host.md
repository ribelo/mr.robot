# 04: Windows Host: build, pwsh, restricted-token sandbox

**What to build:** The Host app builds for Windows (electron-builder nsis, unsigned) with the same pairing, tray and status (ob-szqb); its shell is pwsh 7 through DSH's tool-pwsh and pwsh-sandbox with the ACL runner, reporting partial enforcement honestly (ob-e68m); the Robot's directory is %USERPROFILE%\mr-robot\<robot>\; the heartbeat carries shell and platform and the runtime section names them per Host (ob-vyyg). A missing pwsh 7 is reported in the app with the installer link.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] By hand on Windows: pairing, a confined run, a denied write, a job (ob-szqb, ob-e68m) (not run in this session: needs a Windows computer with PowerShell 7. Under Wine the installer built, the packed app's ACL runner started as Node from the Electron program, the sandbox probe said partial, and the missing-PowerShell message came back; pwsh itself did not run under Wine)
- [ ] Workerd test: shell and platform in the Hosts line from the heartbeat (ob-vyyg) (covered by ticket 09's Hosts line test; this ticket adds the heartbeat fields `shell` and `shellProblem`)
- [x] The Windows installer is a deploy artefact listed in the README
