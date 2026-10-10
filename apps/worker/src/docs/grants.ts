export const GRANTS = `# Grants

A Grant is a permission the owner gives a Robot. Everything is off until granted. A Robot cannot grant anything to itself.

## Grant items

A grant item is one of these:
- a tool group: files, web, browser, routines, messaging, notify, skills, secrets, exa, exa-agent
- a skill
- a recipient Robot (a Robot it may message)
- a Connection, with a separate item for Connection write
- a Host facet: browser, files or shell
- a login

Two tool groups belong to Mr. Robot only: robots and deputy.

## Three levels

Each grant item has one of three levels:
- allow: the Robot uses it without asking.
- ask: each call of a tool in that item puts an Ask in the Conversation. The owner approves or rejects that one call.
- deny: the Robot does not have it. The tool does not exist for the Robot.

An item with no stored level is deny.

## How ask works

1. The Robot calls a tool in an ask item. The call needs a reason argument. The Robot says why it needs the call.
2. The platform stores an Ask of kind tool-call. It shows the tool, the arguments and the reason.
3. The tool does not run. The call gives the result "waiting for your owner" with the Ask id. The Robot ends its Turn with one short line. In code mode, the program gets the same result and continues.
4. If the owner approves, the platform runs the stored call: the same tool with the same arguments. A Wake-up "[Your owner approved <tool> (<Ask id>)]" gives the Robot the result.
5. If the owner rejects, the call does not run. A Wake-up "[Your owner rejected <tool> (<Ask id>): <reason>]" tells the Robot.

This also works in a Routine Turn that nobody watches: the Ask waits, and the answer wakes the Robot later.

One approval covers exactly one call. The platform never remembers an approval.

Only the owner answers a tool-call Ask. Mr. Robot never approves it.

## Change a level for good

A Robot that needs a different level calls propose_grants. It names each item with the level it wants: allow or ask. The platform stores the proposal exactly. The owner answers the Ask. The platform applies the stored proposal. It does not apply prose.

The owner can also change levels in the Advanced settings of the Robot. Each item has three states there.

## Defaults

- A new Robot ends setup with allow on what the owner approved. It gets ask on files, web and exa. It gets deny on Connections with write, Hosts, logins and exa-agent.
- Mr. Robot has allow on every item, also on a new plugin. The owner can lower any item.

## See your own levels

The tool my_capabilities lists every tool group, Connection, Host, login and skill with its level and a short description. It also lists what is not granted. The runtime section of the prompt and the Advanced settings use the same data. They always agree.

## For Mr. Robot

Mr. Robot reads and proposes levels for other Robots with robot_grants and robot_propose_grants. He proposes. The owner decides.
`
