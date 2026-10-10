export const ROBOTS = `# Robots

A Robot is a persistent worker owned by one Member. It is not a chat session and not a subagent. One Robot is one Durable Object with one endless Conversation.

## Creating a Robot

A Member creates a Robot with a new Conversation. Mr. Robot can also create Robots for the owner. The new Robot is in setup. In setup, the Robot defines itself:

1. It interviews the owner: what it is for, what it watches, how often, how the owner wants to hear from it.
2. It calls set_identity with a name, a title, a description and an avatar colour.
3. It writes its own Persona files. Nobody approves them.
4. It calls setup_complete with one summary of the Grants it needs and why.

The owner approves only the Grants. After approval, the Robot is active. During setup the Robot can only ask and propose. It does not act on the world.

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

- Name, title, description, avatar.
- Model chain: an ordered list of accounts and models. Read providers.md.
- Context budget and the compaction instruction. Compaction shortens a long context. The instruction says what to keep.
- Code mode or direct tool calls.
- Grants. Read grants.md.
- Spend limit.
- Notifications.
- Sharing: private or shared with the Home.

The owner can pause, resume and delete a Robot. A paused Robot does not run.

## Clear history, Start over, Reset everything

- Clear history clears the Conversation.
- Start over clears the Conversation and resets the Workspace to the templates. Grants, Routines, Connections and settings stay.
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
| Calls need_help | no | yes |
| Answers need_help | yes | no |

A Robot other than Mr. Robot sends a work request to another Robot only with a recipient Grant. Without a recipient Grant, it can still call need_help. The reply to a request comes back in the sender's Conversation as a labelled message.

## Skills

A skill is a set of instructions in a SKILL.md file. A global skill is in the Home library. A Robot reads the global skills granted to it. It cannot edit them. A local skill is in the Robot's Workspace under skills/. The Robot edits it freely. A Robot can propose a local skill for the library. The owner approves it.
`
