export const SUBAGENTS = `# Subagents

A Subagent is a second agent inside a Robot. The Robot gives it one task. The Subagent works in a context of its own and reports when it is done. A Subagent is a tool of its Robot. It is not a Robot: it is not in the Robot list, the directory or the Fleet, and it is never the doer of a Task.

## When to use one

Use a Subagent for expensive work: reading many pages, a long search, a large file. The work fills the Subagent's context, not the Robot's. The Robot's context stays small and is compacted later.

## The grant

- The owner grants the item subagents. It is off until granted, for Mr. Robot too.
- The grant has a list of models. The Subagents run only on these models. The list is empty by default. With an empty list, the Robot cannot delegate.
- The owner edits the list in the Robot's Advanced settings. Mr. Robot can edit the list of the Robots he directs. The grant itself stays with the owner.

## The tools

- subagent: a Subagent with a fresh context. Write the whole task: it sees nothing else of the Conversation.
- subagent_fork: a Subagent that starts with the Robot's whole context so far.
- Both take a label (3 to 5 words), the task, a model from the list (the first one when you give none) and a thinking effort.
- send_message: a message to a running Subagent. It reads it at its next step.
- interrupt_agent: stop a Subagent.
- list_agents: the Subagents with their state.

At most 3 Subagents run at once. The tool refuses a fourth.

## What a Subagent has

- The Robot's Files, its browser and its Box when the Robot has one. Logins and secrets are the Robot's; secret values are masked in the Subagent's log.
- The Robot's grants, except: delegation, Robot messages, Threads, shared-file edits, Asks and reactions.
- A call that needs the owner's answer (an item at ask) fails in a Subagent. The Subagent says so in its report. Then the Robot asks the owner itself.
- Auto review checks a Subagent's calls with the Robot's setting.

## The report

The Robot's Turn can end while its Subagents run. When a Subagent finishes, its last message is its report. The report reaches the Robot at the next step of a running Turn, or as a Wake-up that starts a Turn. Check a report before you rely on it.

## What people see

- The Robot's header shows "N Subagents". Its menu opens each Subagent's own Chat and Trajectory. There the owner can stop it. Nobody writes to a Subagent: people talk to the Robot.
- The Robot's Chat shows one card per delegation: label, model, state and the first line of the report.
- The Robot's Trajectory lists each delegation. Each entry opens the Subagent's Trajectory.
- Mission Control shows "working · N Subagents" on the Robot's row. The row opens one line per Subagent, with Interrupt.

## Limits and cost

- The tokens of a Subagent are the Robot's cost and the owner's, on their own line (model: Subagents).
- When the spend limit is reached, the Subagents stop first, then the Robot.
- Interrupting the Robot stops its Subagents. A Rewind to before a delegation archives its Subagents. Deleting the Robot deletes them.
- After a platform restart, a running Subagent continues. It does not do finished steps again.
`
