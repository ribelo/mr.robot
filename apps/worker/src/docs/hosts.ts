export const HOSTS = `# Hosts

A Host is a computer that runs the Mr. Robot desktop app and is paired to a Member. The app runs on Linux and macOS. It makes any computer the Member signs in on a Host.

## Pairing

The Member opens the app and enters the server address. The app signs in through Cloudflare Access in the system browser. Then the app holds a host token for that Member and that computer. The app keeps one outbound connection to Mr. Robot. It needs no inbound port. The page "This computer" shows the status and unpairs the Host.

A Host is online or offline. The app sends a heartbeat. When the heartbeat stops, the Host is offline. The Member and the Home admin see the Hosts in a list.

The runtime section of a Robot's prompt has a Hosts line. It names each Host that the Robot can get a grant on, with its state, for example "Desk · online" or "Laptop · offline · Anna's". my_capabilities gives the same state for each Host facet. Read the state there. Do not run a command on a Host to find out whether it is online.

## Private or shared

A Host belongs to the Member who paired it. It is private or shared with the Home. A Member can have many Hosts.

## What a Host offers

A Host offers three facets. Each is a separate grant item for a Robot:
- browser: the Host browser, which is Chrome installed on that computer. Read browser.md.
- files: read, write, edit, glob, grep, delete_file and copy with on set to the name of the Host. read and write pass the content through the model. copy moves one file, of any size and binary too, between the Host and your Workspace in either direction, or between two Hosts (it is parked in your Workspace under tmp/ and deleted after); the content does not pass through the model, and the Host app and R2 exchange it directly in parts of 64 MB. A file copied into box/ is on your Box at its next boot. A relative path on a Host is relative to its home directory.
- shell: run with on set to the name of the Host. It runs a shell command in the login shell of the OS user. A command that is still going at its time limit goes on as a job, as on the Box (job_list, job_output and job_kill), for at most 600 seconds.

The tools take a mandatory \`on\`: "workspace", "box" or the name of a Host. There is no default. A call to a Host that the Robot holds no facet on, or to a name that is no Host, is refused and names the grant. These are the Host tools. A new Robot gets deny on all Hosts. The owner or the Robot proposes a grant. Read grants.md. Mr. Robot holds every facet his owner can reach, unless the owner lowered one.

In the Advanced settings of a Robot, the Hosts section has one heading per Host with its state, online or offline. The facets files, shell and browser are under it.

## Safety

Host tools run as the signed-in OS user, in the login shell of that user. They reach every file that the user can reach. There is no sandbox. The grant is the only gate. Grant a Host facet with care. The ask level is a good choice: the owner then approves each call.

## A Host that is offline

A Host tool or the Host browser fails with a typed "host offline" error. The Robot tells the owner. If a Task's Turn hit the error, the owner gets a notification. The platform does not fall back to a cloud browser. The owner can set a fallback backend for the Robot on purpose.

## Host browser needs a screen

The Host browser needs a graphical session on the Host. A Host without one offers files and shell only.

## Host action log

The Member's Host page keeps a log of Host tool calls: which Robot, which Host, what action.

## Notifications, time zone and sign-in

The desktop app shows native notifications. It reports the time zone of the operating system to the profile. It also connects Slack and Discord as you in a sign-in window. Read connections.md.
`
