# 03: ask: one question to the owner

**What to build:** A tool ask puts one question to the owner: prompt, help text, up to six options (label, value, description, style default | primary | danger), allow_custom, dismiss_on_move_on, urgent (gb-b4wz). It stores an Ask of kind question and returns at once (gb-htdw). The AskBar shows the options as buttons, a text field when allowed, and Dismiss (gb-k88x). The answer wakes the Robot as a steer labelled with the Ask id and the value; a dismissal wakes it with that fact (gb-1lfb, gb-ewfe). dismiss_on_move_on dismisses the question on the owner's next message (gb-nr8s). urgent pushes "needs you" at once, otherwise the existing Ask notification path (gb-e5bs). On Discord the question is text with numbered options (gb-viep). The projection item kind question that shows grant proposals today is renamed proposal.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Workerd test: ask stores a question Ask and returns { askId, status: 'waiting' } without blocking the program (gb-b4wz, gb-htdw)
- [ ] Workerd test: an answer wakes the Robot as a steer with the label and the option value, or the custom text (gb-1lfb)
- [ ] Workerd test: a dismissal wakes once with the label; dismiss_on_move_on dismisses on the next owner message with the reason (gb-ewfe, gb-nr8s)
- [ ] Workerd test: urgent pushes 'needs you' at once; a plain question follows the Ask notification path (gb-e5bs)
- [ ] Workerd test: the Discord text form of a question (gb-viep)
- [ ] Component test: the question Ask with options, custom text, danger style and Dismiss (gb-k88x)
