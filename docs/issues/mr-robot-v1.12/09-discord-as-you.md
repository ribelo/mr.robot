# 09: Discord as you: REST reader, write grant, two ways on the row

**Parent:** mr-robot-v1.12 (../mr-robot-v1.12.md) — stories ux-urf8, ux-l2ul, ux-gdg3, ux-s8rx, ux-cbo3

**What to build:** The Discord row offers two ways to connect, each with its own Connect: as a bot (unchanged) and as you (a pasted user token in this ticket). An as-you Connection gives Robots read tools (servers, channels, messages, threads, search, people) over Discord's REST API with the user token, no gateway, and write tools (send, reply, react, mark read) only behind the Connection's write grant. The form carries one sentence that Discord forbids this and may close the account. A 401 marks the Connection "Sign in again". As-you Connections are person connections and cannot be shared.

**Blocked by:** 08 (Person connections are never shared)

**Status:** done

- [x] Read tools and write tools against stubbed Discord REST; write tools absent without the write grant (workerd test)
- [x] 401 sets Sign in again (workerd test)
- [x] Row shows both ways with the warning sentence and no shared checkbox for as-you (component test)
