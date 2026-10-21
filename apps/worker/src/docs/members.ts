export const MEMBERS = `# Members

A Member is a person who signed in through Cloudflare Access and belongs to the Space. The first Member is the Space admin. The admin invites and removes Members. Read mr-robot.md for the Space.

## What a Member owns

Each Member owns Robots, logins, Provider accounts, Connections and Hosts. These are private to the owner. The owner can share a Robot, a login, a Provider account, a Host or a Discord bot Connection with the Space. Connections that act as the owner (Google, Slack, Discord as you) are never shared. Read connections.md.

## The profile

The Member opens the profile from their name in the sidebar foot. The profile has these sections, in this order:
1. You: name, nickname, time zone, quiet hours and the notifications of this device. In the desktop app, one sentence under quiet hours says that the app shows notifications natively.
2. Appearance: theme and work details.
3. Providers. Read providers.md.
4. Connections. Read connections.md.
5. Logins. Read browser.md.
6. Hosts. Read hosts.md.
7. What your Robots know about you: the Member files. Read memory-and-files.md.
8. Reset everything.

## Nickname

The nickname is optional. It says how Robots address the Member. A blank nickname removes it.

The runtime section of each Robot's prompt has an Owner line. It gives the owner's name and, when the owner set a nickname, how to address them. For example: "Anna Kowalska; address them as Ania". my_capabilities gives the same line. Address your owner that way.

## Avatars

A Member has an avatar: a colour with the initials, or a picture. The picture is PNG, JPEG or WebP, at most 1 MB. When the Member removes the picture, the colour and the initials come back. The sidebar foot and the Admin members table show the avatar.

A Robot has its own avatar: a generated robot picture on its avatar colour. "Another look" in the Robot's profile draws a new picture. Read robots.md.

## The Robot list

The sidebar lists the Robots that a Member can reach, each with its avatar. Each Member sorts them into groups of their own. Another Member does not see these groups and has their own.
- New group… makes a group with a name. The menu of a group renames it, moves it up or down, or deletes it. A group also moves by drag and drop. When a group is deleted, its Robots go back to the list with no group.
- A group collapses and expands. The sidebar remembers that.
- A Robot moves to a group by drag and drop, or with "Move to…" in its menu. "Move to…" also makes a new group.
- Hidden is a built-in group at the bottom. It is collapsed. "Hide from sidebar" in the menu of a Robot puts it there. "Show in sidebar" brings it back.
- Pinned Robots stay on top of their group. Unread marks do not change.
- The search finds Robots in all groups, also in collapsed ones. It shows the group of each match.
- A Robot that is deleted, or that the Member can no longer reach, leaves its group.
`
