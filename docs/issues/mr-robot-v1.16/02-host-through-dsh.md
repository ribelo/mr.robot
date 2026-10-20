# 02: The Host executes through DSH: bash, sandbox, modes and roots

**What to build:** The Host app runs commands through DSH's tool-bash with bash-sandbox and sandbox-local (bwrap or Landlock on Linux, Seatbelt on macOS) (ob-wsf7). A Host's files and shell facet grants carry a mode (read-only, workspace-write, full) and write roots, defaulting to workspace-write with the Robot's directory ~/mr-robot/<robot>/ as the only root; the directory is created on first use and is the default cwd (ob-wh59, ob-397e). A denied write comes back naming the path; a retry with escalate puts a one-call Ask to the owner that runs the call unconfined once (ob-vnld, ob-ifak). A confined call on a Host with no usable sandbox fails closed; full runs anyway; reads stay wide; the Hosts page and the heartbeat show the sandbox state (ob-n72n, ob-he20, ob-xj2y). docs/hosts.md gets the shared-Host instruction: install the app under its own OS account (ob-5c8k).

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Workerd test with the Host stub: mode and roots per grant reach the stub; default cwd is the Robot's directory; a denial result; escalate creates a tool-call Ask whose approval runs once in full; confined fails closed on sandbox none; full runs (ob-wh59, ob-397e, ob-vnld, ob-ifak, ob-n72n, ob-he20)
- [ ] Component test: the facet editor with mode and roots; the Hosts page sandbox state (ob-wh59, ob-n72n)
- [ ] By hand: a confined run and a denied write on Linux and macOS (ob-wsf7, ob-xj2y)
- [ ] docs/hosts.md carries the shared-Host instruction (ob-5c8k)
