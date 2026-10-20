export const AUTO_REVIEW = `# Auto review

Auto review is a Robot setting. When it is on, a reviewer model checks each tool call of an item at allow before the call runs. It is off by default.

## What the reviewer does

- It reads the pending call, the owner's messages and the earlier tool calls of the Conversation.
- It classifies the risk of the call: low, medium or high.
  - Low: ordinary reads and writes of the Robot's own work.
  - Medium: deleting things that were there before, sending or posting outside, production changes, permission changes. Allowed only when the owner asked for exactly that.
  - High: sending secrets or private data to an outside place. Always denied.
- It allows the call, or denies it with a reason.

## What happens

- An allowed call runs.
- A denied call does not run. It becomes an Ask to the owner, with the reviewer's reason. The owner approves or rejects it. The reviewer never blocks the owner.
- When the review fails (the reviewer answers something else than its strict format, or cannot be reached), the call fails with the error and does not run.
- Items at ask are not reviewed: they ask the owner anyway.
- A call the owner approved is not reviewed again.
- A Subagent's calls are reviewed with its Robot's setting. box_run is reviewed like every other call.

## The reviewer's model

- The owner chooses the reviewer's provider, model and thinking effort in the Robot's Advanced settings.
- Without a choice, the Robot uses the Home default, which the Home admin sets in Admin. Without a Home default, the Robot's own model reviews.
- A cheap model is enough: the reviewer reads one call and answers with a short JSON object.
- Mr. Robot can change the switch and the reviewer of the Robots he directs.

## What people see

- The reviewer's tokens are a line of the Robot's cost (model: Auto review).
- The Trajectory lists each reviewed call with its risk and the decision.
`
