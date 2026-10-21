# 10: The chief, the Coding Robot definition, the Add form, the coding skill, the prompt bound

**What to build:** Mr. Robot's defaults; the platform definition source and robots/coding-robot listed first; the Add form asking for the Workspace; the coding skill; the hosts skill and the source ladder; the bound raised to 3,000 with the measurement (cw-evn7, cw-wio5, cw-nm6y, cw-etsj).

**Blocked by:** 02, 04, 07

**Status:** done

- [x] Workerd test: the chief's defaults; the definition in the Marketplace; the Add form's Workspace reaching the setup Robot's prompt line; the skill in the index; the bound
- [x] Closing note: the prompt word count

## Closing note

The prompt word count: the platform prompt with the capability rules, for a Robot with every tool group, a Host's three facets and a Workspace, is **2,979 words** (Platform 2,638, places 172, subagents 108, logins 36, browser 25). It is 2,943 words without the Workspace. The bound is now 3,000 (it was 2,900 for every group without a Host). The margin is small: the next addition to the prompt should go into a skill.

Tests:
- apps/worker/test/platform-definitions.test.ts:
  - Mr. Robot has no Workspace and no Work details of his own, and his robot_settings_set offers `workspace {host, root}`. The deputy edit itself is tested in ticket 02.
  - The Marketplace lists coding-robot first: source platform, published, tools files, tasks and web, needs "a computer (files)" and "a computer (shell)". The admin's remove is refused with 400.
  - Adding it with a Workspace: the Robot in setup has the line "- Workspace: ~/repo on Desk (bash), chosen by your owner; it is set when your setup is approved.", and no Host call is made. After setup_complete and the owner's approval, the Workspace is checked on the Host and set (root and repository resolved). The runtime line is the static one of ticket 08, the catalog lists the coding skill, the source ladder names the Workspace, and the Fleet shows Code.
- apps/worker/test/platform-prompt.test.ts: the bound with a Host and a Workspace, under 3,000.
- apps/web/test/marketplace.test.tsx: Add on a definition that needs a computer opens the Workspace form (computer and folder), and the request carries `{ workspace: { host, root } }`.
- Tests that list the library's definitions now leave out the platform's. The platform skills list is eleven.

Decisions:
- Platform definitions: src/definitions/platform.ts holds the files as constants (README.md, SOUL.md, AGENTS.md, grants.yaml written with the platform's writer). The library serves them before its stored rows, for every Member, as source 'platform' and author "Mr. Robot (ships with the platform)". They cannot be removed, unpublished or shadowed: a stored definition, a saved one or the repository's sync, cannot take the slug. Download works for them like any other.
- The Coding Robot: tools files, web and tasks at allow. Host facets files and shell at allow, mapped to each of the owner's Hosts at setup, as v1.18 does; the sandbox and the Workspace's write roots still confine them. No box, no browser. lsp comes with the Workspace's files facet. Code as Work details comes from having a Workspace (ticket 07's default), so the definition needs no field for it. The definition form is unchanged.
- The Add form (cw-nm6y): a definition whose grants.yaml names Host facets asks, on Add, for one of the Member's computers and a folder. "Add without a Workspace" stays possible. POST /api/definitions/:slug/add takes an optional `{ workspace: { host, root } }`. The Space checks only that the Member reaches the computer, and stores the choice with the installed definition. The Robot in setup sees it in its runtime line without a Host call. When an approval leaves the Robot active, the Robot checks the choice on the Host, as an owner's choice is checked (ticket 02), and keeps it ("The Add form set the Workspace to …"). If the check fails, a notice in the Conversation says why and points to the settings. This is done once.
- The coding skill (audience: a Robot with a Workspace) has instructions first, read before edit (the hash refusal), the repository's tests and commit style, no push unless told, lsp before a rename, no cloning, secrets (.env, keys, tokens), the worktree's limits and installing dependencies, asking once with a recommendation, and the final report. The hosts skill gains "Your Workspace": name it with on "workspace", and load coding. The source ladder's Host rule gains "your Workspace, when you have one, is where your work on its repository happens".
- cw-evn7 needed no code beyond the tests: Mr. Robot gets no Workspace by default, keeps his Host grants (files and shell at ask), gives Tasks, reads Conversations and sets Workspaces through the deputy tools.

Review findings: #36 fixed (the Add form carries the Workspace, and setup knows it without the Host). #37 fixed (the definition is a platform source, not the library repository's). #38 (lsp under files) holds. #39, #40: the bound and its measurement are recorded above.
