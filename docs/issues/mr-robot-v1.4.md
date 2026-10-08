---
title: "Mr. Robot v1.4 — the frontend on Effect Atom; zustand and TanStack removed"
status: ready-for-agent
story-prefix: fe
parent: mr-robot-v1.3.md
---

# Mr. Robot v1.4

## Problem Statement

The owner's rule for this project is Effect everywhere with as few dependencies as possible. The web app does not follow it: state is on zustand (through the DSH client store pulled in by pieces copied from the DeepSeek Harness client), long lists use @tanstack/react-virtual, API calls are hand-written fetch and the live socket is a hand-written WebSocket. The owner does not port the DSH UI; he asked for its behaviour and look, not its code and libraries.

## Solution

Move the whole frontend to Effect: state in Effect Atom (@effect/atom-react), API through Effect HttpClient with Schema from the shared protocol, the live socket as an Atom stream. Rewrite the copied DSH pieces (trajectory ledger, conversation grouping, tool cards) on Atom with the same behaviour and look. Replace the list library with a small virtualiser of our own. Remove zustand, immer and every @tanstack package from the dependency tree and guard against their return. Nothing visible changes.

## User Stories

### Frontend on Effect

1. As the owner, I want the web app's state held in Effect Atom (@effect/atom-react), so that the frontend uses the same foundation as the rest of Mr. Robot ^fe-2hh0
2. As the owner, I want API calls made with Effect HttpClient and decoded with the Schema definitions from the shared protocol package, so that every response is typed at the boundary and failures are values ^fe-tln3
3. As the owner, I want the live WebSocket exposed as an Atom stream, so that conversations, hosts and unread state update through one mechanism ^fe-xp06
4. As the owner, I want zustand, immer and every @tanstack package removed from the dependency tree, not only from our code, so that the frontend has no second state library ^fe-mza0
5. As the owner, I want the pieces copied from the DeepSeek Harness client (trajectory ledger, conversation grouping, tool cards) rewritten on Atom with the same behaviour and look, so that nothing in the app depends on the DSH client store ^fe-3lfp
6. As the owner, I want long lists (conversation, trajectory) virtualised by a small component of our own, so that long conversations stay fast without a list library ^fe-3ckb
7. As the owner, I want the DSH Markdown, code highlighting and math rendering kept, so that only state and list libraries change ^fe-2mf9
8. As a person, I want every screen to behave exactly as before the migration, so that the rework is invisible ^fe-4miu
9. As the owner, I want a dependency check that fails the build when zustand, immer or a @tanstack package appears, so that they do not come back ^fe-iqay

## Implementation Decisions
- State: Effect Atom (@effect/atom-react) for application state (robots, conversation, hosts, unread, settings, asks, takeover); React local state only for transient form input.
- API: one Effect HttpClient layer; every endpoint decoded with Schema from the shared protocol package; errors are typed values rendered by the shared error state.
- Live: the Robot DO and Member DO WebSocket feeds become an Atom stream; consumers subscribe through atoms.
- DSH-derived code: the trajectory ledger, timing overview, conversation grouping and tool cards are rewritten on Atom, keeping their behaviour, icons and layout; the DSH client store, zustand and immer are dropped; DSH Markdown, shiki and KaTeX rendering stay.
- Lists: a small windowing component of our own for conversation and trajectory.
- Guard: the existing dependency lint also fails on zustand, immer and any @tanstack package in the web app's dependency tree.
- Non-negotiable per owner: no TanStack anywhere.

## Testing Decisions
1. Existing web component tests pass unchanged where behaviour is unchanged; tests coupled to the removed stores are replaced, not repaired (fe-3lfp, fe-3ckb, fe-2mf9, fe-4miu).
2. Dependency lint run proves the tree (fe-mza0, fe-iqay).
3. Live check of every screen after deploy, with screenshots compared to the v1.3 polish ticket (fe-4miu).

## Out of Scope
Visual changes; new features; the desktop app's main process.

## Further Notes
The owner's words: the TanStack stack goes, no negotiation; the trajectory was to be reproduced, not copied 1:1.
