# 05: Login entries replacing secrets

**Parent:** mr-robot-v1.1 (../mr-robot-v1.1.md) — stories rb-gq50, rb-4dxe, rb-2myk, rb-ob2g, rb-vpes, rb-e1ic, rb-1dzv, rb-o52a, rb-36g4

**What to build:** Secrets become login entries: name, username, password, websites, notes, private or Home scope. The Member's settings have a Logins section to add, edit, reveal and delete entries and see which robots have each. Each entry is granted per robot. A robot lists the granted entries matching the current page and fills one into the page inside the browser backend, so the password never reaches its program, conversation or trajectory; filling is refused on a page whose registrable domain does not match the entry. Entries marked 'allow reading' can still be read raw (API keys), masked as now. The takeover window offers matching entries as autofill. Existing secrets migrate with their grants.

**Blocked by:** 01 Browser backend seam and per-robot backend choice

**Status:** done

- [x] Robot DO test: fill on a matching page succeeds; on another domain it is refused
- [x] Trajectory and conversation of a fill contain no password
- [x] An ungranted entry is absent from the robot's list
- [x] Home-scoped entry usable by another Member's robot once granted
- [x] Migration keeps every existing secret and grant
- [x] Takeover autofill fills the chosen entry

## How it works

- An entry (username, password, websites, notes, allow reading, private or Home) is stored sealed as JSON under its name, in the Member DO or, when shared, in the Home (apps/worker/src/platform/logins.ts). A value stored before entries reads as an entry whose password is that value with "allow reading" on, so existing secrets and their grants keep working without a data migration.
- Robot tools (tool group "secrets"): `login_list` (granted entries, username and websites, whether each matches the open page; never the password), `login_fill` (the Robot DO types username and password into the page over CDP; refused unless the page's registrable domain matches one of the entry's websites), `secret_get` only for entries marked "allow reading".
- Settings: "Logins" under the Member's name: add, edit (password kept unless retyped), reveal, delete, share with the Home, and which of their Robots hold each. Advanced settings lists logins with username and websites for granting. The takeover window has a key button listing the Robot's granted entries for the page and fills the chosen one.

## Verified

- Robot DO tests (logins-robot.test.ts, takeover.test.ts, logins.test.ts): fill on the entry's site logs in; on another domain it is refused; the password is absent from trajectory, conversation and every model request; an ungranted entry is absent from login_list; another Member's Robot fills a Home entry once granted; a legacy value stays readable and granted and is listed with the Robots holding it; takeover autofill fills the chosen entry.
- Live 2026-10-07 on Browser Check (Browser Run) with the public demo account of the-internet.herokuapp.com: login_list showed the entry, login_fill filled it, the Robot clicked Login and reached "You logged into a secure area!"; on example.com login_fill was refused naming the entry's site; the password does not appear in the trajectory or conversation. In the takeover window the key button offered "herokuapp-demo (tomsmith)" and filled both fields.
- Migration live: the owner's Home had no secrets before this change, so only the test covers it.
