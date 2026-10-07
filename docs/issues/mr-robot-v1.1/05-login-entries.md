# 05: Login entries replacing secrets

**Parent:** mr-robot-v1.1 (../mr-robot-v1.1.md) — stories rb-gq50, rb-4dxe, rb-2myk, rb-ob2g, rb-vpes, rb-e1ic, rb-1dzv, rb-o52a, rb-36g4

**What to build:** Secrets become login entries: name, username, password, websites, notes, private or Home scope. The Member's settings have a Logins section to add, edit, reveal and delete entries and see which robots have each. Each entry is granted per robot. A robot lists the granted entries matching the current page and fills one into the page inside the browser backend, so the password never reaches its program, conversation or trajectory; filling is refused on a page whose registrable domain does not match the entry. Entries marked 'allow reading' can still be read raw (API keys), masked as now. The takeover window offers matching entries as autofill. Existing secrets migrate with their grants.

**Blocked by:** 01 Browser backend seam and per-robot backend choice

**Status:** ready-for-agent

- [ ] Robot DO test: fill on a matching page succeeds; on another domain it is refused
- [ ] Trajectory and conversation of a fill contain no password
- [ ] An ungranted entry is absent from the robot's list
- [ ] Home-scoped entry usable by another Member's robot once granted
- [ ] Migration keeps every existing secret and grant
- [ ] Takeover autofill fills the chosen entry
