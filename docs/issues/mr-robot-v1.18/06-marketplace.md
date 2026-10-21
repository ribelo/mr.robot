# 06: The Marketplace page

**What to build:** A page listing the Space's definitions with title, paragraph, needs matched against the Member's Connections and Hosts, author and date, with Add; publishing and removal for the admin (rm-vhrq, rm-mv69, rm-10ai).

**Blocked by:** 05

**Status:** done

- [x] Workerd test: the list with needs matched; admin publish and remove; Member Add (rm-vhrq, rm-mv69, rm-10ai)
- [x] Component test: the page with Add and needs (rm-vhrq, rm-10ai)

## Closing note

definitions.test.ts, "the Marketplace": Ben's list with each need matched (his google Connection, his bank.test login; no Slack, no other site, no Host), the admin's publish and remove (403 for Ben), Add of a published one, 404 for an unpublished one. apps/web/test/marketplace.test.tsx: the page with the needs marked, Download definition, Add opening the new Robot, and the admin's Unpublish and Remove.

Decisions:
- GET /api/marketplace returns every definition the Member sees (published, or his own) with its tool groups and its needs: a connector by kind (met by any Connection he reaches of that kind), a login by site (met by an entry of his with that registrable domain), a Host facet (met when he reaches a Host). An unmet need is marked "Add will ask for this"; Add is never blocked, since setup asks and proposes.
- The admin's actions are POST /api/admin/definitions/<slug>/publish {published} and DELETE /api/admin/definitions/<slug>. A definition removed from the library that is still in the repository comes back at the next sync, as with skills.
- The page is #/marketplace, linked under Mission Control in the sidebar. Each card has Add, Download definition (the tar.gz of ticket 04, for the admin to commit by hand), and for the admin Publish or Unpublish and Remove. An imported brief (ticket 07) shows "imported summary".
- Save as definition is on the Robot's settings page: a name and the button, with the result (in the Marketplace when the owner is the admin, otherwise his until the admin publishes it).
