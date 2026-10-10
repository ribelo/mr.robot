# 01: Sign-in in the system browser

**Parent:** mr-robot-v1.10 (../mr-robot-v1.10.md) — stories pa-e7xj, pa-4sr1, pa-6ljh

**What to build:** The desktop app opens pages outside the server and the Access sign-in in the system browser; the Google callback works without an Access session and ends with a 'return to the app' page.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Electron prevents will-navigate/will-redirect off the server and Access domains and opens them externally
- [x] Consent state names the Member; callback route bypasses Access (alchemy bypass app); external consents end on a small HTML page
- [x] Workerd test: callback without Access identity completes for the Member in the state
