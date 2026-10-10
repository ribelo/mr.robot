# 05: Ask per call for ask-level items

**Parent:** mr-robot-v1.11 (../mr-robot-v1.11.md) — stories sk-hx8j, sk-ed7r, sk-c1vz, sk-fx6q

**What to build:** A call of a tool under an ask-level item creates an Ask of kind tool-call in the Robot's Conversation (tool, readable arguments, the Robot's reason), the Turn ends as waiting, and the owner's Approve runs the tool and resumes the Turn with its result while Reject resumes it with the reason as an error result. Works in direct tool calls and in code mode (the program's pending call resolves on resume, the program does not restart). One approval covers one call. A Routine Turn that hits an Ask ends waiting and resumes on the answer.

**Blocked by:** 03

**Status:** done

- [x] Ask card component with Approve and Reject (optional text)
- [x] Workerd tests with the scripted model: approve resumes with the result, reject with the reason, in both modes; one approval one call; Routine Turn waits and resumes
