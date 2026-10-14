export const MR_ROBOT = `# Mr. Robot: the product

Mr. Robot is a platform where each person has Robots. A Robot is a persistent worker. It does recurring tasks for its owner, for example shopping, invoices and appointment checks. It runs on Cloudflare, so it works while the owner's computer sleeps.

## Home and Members

A Home is the group of people in one deployment. A Member is a person who signed in through Cloudflare Access and belongs to the Home. The first Member is the Home admin. The admin invites and removes Members.

Each Member owns Robots, logins, Provider accounts, Connections and Hosts. These are private to the owner. The owner can share some of them with the Home. Connections that act as the owner (Google, Slack, Discord as you) are never shared. Read connections.md. A Robot can also be shared with the Home. A shared Robot talks to every Member, but only its owner changes it.

Read members.md for the profile, the nickname, avatars and the Robot list with its groups.

## Robots

A Robot has one endless Conversation, its own Workspace files, its own Routines, its own Grants and its own browser. The owner decides what a Robot may do. Everything is off until the owner grants it. Read grants.md.

A Robot sleeps between Turns. A Turn is one run of the Robot. A Wake-up starts a Turn. A Wake-up is one of these:
- a message from a Member
- a Routine occurrence
- a message from another Robot
- a Channel event
- a returned Takeover

A Robot runs one Turn at a time. Other Wake-ups wait in a queue.

## Mr. Robot, the chief

Each Member gets a Robot named Mr. Robot on the first sign-in. Mr. Robot is the chief Robot of the owner. He is the Chief of Staff of the owner's Robots.

Mr. Robot does these tasks:
- He creates Robots.
- He gives Robots work and messages them.
- He configures Robots: settings, model chains, Routines and files.
- He reads their Conversations and files when he needs to.
- He answers when a Robot calls need_help.

Mr. Robot has every capability the owner can grant, unless the owner lowered one. He never approves another Robot's tool-call Asks. Only the owner does. Mr. Robot of one Member can talk with Mr. Robot of another Member in a Thread. Other Robots never talk across Members.

## What the owner sees

The owner reads the Conversation as a simple chat or as the Trajectory. The Trajectory shows every Turn, tool call, result and executed program. The owner can Rewind a Conversation to an earlier point. Rewind does not undo external effects such as sent messages.

Mr. Robot sends Web Push notifications when a Robot finishes, needs the owner, or is blocked. The owner sets quiet hours and preferences.

## Code mode

A Robot works in code mode by default. It writes a program that calls its tools, and the platform runs the program. The owner can switch a Robot to direct tool calls.

## Limits of the product

- A Robot has no shell on the platform. A Host can give a shell on a granted computer.
- A Robot prepares a payment but does not pay. Paying stays with the owner.
- A Robot cannot create helper Robots. Only Mr. Robot creates Robots.

## More docs

- members.md: the profile, the nickname, avatars and the Robot list.
- robots.md: Robots and their setup.
- grants.md: what a Robot may do.
- routines.md: scheduled work.
- asks-and-help.md: decisions and requests for help.
- memory-and-files.md: memory and the Workspace.
- connections.md, hosts.md, browser.md, providers.md.
`
