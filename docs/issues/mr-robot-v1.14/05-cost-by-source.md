# 05: Cost by source

**What to build:** A Robot's monthly cost is shown by source — model (with lines for the Robot itself, the reviewer and Subagents as they land), browser, computer, services — with the total; the Member's and the Admin's cost views show the same breakdown; the spend limit counts every source (ao-zbld, ao-ef5t, ao-ypas, ao-nkkb). Usage rows gain a source; a CostBreakdown shape in the protocol carries it; no new tables beyond what the computer adds later.

**Blocked by:** 01

**Status:** done

- [x] Protocol: CostBreakdown = { model: { robot, review, subagent }, browser, computer, services, total }
- [x] Workerd test: model and browser usage from scripted Turns land in their sources; the Robot, Member and Admin cost endpoints return the breakdown with the right total (ao-zbld, ao-ef5t, ao-ypas)
- [x] Workerd test: the spend limit blocks the Robot when the sum of sources crosses it, not only model cost (ao-nkkb)
- [x] Component test: the Robot panel, the profile and Admin render the breakdown with a total line (ao-zbld)

**Closing note:** The Robot's `usage` rows and the Member's `usage` rows have a `source` (robot, review, subagent, browser, computer, services); `Robot.recordUsage` writes both. The Robot's migration splits each old month: model = old total minus browser and services. The Member's old rows have no split, so their cost counts as the model's. The Member's own view is `GET /api/me/costs` (the Profile's "Costs this month"); the Robot panel, the Profile and Admin render the breakdown with a total line.
