---
title: "Mr. Robot v1.22 — Tool discovery: one mode, a fixed declared set, every other tool found by search"
status: ready-for-agent
story-prefix: td
parent: mr-robot-v1.21.md
---

# Mr. Robot v1.22 — Tool discovery

## Problem Statement

A Robot's context carries the declaration of every tool its grants mount: in code mode the SDK block renders each bound tool with its description and parameters. The catalog grows with every plugin (places, Hosts, LSP, connectors, Subagents, memory, Pages) and a Wiser deployment measured ~205k tokens of declarations per request with 320 methods. Two mechanisms are ruled out by the owner: altering or shortening any declaration (a tool's text is its author's), and a generic call or execute wrapper (two calling conventions loop a model). Direct mode (native tool calls) still exists as a setting although the 2026-10-20 audit decided to remove it. Discovery must not invalidate the provider's prefix cache and must not accumulate anything over an endless Conversation.

## Solution

One mode: code mode, everywhere, setup included. Every tool stays bound in the program runtime under its own name; nothing about calling changes. Declared in the context: a fixed set that a Robot needs to talk and to work (say, ask, react, skill, request_credential) and tool_search. Every other tool is undeclared: tool_search returns full declarations of the best matches among the tools the Robot holds; a wrong name answers with the nearest matches. Discovered declarations live only in tool_search results in the history, so compaction removes them and the declared set never changes between steps. The prompt names no tool. The index is built from the mounted tools with weighted keyword search tuned on an evaluation set kept in the repository.

## User Stories

1. As an owner, I want code mode to be the only mode: the codeMode setting, the direct-call composition and their UI and deputy fields removed, the setup interview running in code mode too, so that one calling convention exists ^td-2z82
2. As a Robot, I want every tool I may call to be bound in my program runtime under its own name, exactly as today, so that calling a tool never changes ^td-o271
3. As a Robot, I want no tool declared in my context except a fixed set (say, ask, react, skill, request_credential and tool_search), so that the size of my tool catalog costs my context nothing ^td-jj8e
4. As a Robot, I want tool_search({ query, limit? }) to return the full declarations (name, description, parameters with their descriptions, token for token) of the best matches among the tools I hold, ranked, so that I learn a tool by reading its result ^td-x998
5. As a Robot, I want a call to a bound tool whose name I got wrong to fail with the top matches for that name, so that a guess costs one step ^td-qswl
6. As an owner, I want discovered declarations to live only in tool_search results in the history, never registered, never written to memory or prompt, so that nothing accumulates over an endless Conversation ^td-irxd
7. As an owner, I want the declared set and the prompt to be identical from one step to the next, so that the provider's prefix cache is never invalidated by discovery ^td-5z44
8. As an operator, I want the search index built at composition from the tools the Robot's grants mount, rebuilt when grants change, with field weights (name, namespace, description, parameter names) whose values come from a measured evaluation set, so that ranking is tuned on evidence, not taste ^td-gcoj
9. As an operator, I want an evaluation set of real queries with expected tools, kept in the repository, run as a test with a recall@5 floor, so that a ranking regression fails a test ^td-cpuu
10. As an operator, I want the token count of a Turn's first request measured before and after on a Robot with every group granted, recorded in the closing note, so that the gain is known ^td-ycsz
11. As a Robot, I want the prompt's tools section to say only that I find tools with tool_search and name nothing else, so that the prompt carries no catalog ^td-ndh4
12. As a Robot, I want a platform step (snapshot, sweep, dream, scrub) and a Subagent to have the same fixed set plus tool_search over their own fences, so that one mechanism holds everywhere ^td-szet
13. As an owner, I want the Trajectory to render a tool_search call with its query and the names it returned, so that I see what the Robot looked for ^td-5ito
14. As an owner, I want the glossary and docs to describe discovery in one paragraph, so that the words are one ^td-tdgy

## Implementation Decisions

- **One mode.** The codeMode flag, the direct composition branch, the settings field, the deputy field and the direct-mode tests go; the setup composition mounts the program runtime too; tests that pinned direct mode are rewritten in code mode.
- **Declared versus bound.** The program runtime keeps every tool bound and callable through the existing gates (grants, ask gate, Auto review, step fences, presentation). The SDK block renders only the fixed set and tool_search. This needs the harness to honour its own deferLoading mark in the program-runtime renderer while keeping the binding; make that change in the harness's vocabulary, carry it as a local patch of the dependency, and open the upstream change. The fixed set is a constant in the composition; nothing else may join it without a spec.
- **tool_search.** A tool in the fixed set: query (text), limit (default 5, max 10). Result: the matches as the SDK would have rendered them (name, description, parameters and their descriptions, verbatim), ranked. A call to a bound but undeclared name that does not exist answers with "no such tool; nearest: …" from the same ranking. The index: one document per mounted tool with fields name, namespace (the plugin or connector), description, parameter names and descriptions; keyword ranking (BM25) with per-field weights, token splitting of snake, kebab and camel case, grant-filtered at build (a tool the Robot cannot call is not indexed), rebuilt on grant change (a composition rebuild already happens then).
- **Evaluation.** apps/worker/test/fixtures/tool-search-queries.json: at least 60 queries written from how a person would ask (in English and Polish), each with the expected tool names; a test asserts recall@5 ≥ 0.9 and prints the misses; the weights are constants with the measured values and the date. The closing note records the first request's token count before and after on a fully granted Robot.
- **Platform steps and Subagents.** The fences keep working on execution; a fenced step's declared set is the fixed set plus tool_search (a refused tool is still refused at call). Subagent child presets declare the same.
- **Prompt and docs.** The tools section says: find a tool with tool_search; call it by its name in a program. Nothing else about tools in the prompt. Glossary: Declared tool, Bound tool, tool_search.

## Testing Decisions

Through the edge API in workerd with the scripted model (the stub model writes programs): a Robot with every group granted has the fixed set and tool_search in its SDK block and nothing else; tool_search returns verbatim declarations; a wrong name answers with matches; a found tool is callable in the next program; the declared set is byte-identical across two steps and after a compaction; a fenced step and a Subagent see the same set; the evaluation set's recall floor; the setup Robot runs programs; direct mode is gone (settings refuse the field). Component test: the Trajectory rendering of tool_search. The token measurement is recorded, not asserted.

## Out of Scope

MCP; a call or execute wrapper; shortening or rewriting any declaration; any tool list in the prompt, memory, skills or definitions; registering discovered tools; embeddings; a native-call mode.

## Further Notes

Decisions from 2026-10-21 (evening), with what was weighed. The owner rejected, in order: a help tool with derived names, shortened descriptions, a generic call wrapper, anything in the prompt, and any accumulation of discovered tools; then asked that every tool of every plugin go through the one mechanism, with a fixed set only for what an agent needs to talk and work. Zed's published result for the same problem (weighted keyword search over a few hundred tools, weights measured on a query set) is the reference; the evaluation set is the owner's "measure, don't guess". Direct mode leaves now because the 2026-10-20 audit decided it and no ticket did it.
