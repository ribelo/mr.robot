# 19: OpenCode Go as a Provider with key rotation

**Parent:** mr-robot-v1 (../mr-robot-v1.md) — stories robot-82r5, robot-7v9s, robot-dic7

**What to build:** OpenCode Go (opencode.ai/zen/go) becomes a Provider, with every model of its offer
selectable per Robot. A person keeps several OpenCode Go keys. When a key runs out (monthly limit,
credits or funds) or is rejected, the request moves to the next key and that key becomes the active
one, as the DSH opencode-go-session plugin (~/projects/ribelo/dsh/opencode-go-session) does. A
Conversation keeps using the key that last worked for it. Keys can be shared with the Home like any
Provider credential.

**Blocked by:** 13 Providers, subscriptions and per-robot model

**Status:** done

- [x] Every OpenCode Go model is in the model list with its context window and price, on the right wire format (chat completions, Anthropic Messages, or Responses)
- [x] Requests carry `x-opencode-session` with the Robot's session id
- [x] A person adds, activates and removes OpenCode Go keys in the PWA; keys are encrypted and shown masked
- [x] On a quota or authentication failure the next key is tried and promoted to active; a manual choice made meanwhile wins
- [x] A session sticks to the key that last succeeded for it
- [x] Responses-API requests whose encrypted reasoning was issued to another key are retried without it
