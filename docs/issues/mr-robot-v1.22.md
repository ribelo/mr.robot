---
title: "Mr. Robot v1.22 — Tool discovery: one mode, a fixed declared set, every other tool found by search"
status: ready-for-agent
story-prefix: td
parent: mr-robot-v1.21.md
---

# Mr. Robot v1.22 — Tool discovery (revision 2: DSH-native)

## Problem Statement

A Robot's context carries the declaration of every tool its grants mount: in code mode the SDK block renders each bound tool with its description and parameters. The catalog grows with every plugin (places, Hosts, LSP, connectors, Subagents, memory, Pages) and a Wiser deployment measured ~205k tokens of declarations per request with 320 methods. Two mechanisms are ruled out by the owner: altering or shortening any declaration (a tool's text is its author's), and a generic call or execute wrapper (two calling conventions loop a model). Direct mode (native tool calls) still exists as a setting although the 2026-10-20 audit decided to remove it. Discovery must not invalidate the provider's prefix cache and must not accumulate anything over an endless Conversation.

## Solution

One mode: code mode, everywhere, setup included. Every tool stays registered and bound under its own name; nothing about calling changes. At the start of a chapter the Robot's tool set is restricted (DSH's restrict) to a fixed set that a Robot needs to talk and to work (say, ask, react, skill, request_credential) plus tool_search. tool_search finds the best matches among the tools the Robot's grants mount and lifts the restriction on them; DSH then announces them itself, as it announces any tool added during a session (a tool-addition developer message in the history; on routes that declare addition-only tool updates the request prefix is kept, on others DSH starts a new request series once, as for any tool change). Found tools stay available for the rest of the chapter; a new chapter starts restricted again, so the set is bounded by use. Declarations are never shortened; no wrapper; the prompt says one sentence.

## User Stories

1. As an owner, I want code mode to be the only mode: the codeMode setting, the direct-call composition and their UI and deputy fields removed, the setup interview running in code mode too, so that one calling convention exists ^td-2z82
2. As a Robot, I want every tool I may call to be bound in my program runtime under its own name, exactly as today, so that calling a tool never changes ^td-o271
3. As a Robot, I want my tool set restricted at the start of a chapter to a fixed set (say, ask, react, skill, request_credential and tool_search), so that the size of my tool catalog costs my context only what I use ^td-jj8e
4. As a Robot, I want tool_search({ query, limit? }) to find the best matches among the tools I hold and make them available, their full declarations arriving the way DSH announces any added tool, so that I learn a tool without anyone rewriting it ^td-x998
5. As a Robot, I want a call to a bound tool whose name I got wrong to fail with the top matches for that name, so that a guess costs one step ^td-qswl
6. As an owner, I want found tools to stay available for the rest of the chapter and a new chapter to start restricted again, so that the set is bounded by use and nothing is registered twice ^td-irxd
7. As an owner, I want discovery to use DSH's own tool-update path and nothing else, so that the cache behaves as it does for any tool change on that route and no harness change exists ^td-5z44
8. As an operator, I want the search index built at composition from the tools the Robot's grants mount, rebuilt when grants change, with field weights (name, namespace, description, parameter names) whose values come from a measured evaluation set, so that ranking is tuned on evidence, not taste ^td-gcoj
9. As an operator, I want an evaluation set of real queries with expected tools, kept in the repository, run as a test with a recall@5 floor, so that a ranking regression fails a test ^td-cpuu
10. As an operator, I want the token count of a Turn's first request measured before and after on a Robot with every group granted, recorded in the closing note, so that the gain is known ^td-ycsz
11. As a Robot, I want the prompt's tools section to say only that I find tools with tool_search and name nothing else, so that the prompt carries no catalog ^td-ndh4
12. As a Robot, I want a platform step (snapshot, sweep, dream, scrub) and a Subagent to have the same fixed set plus tool_search over their own fences, so that one mechanism holds everywhere ^td-szet
13. As an owner, I want the Trajectory to render a tool_search call with its query and the names it returned, so that I see what the Robot looked for ^td-5ito
14. As an owner, I want the glossary and docs to describe discovery in one paragraph, so that the words are one ^td-tdgy

## Implementation Decisions

- **One mode.** The codeMode flag, the direct composition branch, the settings field, the deputy field and the direct-mode tests go; the setup composition mounts the program runtime too; tests that pinned direct mode are rewritten in code mode.
- **Restriction, not a renderer change.** The composition registers every tool as today and applies DSH's restrict so that only the fixed set and tool_search are visible and callable; tool_search widens the restriction by name for its matches, and DSH's own tool-update path declares them (no change to the harness; no patch). The fixed set is a constant in the composition; nothing else may join it without a spec. A chapter seed starts with the fixed set; the chapter's found tools are not carried over.
- **tool_search.** A tool in the fixed set: query (text), limit (default 5, max 10). It ranks the mounted, grant-filtered tools with weighted keyword search (BM25; fields name, namespace, description, parameter names and descriptions; snake, kebab and camel splitting), lifts the restriction on the matches, and returns their names with one line each (the full declarations arrive through DSH's tool-addition message, verbatim). A call to a hidden tool by name fails with "not available; search for it" and the nearest names, so a guess costs one step. The index is built at composition and rebuilt when grants change.
- **Evaluation.** apps/worker/test/fixtures/tool-search-queries.json: at least 60 queries written from how a person would ask (in English and Polish), each with the expected tool names; a test asserts recall@5 ≥ 0.9 and prints the misses; the weights are constants with the measured values and the date. The closing note records the first request's token count before and after on a fully granted Robot, and the cache behaviour observed on the DeepSeek and the Anthropic routes.
- **Platform steps and Subagents.** The fences keep working on execution; a fenced step starts from the fixed set as well. Subagent child presets start restricted the same way.
- **Prompt and docs.** The tools section says: find a tool with tool_search; call it by its name in a program. Glossary: Fixed set, tool_search.

## Testing Decisions

Through the edge API in workerd with the scripted model (the stub model writes programs): a Robot with every group granted has the fixed set and tool_search in its SDK block and nothing else; tool_search returns verbatim declarations; a wrong name answers with matches; a found tool is callable in the next program; the declared set is byte-identical across two steps and after a compaction; a fenced step and a Subagent see the same set; the evaluation set's recall floor; the setup Robot runs programs; direct mode is gone (settings refuse the field). Component test: the Trajectory rendering of tool_search. The token measurement is recorded, not asserted.

## Out of Scope

MCP; a call or execute wrapper; shortening or rewriting any declaration; a change to the harness; a tool list in the prompt; embeddings; a native-call mode.

## Further Notes

Decisions from 2026-10-21 (evening). The owner asked that every tool of every plugin go through one mechanism, with a fixed set only for what an agent needs to talk and work, no wrapper, no MCP, and no cache breakage. The first draft of this spec invented a "bound but undeclared" mechanism with a harness patch and its own constraints (no accumulation, byte-identical declarations); the owner objected that DSH already has a mechanism, and it does: restrict plus the tool-update developer messages. The spec now uses that and nothing else. Zed's published result for the same ranking problem (weighted keyword search, weights measured on a query set) is the reference for tool_search. Direct mode leaves now because the 2026-10-20 audit decided it and no ticket did it.
