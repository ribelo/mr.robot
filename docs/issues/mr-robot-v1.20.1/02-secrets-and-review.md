# 02: Secrets outlive a Turn; Auto review sees one bounded, redacted Turn

**What to build:** Decisions 3 and 4. Findings: cross#1, cross#2.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Workerd test: a secret revealed in Turn 1 and repeated by the model in Turn 2 is masked in session_event, chat_item, the FTS index and a cold chapter object; Pages, definitions, dream files and spill files masked at write
- [x] Workerd test: the reviewer stub receives only the current Turn, redacted, within the budget

## Closing note

Both findings confirmed in the code. Cross #1: the session redactor masked only the running Turn's revealed values (turnSecrets), not secretValues. Cross #2: the reviewer got session.snapshotEvents() whole and unredacted.

apps/worker/test/secrets-later.test.ts covers both:
- A value fetched in one Turn and repeated by the model in the next is absent from session_event, chat_item and chat_search, and from the cold chapter objects in R2 after the chapter aged out.
- A Page and a dream that repeat it hold the mask in R2, and a definition saved from a MEMORY.md that holds it carries no copy of it.
- With Auto review on, thirty allowed calls in one Turn get reviewer requests that hold no secret, nothing of the earlier Turn, and at most REVIEW_HISTORY_ITEMS history items.

Decisions:
- The redactor masks with every secret the Robot may read (secretValues, its granted entries) plus the Turn's revealed ones. secretValues is loaded again at each Turn's start, so a Grant change takes effect at the next Turn. Login entries have no TOTP seed in this codebase; their password is what is masked. Values shorter than three characters are still not masked (maskSecrets), as before. A two-character secret cannot be masked without masking ordinary text.
- Masking at write: the Robot's Workspace is wrapped by withWriteMask (workspace.ts). The text of a file under pages/, dreams/, spill/ or definition-draft/ is masked before it is stored. That covers the file tools, the spill store and job logs, which write through the same Workspace. Saving a definition masks every file, including tasks.yaml, whose Task instructions are copied verbatim. Other Workspace files are written as given (a Robot may need a value in a config file for the Box); the spec names only these four.
- Auto review reads the running Turn only (the events since the active Turn's start seq; a Subagent's session is its own Turn). Each history item is masked, and the history keeps the last items within REVIEW_HISTORY_ITEMS (24) and REVIEW_HISTORY_TOKENS (16 000, at four characters a token). The pending call's arguments are masked as well, so the reviewer's provider never receives a secret value.
- Spill files are masked by the same wrapper, but no test writes one.
