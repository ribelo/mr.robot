export const PROVIDERS = `# Providers, models and limits

A Provider is a model source. The Providers are ChatGPT (an OpenAI subscription), Claude (an Anthropic subscription), DeepSeek, OpenRouter, Workers AI and OpenCode Go.

## Accounts

A person can add many accounts to a Provider. An account is an API key or a sign-in with OAuth. Each account has a label. A person renames it. The label of an OAuth account is the e-mail when the Provider shows it.

An account belongs to its Member. The Member can share it with the Home. A Member who may use a shared account never sees its secret. The owner of a shared account sees which Robots have it in their chain.

The Home admin sets the default model for new Robots. Model lists are live: each Provider shows its current models. The admin can refresh them. A Robot cannot be created with a model whose Provider has no account.

## Model chain

Each Robot has an ordered model chain. An entry has an account, a model and a thinking effort. The owner orders the entries by drag and drop in the Advanced settings. Mr. Robot can set the chains of other Robots. Nothing changes order by itself.

A Robot runs on the first usable entry. If the account of that entry hits a limit or breaks, the Robot goes to the next entry. It says so in the Conversation and continues its work. When an earlier entry works again, the next Turn goes back to it. A line in the Conversation says so.

## Account states

- ok: the account works.
- limited: the account hit a limit. The platform skips it until the reset time. When the Provider gives no reset time, it skips the account for one hour.
- broken: the subscription ended, a payment failed or a token was revoked. The platform tells the owner once. It tries the account again after 6 hours. The owner can use Check now to test it at once.

If every entry is unusable, the Robot is blocked. The owner is told. The Robot resumes by itself at the earliest reset.

## Usage

Each Claude and OpenCode Go account shows its usage windows in the profile: the percent used and the reset time. The page refreshes them when it opens and caches them for a minute. If the Provider gives no usage, the page says "usage unavailable".

The platform counts tokens and cost per Robot and per Member. Exa calls and browser minutes count too.

## Spend limit

A Spend limit is a monthly cap on tokens or cost. It exists per Robot and per Member. When a Robot crosses it, the Robot is blocked and the owner is told. The Robot stops and says so. The owner raises the limit, and the Robot continues. A Home default applies unless the owner changes it.

## Context budget

The context budget sets how much a Robot keeps in its context. A small budget is cheap. A large budget keeps a long memory. Compaction shortens the context when it is full.

## Tips

- Put the cheapest good model first and a stronger one after it.
- Put accounts of different Providers in one chain, so one limit does not stop the Robot.
`
