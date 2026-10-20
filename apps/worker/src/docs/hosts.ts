export const HOSTS = `# Hosts

A Host is a computer that runs the Mr. Robot desktop app and is paired to a Member. The app runs on Linux and macOS. It makes any computer the Member signs in on a Host.

## Pairing

The Member opens the app and enters the server address. The app signs in through Cloudflare Access in the system browser, and then holds a host token. It keeps one outbound connection and needs no inbound port. The page "This computer" shows the status and unpairs the Host.

A Host is online or offline. The app sends a heartbeat. When the heartbeat stops, the Host is offline.

The runtime section of your prompt has a Hosts line with the state of each Host, for example "Desk · online". my_capabilities gives the same state for each facet. Read the state there. Do not run a command on a Host to find out whether it is online.

## Private or shared

A Host belongs to the Member who paired it. It is private or shared with the Home. A Member can have many Hosts.

## What a Host offers

A Host offers three facets. Each is a separate grant item for a Robot:
- browser: the Host browser, which is Chrome installed on that computer. Read browser.md.
- files: read, write, edit, glob, grep, delete_file and copy with on set to the name of the Host. read and write pass the content through the model. copy moves one file, of any size and binary too, between the Host and your Workspace in either direction, or between two Hosts (it is parked in your Workspace under tmp/ and deleted after); the content does not pass through the model, and the Host app and R2 exchange it directly in parts of 64 MB. A file copied into box/ is on your Box at its next boot. A relative path on a Host starts in your own directory there. See "Your directory and what you may change".
- shell: run with on set to the name of the Host. It runs a bash command through the sandbox of the app. A command still going at its time limit goes on as a job (job_list, job_output, job_kill); run_in_background starts one at once. A job is lost if the app restarts or the Host is away over five minutes.

The tools take a mandatory \`on\`: "workspace", "box" or the name of a Host. There is no default. A call to a Host that the Robot holds no facet on, or to a name that is no Host, is refused and names the grant. A new Robot gets deny on all Hosts. The owner or the Robot proposes a grant. Read grants.md. Mr. Robot holds every facet his owner can reach, unless the owner lowered one.

## Your directory and what you may change

On each Host you have your own directory, ~/mr-robot/<name>/, made on first use. It is the default directory of run and the start of a relative path. Reads reach every file that the OS user can read, in every mode.

The owner sets a mode for the files facet and for the shell facet:
- workspace-write (the default): you may change your own directory, the extra folders the owner listed (write roots) and /tmp. On Linux the /tmp of a command is private.
- read-only: you may change nothing.
- full: you may change all that the OS user can. The command runs without a sandbox.

The write tools follow the same mode and roots as run.

When the sandbox denies a write, the result names the path. To get more, call run again with the same command, escalate set to true and a reason. The owner gets one Ask. If the owner approves, the command runs once without the sandbox. The grant does not change.

A Host can have no usable sandbox. A command in read-only or workspace-write mode then fails closed, with the reason. A command in full mode runs. File tools need no sandbox.

## Safety

Host tools run as the signed-in OS user. The grant and its mode are the gates. The ask level is a good choice: the owner then approves each call.

## A Host shared with the Home

A shared Host serves the Robots of every Member, as the OS user who installed the app. For a computer that serves the Home, for example a NAS, install the app under its own OS account and pair it from there. Reads stay as wide as the OS user, so that account is the real boundary.

## A Host that is offline

A Host tool or the Host browser fails with a typed "host offline" error. The Robot tells the owner. If a Task's Turn hit the error, the owner gets a notification. The platform does not fall back to a cloud browser. The owner can set a fallback backend for the Robot on purpose.

## Host browser needs a screen

The Host browser needs a graphical session on the Host. A Host without one offers files and shell only.

## Host action log

The Host page of the Member logs each Host tool call.

## Notifications, time zone and sign-in

The desktop app shows native notifications and reports the time zone of the operating system. It also connects Slack and Discord as you. Read connections.md.
`
