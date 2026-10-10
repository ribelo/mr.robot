# 07: need_help escalation to Mr. Robot

**Parent:** mr-robot-v1.11 (../mr-robot-v1.11.md) — stories sk-35i9, sk-myhb, sk-gag7, sk-q86i, sk-cj9v, sk-iis1, sk-fmvh

**What to build:** An unanswered request wakes the owner's Mr. Robot after 30 minutes, at once when urgent, with a platform message naming the Robot and carrying the request. Mr. Robot has help_requests (open requests across the owner's Robots) and help_answer(request_id, text); his answer wakes the Robot as "Mr. Robot answered your request" and closes it. The owner sees the answer and may answer afterwards (delivered as an override). Mr. Robot cannot answer tool-call Asks. The Robot panel lists open requests.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] Alarm-based escalation with fake-time workerd tests for 30 minutes and urgent
- [ ] help_requests and help_answer; closed request refuses a second answer except the owner's override; help_answer on a tool-call Ask refused
- [ ] Open requests in the Robot panel
