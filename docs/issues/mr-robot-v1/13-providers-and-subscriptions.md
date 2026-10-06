# 13: Providers, subscriptions and per-robot model

**Parent:** mr-robot-v1 (../mr-robot-v1.md) — stories robot-dic7, robot-82r5, robot-8gag, robot-40nw, robot-bden

**What to build:** A Member connects an OpenAI subscription and an Anthropic subscription by OAuth and adds DeepSeek, OpenRouter and Workers AI keys; credentials live with the Member and can be shared with the Home. The Home has a default model for new robots; each robot has one model and a thinking effort chosen in advanced settings.

**Blocked by:** 04 Robot creation interview, grant approval, Mr. Robot bootstrap

**Status:** done

- [x] OAuth flows complete from the PWA and refresh without the Member
- [x] A robot of another Member runs on a Home-shared subscription
- [x] Changing a robot's model applies on the next turn
- [x] Default model applies to newly created robots

Corrected 2026-10-07: until then no Turn could run on Claude, ChatGPT, OpenRouter or OpenCode Go (effort metadata used `label` instead of `name`), and the model list was typed in. Fixed, with Turns through each adapter tested (real-adapters.test.ts), Claude verified live and ChatGPT's adapter checked against the real service. See verification.md.
