# 13: The platform prompt

**What to build:** The platform prompt is rewritten and stays short: writing-style becomes Talking to {owner} with the rhythm (reply first, keep posted, never narrate mechanics, deliver in a say, short messages) and the voice (match length, lead with the result, no label preambles, no headings in chat, no em dash, mirrored emoji, plain words) (gb-3ih8, gb-gwes); how-you-work gains autonomy, initiative, the ladder of sources, the app rules and the two addressees for questions (gb-ycy1, gb-dqjy, gb-82o0, gb-aoqy, gb-84zu, gb-ej8r); Mr. Robot's role gains the chief rule (gb-2o04); a platform-skills section lists the visible skills; the prompt for a Robot with every group granted stays under 2 800 words, measured before and after in the closing note (gb-4wem). The prompt preview in Robot settings shows the new sections and the skills index (gb-dzf6).

**Blocked by:** 01, 02, 03, 04, 05, 10, 12

**Status:** done

- [x] Workerd test: the prompt sections render the new texts for a Robot and for Mr. Robot; the word count of the full-grant prompt is under the bound (gb-3ih8, gb-gwes, gb-ycy1, gb-dqjy, gb-82o0, gb-aoqy, gb-84zu, gb-2o04, gb-4wem)
- [x] Component test: the prompt preview shows the sections and the platform skills index (gb-dzf6)
- [x] Closing note records the word count before and after

## Closing note

The bound is measured with the prompt preview of a Robot that holds every tool group, with Auto review on: the Platform section and the rules of the mounted capabilities, without the memory files.

| | Platform section | With the capability rules |
|---|---|---|
| Before (v1.14, commit f55f2fb) | 2 179 words | 2 493 words |
| After (v1.15) | 2 468 words | 2 793 words |

The bound is 2 800 words. The test "stays under 2 800 words" in apps/worker/test/platform-prompt.test.ts keeps it. To stay under it, the docs index summaries became shorter, the rules of the Box and of Subagents became shorter, and the rule "a task stays open until its result reaches the owner" is now the rhythm rule "deliver the result in a say".

