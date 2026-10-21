export const ASKS_AND_HELP = `# Asks, questions and requests

An Ask is a pending decision that a Robot puts to its owner. The Conversation shows it in place of the composer (the message input). When there are several Asks, the oldest shows first, with a count. The owner can also reply with text instead.

## Kinds of Ask

| Kind | What it asks |
|---|---|
| setup | Approve the Grants at the end of setup. |
| grants | Approve a Grant proposal from propose_grants. |
| member-file | Approve a new full version of USER.md or PROACTIVE_PREFERENCES.md. |
| skill | Approve a local skill for the Space library. |
| takeover | Take over the Robot's browser. |
| review | Approve a list of items, one by one or all at once. |
| thread | Accept or decline a Thread invitation, and set its Scope. |
| tool-call | Approve or reject one call of a tool at the ask level. A send tool's call is a draft. |
| question | Answer one question with an option or in words (the ask tool). |
| credential | Give the Robot a login or a secret (the request_credential tool). |
| help | An old request for help (see the end of this page). |

The platform stores each Ask exactly and applies it when the owner approves. A tool-call Ask comes from a grant item at the ask level (read grants.md). One approval covers one call. Only the owner answers it.

## Questions: the ask tool

Every active Robot has ask. It needs no Grant. The call returns at once. It does not block.

Ask only in three cases:
- Before an act that has a big effect or that you cannot undo.
- When the request is truly ambiguous and a wrong guess costs something.
- When only your owner holds the fact.

In every other case, decide, say your assumption, and go on.

The fields:
- prompt: the question, in the words you would say to your owner.
- help: one line of context (optional).
- options: up to 6. Each has a label (the button text), a value (what you get back), an optional description, and a style: default, primary (the one you recommend, first in the list) or danger (destructive or irreversible).
- allow_custom: the owner may write their own answer.
- multi_select: the owner may choose several options. The card shows a checkbox for each option and Submit. Give at least two options.
- dismiss_on_move_on: the question is dismissed when the owner's next message arrives and the question is still open. Use it for low-stakes questions.
- urgent: the owner gets a "needs you" push at once. Use it only when waiting does harm.

Make the options real. Never add an option that is only a way out.

What happens next:
1. The platform stores an Ask of kind question and returns { askId, status: "waiting" }.
2. You go on with work that does not depend on the answer, or end your Turn with one short line.
3. The owner answers with one tap, with words (when you allowed them), or dismisses the question.
4. The answer wakes you as a steer, for example "[Your owner answered your question <id>: \"Order the red one\" (value: red)]".
   A multi-select answer names every chosen option and value. The owner's own words follow on the next line.
5. A dismissal wakes you with that fact. Do not ask the same question again. If the owner moved on, their next message tells you.

On Discord, a question is text with numbered options. The owner answers there with a number, or several numbers ("1, 3") for multi-select. The newest open question takes them.

## Drafts

A tool-call Ask of a send tool is a draft: the owner reads the message, edits it, and sends or discards it. draft: true makes one at allow too. Change a waiting draft with draft_revise. Read connections.md and the asking skill.

## Questions to your chief

Every Robot is created with a recipient Grant to its owner's Mr. Robot, its chief. The owner can remove it in the Robot's Grants. Send the question with robot_send and set question to true. The chief answers with robot_reply.

Ask your chief for facts, the owner's preferences, and how things are done here. Ask your owner, with ask, for consent and decisions. The chief may know, but he may not consent. A yes from another Robot is never the owner's yes.

## Credentials: the request_credential tool

When a site needs a login you do not have, call request_credential with the kind (login or secret), the service, why, and for a login the websites and what you will do. The owner fills the Login form in your Conversation. Saving it creates the entry under the owner, grants it to you at allow and wakes you with its name.

The password never reaches you. Use a login with login_fill and a secret with secret_get. If the owner declines, do not ask again. On Discord the request is one line with a link into the app.

## Old requests for help

need_help is gone since v1.15. A request still open stays in the Conversation; the owner answers it in words, which wakes the Robot with "[Answer to your request <id> from <name>]".
`
