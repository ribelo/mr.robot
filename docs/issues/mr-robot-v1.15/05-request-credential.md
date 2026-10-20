# 05: request_credential

**What to build:** A tool request_credential (kind login | secret, service, why, websites, scope) stores an Ask of kind credential (gb-3192). The AskBar shows the Login entry form or the secret form pre-filled with what the Robot gave (gb-1g9w). Saving creates the entry under the owner, grants it to the Robot at allow and wakes the Robot with the entry's name; declining wakes it with the refusal (gb-923q, gb-7dl9). The password never reaches the Robot's program; login_fill is unchanged (gb-196l). Discord shows one line and a link into the app (gb-atqq).

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Workerd test: request_credential stores a credential Ask with its fields and returns at once (gb-3192)
- [x] Workerd test: saving creates the entry owned by the Member, grants it to the Robot and wakes it with the name; the Robot's program cannot read the password (gb-923q, gb-196l)
- [x] Workerd test: declining wakes the Robot with the refusal (gb-7dl9)
- [x] Workerd test: the Discord text form with a link (gb-atqq)
- [x] Component test: the credential Ask with the login form and the secret form (gb-1g9w)
