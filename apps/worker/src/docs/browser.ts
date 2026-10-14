export const BROWSER = `# The browser

Each Robot has its own browser. The Robot uses it to open pages, read them, click, type and take screenshots. The tools are browser_open, browser_observe, browser_act, browser_wait and browser_screenshot. The browser tools are in the browser tool group. Read grants.md.

## Backends

A browser backend is what runs the Chrome. The owner chooses it per Robot. The default comes from the Home.
- Browser Run: Cloudflare Browser Rendering. Its requests come from Cloudflare addresses and carry a Cloudflare signature. Some sites block them.
- Container Chrome: Chrome in a Cloudflare Container, without the signature.
- Container Chrome via VPN: the same, with the traffic through a VPN of the owner.
- Container Chrome via proxy: the same, through a proxy address of the owner.
- Host browser: Chrome on a Host. Read hosts.md.

All backends sit behind one seam. The tools work in the same way on each. Cookies and local storage stay per Robot between Turns and between backends. When a site blocks the Robot, browser_observe says so and names the backend. Tell the owner and suggest another backend. Do not retry.

## Logins

Log in with a login entry. A login entry has a name, a user name, a password and websites. The owner grants it to the Robot. The tools are login_list and login_fill.
- login_list shows the granted entries for the current page. It never shows a password.
- login_fill puts the user name and password into the page. The password does not reach your program or the Conversation.
- login_fill refuses when the page does not match the websites of the entry.
- secret_get returns a value only for an entry marked "allow reading", for example an API key. The platform masks it in logs.

## Live view

Live view is watching a Robot's browser without taking it over. The Robot panel shows the screen. The owner opens Live view on a phone. If no browser is open, the platform starts one at the last page.

## Takeover

Takeover is the owner taking control of the Robot's browser tab from a device. The owner sees the screen, taps and types. Use Takeover for a login, a 2FA step or a page you cannot pass.

1. The Robot calls browser_request_takeover and says why. This creates an Ask of kind takeover. The owner gets a push notification.
2. The Turn is suspended. The Conversation shows "waiting for takeover".
3. The owner takes over and does the step. In the Takeover window a key button lists matching logins and fills one.
4. The owner hands the browser back.
5. A Wake-up starts a new Turn. It tells the Robot what the owner did, with the URL and a screenshot.

Do not guess passwords or codes. Ask for a Takeover.

In the PWA, a Member also connects Slack or Discord as you through a Takeover of Mr. Robot's browser. The platform reads the session, closes the tab and discards its state. Read connections.md.

## Payments

Prepare a cart or an order and stop before payment. Bank 2FA stays with the owner. Ordinary CAPTCHAs are for the Robot to solve.

## Screenshots

Screenshots are not Workspace files. The platform keeps them for 7 days. The Conversation shows them.
`
