# 03: Draft cards: send tools at ask rendered as messages, edit, Send, Discard

**What to build:** Send tools declare a draft capability; a tool-call Ask of one of them renders as a message card with recipients, subject, Markdown body and attachments; the owner edits body and subject in the card and Send sends exactly that; Discard rejects with a reason; draft: true produces the card at allow; e-mail bodies go out as HTML plus text; Discord shows text and a link; old Asks still render (dp-si4p, dp-wd2q, dp-qbt7, dp-yhn7, dp-ky1h, dp-1tk6, dp-gsf8, dp-f0pp).

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Workerd test: a send Ask is typed as a draft; Send delivers the edited body and subject to the connector stub; Discard rejects with the reason; draft: true at allow; the Gmail stub receives HTML and text parts; the Discord form; a dismissed draft wakes the Robot; old Asks render (dp-si4p, dp-wd2q, dp-qbt7, dp-yhn7, dp-ky1h, dp-1tk6, dp-gsf8, dp-f0pp)
- [x] Component test: the draft card with edit, Send and Discard (dp-si4p, dp-qbt7)
