export const ASKS_AND_HELP = `# Asks and need_help

An Ask is a pending decision that a Robot puts to its owner. The Conversation shows it in place of the composer. The composer is the message input. When there are several Asks, the oldest shows first, with a count. The owner answers, and the composer returns. The owner can also reply with text instead.

## Kinds of Ask

| Kind | What it asks |
|---|---|
| setup | Approve the Grants at the end of setup. |
| grants | Approve a Grant proposal from propose_grants. |
| member-file | Approve a new full version of USER.md or PROACTIVE_PREFERENCES.md. |
| skill | Approve a local skill for the Home library. |
| takeover | Take over the Robot's browser. |
| review | Approve a list of items, one by one or all at once. |
| thread | Accept or decline a Thread invitation, and set its Scope. |
| tool-call | Approve or reject one call of a tool at the ask level. |
| help | Answer a need_help request. |

The platform stores each Ask exactly. When the owner approves, the platform applies the stored Ask. It does not apply prose from the Conversation.

## Tool-call Asks

A tool-call Ask comes from a grant item at the ask level. Read grants.md. One approval covers one call. Only the owner answers a tool-call Ask. Mr. Robot never approves it.

## need_help

Call need_help when you are stuck. Do not chat with other Robots to get help. need_help takes four fields:
- doing: what you are doing.
- tried: what you tried.
- need: what you need.
- urgent: true or false.

Write the request in your owner's language. Every Robot except Mr. Robot has need_help. It needs no recipient Grant.

What happens next:
1. The platform creates an Ask of kind help in your Conversation. Your owner sees it at once and can answer in text.
2. Your Turn ends as waiting for help. You use no tokens while you wait.
3. If your owner does not answer within 30 minutes, Mr. Robot wakes with your request. If the request is urgent, he wakes at once.
4. Mr. Robot reads what he needs. He can read your Conversation, files and settings. Then he answers.
5. The answer wakes you as a labelled reply. For example: "Mr. Robot answered your request". Then you continue.

Only urgent requests skip the 30 minutes. Use urgent when waiting costs the owner something.

## One answer per request

An answered request is closed. Mr. Robot is not woken for it again. You get one answer per request. A second answer is refused. The owner is the exception. If the owner answers a request that Mr. Robot already answered, you get the owner's answer as a new labelled message. The owner sees the whole exchange and can override Mr. Robot.

## Mr. Robot's part

Mr. Robot has two tools for this:
- help_requests: lists the open requests of the owner's Robots.
- help_answer: takes a request id and a text, and answers the request.

help_answer works only on help Asks. It refuses a tool-call Ask. Mr. Robot has no chief, so he has no need_help.

## Messages between Robots

need_help is not robot_send. robot_send sends a work request to a Robot you have a recipient Grant for. To message Mr. Robot with robot_send, you need that Grant. need_help always works.
`
