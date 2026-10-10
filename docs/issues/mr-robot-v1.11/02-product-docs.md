# 02: Product docs in every Workspace

**Parent:** mr-robot-v1.11 (../mr-robot-v1.11.md) — stories sk-cqc5, sk-xseb, sk-9db0, sk-n4dy

**What to build:** Every Workspace contains a read-only docs/ folder shipped with the Worker (mr-robot, robots, grants, routines, asks-and-help, memory-and-files, connections, hosts, browser, providers), each under two pages in Simplified Technical English. The prompt lists them with one line each and tells the Robot to read the relevant doc before answering a question about the product and to say it does not know otherwise. The file tools refuse to change or delete them; the Files view shows them read-only; a deploy updates them.

**Blocked by:** 01 (the docs index is a prompt section)

**Status:** ready-for-agent

- [ ] Ten docs readable by the Robot and in the Files view, marked read-only
- [ ] write, edit and delete_file refuse docs/ paths with a clear message
- [ ] Docs index in the prompt preview; workerd tests for presence, read-only refusal and the index
