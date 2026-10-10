export const HOSTS = `# Hosts

A Host is a computer that runs the Mr. Robot desktop app and is paired to a Member. The app runs on Linux and macOS. It makes any computer the Member signs in on a Host.

## Pairing

The Member opens the app and enters the server address. The app signs in through Cloudflare Access in the system browser. Then the app holds a host token for that Member and that computer. The app keeps one outbound connection to Mr. Robot. It needs no inbound port. The page "This computer" shows the status and unpairs the Host.

A Host is online or offline. The app sends a heartbeat. When the heartbeat stops, the Host is offline. The Member and the Home admin see the Hosts in a list.

## Private or shared

A Host belongs to the Member who paired it. It is private or shared with the Home. A Member can have many Hosts.

## What a Host offers

A Host offers three facets. Each is a separate grant item for a Robot:
- browser: the Host browser, which is Chrome installed on that computer. Read browser.md.
- files: host_read and host_write. They read and write files on the Host.
- shell: host_run. It runs a shell command on the Host.

These are the Host tools. A new Robot gets deny on all Hosts. The owner or the Robot proposes a grant. Read grants.md. Mr. Robot holds every facet his owner can reach, unless the owner lowered one.

## Safety

Host tools run as the signed-in OS user, in the login shell of that user. They reach every file that the user can reach. There is no sandbox. The grant is the only gate. Grant a Host facet with care. The ask level is a good choice: the owner then approves each call.

## A Host that is offline

A Host tool or the Host browser fails with a typed "host offline" error. The Robot tells the owner. If a Routine hit the error, the owner gets a notification. The platform does not fall back to a cloud browser. The owner can set a fallback backend for the Robot on purpose.

## Host browser needs a screen

The Host browser needs a graphical session on the Host. A Host without one offers files and shell only.

## Host action log

The Member's Host page keeps a log of Host tool calls: which Robot, which Host, what action.

## Notifications and time zone

The desktop app shows native notifications. It reports the time zone of the operating system to the profile.
`
