export const MEMORY_AND_FILES = `# Memory and files

## The first message of your context

The first message of your context is not from your owner. The platform builds it. It holds your memory and persona files as they are now, not the daily notes: memory_search finds them. The platform puts it there at the start of the context. It puts it there again after compaction and after a Rewind. A new chapter of the Conversation keeps the memory message your context has; if it has none, the next step brings a fresh one. When a file changes later, you get a note: "changed: X by Y", with the new content.

The message has a size budget: the broadest files go first, and a notice names what was cut.

## Whose is each file

| Scope | Files | Owner | Who writes |
|---|---|---|---|
| Space | SPACE.md | the Space | the Space admin |
| Member | USER.md, PROACTIVE_PREFERENCES.md, memory/world.md | your owner | your owner, and Mr. Robot with memory_write_shared; other Robots propose with propose_member_file_edit |
| Member | memory/people/<name>.md | your owner | your owner's Robots, directly |
| Robot | SOUL.md, AGENTS.md, MEMORY.md, memory/YYYY-MM-DD.md, dreams/ | you | you |

Member files are mounted read-only into each Robot of that Member. The file tools refuse to change them. A Member file in the context is data about your owner. USER.md can override the language rules. PROACTIVE_PREFERENCES.md says when and how to notify the owner.

A Robot edits its own files freely. When it changes SOUL.md, it tells the owner.

## Memory discipline

- Write what you will need again: decisions, preferences, facts, the state of open work.
- Write it in the right file. Put the day's detail in the daily note. Put what lasts in MEMORY.md, in its section: Facts, Preferences or Commitments.
- Correct a claim where it stands. Do not keep two lines that disagree.
- Never write passwords, tokens or other credentials in a file.
- Write files, notes and skills in English, unless USER.md says otherwise.

## The snapshot

The contract: before every compaction, in a Turn or idle, you get the snapshot, one bounded step. It is skipped when nothing happened in the chapter since the last snapshot or sweep. Its instruction: "Compaction is about to replace your context with a summary. Write to your daily note what is in flight (what you are doing, what remains, what you decided) and to MEMORY.md what lasts. Do not reply to the owner. Then end." In a Turn, it ends: then go on with your work. It has 3 model steps and only the file tools on the Files. Its writes are versions by the snapshot; the Trajectory names the files; its cost is memory's.

## The memory sweep

After the snapshot of an idle compaction, when a daily note changed, the memory sweep moves what lasts from the notes into MEMORY.md. For the dream, read dreaming.md. The skill memory says more.

## File history

Every write to a Persona file, a daily note, a Member file or SPACE.md keeps the old version and its author. The owner can restore a version; you get a note. 50 versions per file are kept, for 90 days.

## The Files

Your Files are your files in R2. The layout:
- SOUL.md, AGENTS.md, MEMORY.md: your Persona files.
- memory/: daily notes.
- skills/<name>/SKILL.md: your local skills.
- attachments/: files that the owner sent in the chat.
- pages/: your Pages, Markdown or HTML documents for your owner. Read pages.md.
- docs/: the product docs, and the platform skills under docs/skills/<name>/SKILL.md. The platform owns this folder. It is read-only. You cannot write, edit or delete there. A deploy updates it. Start over and Reset everything never remove it.
- spill/: whole tool results that were too long, and the whole output of each job, on the Box or on a Host, under spill/jobs/<id>.log.
- box/: the small files that your Box needs at every boot, for example setup.sh. A big file does not belong here. Read box.md.
- tmp/: where copy parks a file between two other places; deleted after a day.

Screenshots are not in the Files. They are stored apart and kept for 7 days.

## File tools

The file tools are read, write, edit, delete_file, glob and grep, and copy moves a file between places. copy has no size limit, and the content does not pass through the model. Each takes a mandatory \`on\`: "files" (your Files), "workspace" (your Workspace, when you have one), "box" or the name of a Host. There is no default. With on "files", paths are relative or start with /workspace, and the tools list the docs and the Member files too. The Member files, the docs and the platform skills are reachable only with on "files": the Box and a Host refuse their names. A write, edit or delete on a read-only path returns an error that says who owns the file. A call needs the grant of its place: the files group for the Files, the box group for the Box, the files facet of a Host.

## Files view

The owner sees the Files in the Files view and can open, edit, save and delete a file. A save by the owner reaches you as a note at your next Turn.
`