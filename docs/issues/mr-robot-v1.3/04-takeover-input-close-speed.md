# 04: Takeover: keys, close semantics, cookie note, speed

**Parent:** mr-robot-v1.3 (../mr-robot-v1.3.md) — stories pl-485j, pl-vwq6, pl-glfh, pl-ju1l, pl-5agt, pl-n2vs

**What to build:** Keystrokes are captured while the takeover has focus and sent to the page; a phone keyboard button exists; closing the window hands back; the window states that cookies and logins persist; stage timings are recorded and the dominant cause of slow opening fixed, with two seconds on a warm backend as the target.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Typing in the takeover types into the page on the host browser and on Container Chrome
- [ ] Closing the window resumes the robot's task or closes an idle browser
- [ ] Timings per stage logged; before/after numbers in this ticket
- [ ] Warm open under two seconds measured live
