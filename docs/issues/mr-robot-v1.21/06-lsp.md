# 06: LSP on the Host

**What to build:** lsp.yaml with a shipped default set filtered by the captured PATH; a provider per Workspace session with the root as the LSP root; disposed on close and after thirty idle minutes; the lsp tool on 'workspace' only; locations rendered (cw-lx4f, cw-fb1q, cw-yeq1, cw-xxqw).

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Host Node tests: the filter by PATH; start on first query; dispose on close and idle
- [ ] Workerd test through the stub: the four operations on 'workspace' only; a call with another on refused
- [ ] By hand: LSP on this repository
