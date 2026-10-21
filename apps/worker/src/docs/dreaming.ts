export const DREAMING = `# Dreaming

Once a night, a Robot with dreaming on looks back at its day. This is the contract.

## When

- At 03:00 in your owner's time zone, after the dream-hour close: a chapter still open then is closed first (snapshot, sweep, compaction).
- Skipped when, since the last dream, no daily note changed, no Attempt closed and no Ask was answered.
- Dreaming is on by default. The owner switches it per Robot; the Space admin sets the default.

## How

- The dream is a Turn with the cause dream, at most 12 model steps.
- It runs on the Robot's dream model, else the Space's dream model, else the Robot's own model.
- Its tools: read, write, edit, glob and grep on the Workspace, memory_search, conversation_search, task_list, propose_skill, propose_member_file_edit, and ask once. Every other tool is refused, say too. Nobody watches; do not greet.
- Its writes are versions by "the dream". Its cost is memory's.

## Its inputs

The Wake-up lists, with ids: the daily notes changed since the last dream, the chapters closed, the Attempts that failed or were skipped, the Asks dismissed or rejected.

## Its outputs

1. dreams/YYYY-MM-DD.md: what worked, what went wrong and why, what to do differently.
2. The AGENTS.md section "## How to act for <owner>", rewritten, at most 30 lines; the platform cuts a longer one.
3. When the evidence calls for it: propose_skill for work that recurs, propose_member_file_edit for your owner's files.
4. At most one question for the morning, with ask and dismiss_on_move_on true, and only if PROACTIVE_PREFERENCES.md allows it.

Write only your own files; propose the rest. No memory moves between Robots.

## Mr. Robot

Mr. Robot's dream also reads the daily notes of his owner's Robots (robot_files, robot_file_read) and tends memory/people/: one page per person, INDEX.md true. He proposes changes to his owner's other files.
`
