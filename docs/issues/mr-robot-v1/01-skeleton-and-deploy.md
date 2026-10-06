# 01: Repository skeleton and first Cloudflare deploy

**Parent:** mr-robot-v1 (../mr-robot-v1.md) — stories robot-7v5x, robot-q7rj, robot-ajrp, robot-h3vr

**What to build:** A Member opens the deployment URL on a phone, signs in with a one-time e-mail code through Cloudflare Access, and sees the installable PWA shell with an empty robot list. Under it: the pnpm workspace with Effect v4, the pinned DeepSeek Harness packages, the Alchemy stack declaring the edge Worker, the Robot/Member/Home Durable Object classes, the R2 bucket and the Access application, deployed to the owner's Cloudflare account from this repository. The Member DO is created on first sign-in and joined to the one configured Home; the first Member is admin.

**Blocked by:** None (can start immediately)

**Status:** in-progress

- [x] Alchemy deploy from a clean checkout creates every declared resource and prints the URL
- [ ] Signing in with e-mail OTP creates the Member and the Home on first visit; a second sign-in reuses them
- [ ] The PWA shell is installable on Android and shows an empty robot list
- [x] An Alchemy plan test asserts the declared resources
- [x] A dependency lint forbids Node-bound DSH packages and Effect imports inside DSH packages

**Pending:** deployed at https://mrrobot-edge-live-ribelo-ffe667mhzh4ttltx.r-krzywaznia-2c4.workers.dev behind Access (team withered-snow-6eaa). The first e-mail-code sign-in and installing on Android are the owner's to do on the phone.
