export const ROBOTS = `# Robots

A Robot is a persistent worker owned by one Member. It is not a chat session. One Robot is one Durable Object with one endless Conversation. A Robot can hand work to Subagents; they are its tools, not Robots (read subagents.md).

## Messages while a Robot works

- The owner's messages, from the app or from a Channel that knows the owner, reach a working Robot at its next step (a steer). Mr. Robot's messages to the Robots he directs do the same. A steer can change what the Robot does; the Robot then says so.
- Everything else (Tasks, webhooks, other Robots, Threads, platform notes) waits for a Turn of its own (a follow-up).
- Ctrl+Enter sends a follow-up on purpose. Follow-ups from one sender that wait together arrive as one Turn.

A Robot speaks only with say. Each say is one message, with files or screenshots attached. Text without say stays in the Trajectory.

## Creating a Robot

A Member or Mr. Robot creates a Robot with New robot. The new Robot is in setup. In setup, the Robot defines itself:

1. It interviews the owner: what it is for, what it watches, how often, how the owner wants to hear from it.
2. It calls set_identity with a name, a title, a description and an avatar colour.
3. It writes its own Persona files. Nobody approves them.
4. It calls setup_complete with one summary of the Grants it needs and why.

The owner approves only the Grants. Then the Robot is active. During setup it can only ask and propose.

## Persona files

Persona files belong to the Robot. The Robot edits them with the file tools.
- SOUL.md: who the Robot is and how it behaves.
- IDENTITY.md: its name, role and description.
- AGENTS.md: its working rules.
- TOOLS.md: its notes about tools.
- MEMORY.md: facts it keeps for the long term.
- memory/YYYY-MM-DD.md: daily notes.

When a Robot changes SOUL.md, it tells the owner. Read memory-and-files.md for the other files.

## Settings the owner controls

- Name, title, description, avatar. After setup the Robot may change its own title, description and avatar colour with set_identity, and it tells the owner what changed. Its name stays the owner's to change here, so the sidebar never changes under the owner. The avatar is a generated robot picture on the avatar colour. "Another look" in the Robot's profile draws a new picture. The owner sees it before saving. The sidebar, the Conversation header, the Admin fleet table and the Robot's messages show the same avatar.
- Model chain: an ordered list of accounts and models. Read providers.md.
- Context budget and the compaction instruction. Compaction shortens a long context. The instruction says what to keep.
- While idle: cache warming (Mr. Robot's default) refreshes the model's cache at 54, 108 and 162 minutes, so the next message is cheap; idle compaction (other Robots' default) compacts once at 54 minutes, after one step to write memory. Neither runs during a Turn or while work waits. A context below the floor (20 000 tokens by default) is not compacted.
- Auto review and the reviewer's model. Read auto-review.md.
- The models of its Subagents. Read subagents.md.
- Code mode or direct tool calls.
- Grants. Read grants.md.
- Spend limit: the Home's, no limit, or an amount. Read providers.md.
- Notifications.
- Sharing: private or shared with the Home.

The owner can pause, resume and delete a Robot. A paused Robot does not run.

## Clear history, Start over, Reset everything

- Clear history clears the Conversation.
- Start over clears the Conversation and resets the Workspace to the templates. Grants, Tasks, Connections and settings stay.
- Reset everything keeps logins, Provider accounts, Hosts, the skill library and Home settings.

The docs/ folder is never removed. The platform owns it.

## Mr. Robot and other Robots

| | Mr. Robot | Other Robots |
|---|---|---|
| Created | on first sign-in | by the owner or Mr. Robot |
| Grants | allow on everything, unless the owner lowered an item | off until the owner grants |
| Creates Robots | yes | no |
| Reads other Robots | yes, through the deputy tools | no |
| Edits the skill library | yes | no, they propose |
| Writes shared owner files | yes, memory_write_shared | no, they use propose_member_file_edit |
| Is asked questions by other Robots | yes (robot_send with question) | no |
| Has a recipient Grant to Mr. Robot | not needed | yes, from creation; the owner can remove it |

A Robot other than Mr. Robot sends a work request to another Robot only with a recipient Grant. To put a question to its owner, it uses ask, which needs no Grant. The reply to a request comes back in the sender's Conversation as a labelled message.

## Skills

A skill is a set of instructions in a SKILL.md file. A global skill is in the Home library. A Robot reads the global skills granted to it. It cannot edit them. A local skill is in the Robot's Workspace under skills/. The Robot edits it freely and can propose it for the library. A platform skill ships with the Worker under docs/skills/; every Robot reads it with no Grant.
`
