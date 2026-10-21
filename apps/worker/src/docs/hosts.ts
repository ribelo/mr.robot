export const HOSTS = `# Hosts

A Host is a computer that runs the Mr. Robot desktop app and is paired to a Member. A Host is private to the Member who paired it, or shared with the Space. The platform skill hosts has the practice: load it before you use a Host.

## Pairing

The Member pairs it from the app; the page "This computer" shows its status and unpairs it.

A Host is offline when its heartbeat stops. The Hosts line in the runtime section of your prompt gives each Host's state, shell and sandbox, for example "Desk · online · bash on linux · sandbox full". When two Hosts have one name, each goes by its name and its owner's name, for example "Desk (Anna)". Use that name in \`on\`.

## What a Host offers

A Host offers three facets, each a separate grant item:
- browser: the Host browser, which is Chrome on that computer. It needs a graphical session. Read browser.md.
- files: read, write, edit, glob, grep, delete_file and copy with on set to the name of the Host. copy moves a file of any size between the Host and your Files or another Host.
- shell: run with on set to the name of the Host. It runs a command in bash (pwsh on Windows) under the sandbox of the app. A long command goes on as a job, as on the Box (read box.md). A job is lost if the app restarts, the Host is away for more than five minutes (a reconnect of the same app keeps it), or you lose access to the Host.

Every tool takes a mandatory \`on\`: "files", "workspace", "box" or the name of a Host. There is no default. A call to a Host without your facet, or to an unknown name, is refused and names the grant. A new Robot gets deny on all Hosts; Mr. Robot gets every facet his owner reaches, files and shell at ask.

## Your directory, modes and the sandbox

On each Host you have your own directory, ~/mr-robot/<name>/ (%USERPROFILE%\\mr-robot\\<name>\\ on Windows), made on first use. Run starts there, and so does a relative path. Reads reach every file that the OS user can read, in every mode.

The owner sets a mode for the files facet and for the shell facet:
- workspace-write (the default): you may change your own directory and the extra folders the owner listed (write roots). A command may also change /tmp. A write root inside another root, inside your directory or in /tmp, or reached through a link, is refused.
- read-only: you may change nothing.
- full: you may change all that the OS user can. The command runs without a sandbox.

The write tools follow the same mode and roots as run, except for /tmp.

When the mode denies a write, the result names the path. To get more, call the same tool again with escalate set to true and a reason. The owner gets one Ask. If the owner approves, the call runs once without the sandbox and you wake with the result. The grant does not change.

On macOS and Windows the sandbox confines one folder, so workspace-write fails closed when the grant lists extra roots. A Host with no usable sandbox runs only full mode. Without PowerShell 7 on Windows no command runs.

## Commands, git and credentials

A command gets the OS user's login environment, read when the app starts and when it is paired, without names that look like credentials (KEY, PASSWORD, SECRET, TOKEN) except those the Host config allows (SSH_AUTH_SOCK and GIT_* by default). git uses the OS user's SSH keys, agent and credential helpers: you commit as that user. Mr. Robot gives git no credential.

A service Host runs the app with no window (systemd, launchd). It has no SSH agent unless its Host config names the socket, and no browser facet. On Linux it has no user systemd manager: a command runs in a process group, and a process that leaves the group is not stopped with it. A service restart ends its jobs.

## Safety

Host tools run as the signed-in OS user. The grant and its mode are the gates. A tool-call Ask for a Host's facet also shows as a notification on that Host, or on your owner's online computers. The Member's Host page logs each call.

A shared Host serves the Robots of every Member, as the OS user who installed the app. For a computer that serves the Space, install the app under its own OS account and pair it from there. That account is the real boundary.

## A Host that is offline

A Host tool fails with "host offline"; in a Task's Turn the owner is notified.

The Robot setting "Do not run while any of my Hosts is offline" is off by default. Its Hosts are those the Robot holds any facet on (for Mr. Robot, those where his owner set files or shell to allow). When it is on, a recurring Task that finds a Host offline fails without a Turn, naming the Host, and the owner hears once per outage; a scheduled Task waits for the Host until its deadline. A message from the owner or a Robot always wakes the Robot.
`
