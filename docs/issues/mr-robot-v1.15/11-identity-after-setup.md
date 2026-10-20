# 11: Identity after setup

**What to build:** set_identity stays mounted after setup for title, description and avatar colour and the Robot tells its owner what changed; name is accepted only during setup and stays the owner's to change in the Robot's settings (gb-vipe, gb-4563).

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Workerd test: set_identity after setup changes title, description and avatar colour and refuses name with a clear error (gb-vipe, gb-4563)
- [x] Component test: the name field in Robot settings is the owner's; the Robot's change shows in the header and sidebar (gb-4563)
