export const HOSTS = `# Hosts

A Host is a computer that runs the Mr. Robot desktop app and is paired to a Member. A Host is private to the Member who paired it, or shared with the Space. The platform skill hosts has the practice: load it before you use a Host.

## Pairing

The Member opens the app, enters the server address and signs in through Cloudflare Access. The page "This computer" shows the status and unpairs the Host.

A Host is offline when its heartbeat stops. The Hosts line in the runtime section of your prompt gives each Host's state, shell and sandbox, for example "Desk · online · bash on linux · sandbox full". When two Hosts have one name, each goes by its name and its owner's name, for example "Desk (Anna)". Use that name in \`on\`.

## What a Host offers

A Host offers three facets, each a separate grant item:
- browser: the Host browser, which is Chrome on that computer. It needs a graphical session. Read browser.md.
- files: read, write, edit, glob, grep, delete_file and copy with on set to the name of the Host. copy moves one file of any size between the Host and your Workspace, or between two Hosts. The Host app and R2 exchange it directly, in parts of 64 MB.
- shell: run with on set to the name of the Host. It runs a command in bash (pwsh on Windows) under the sandbox of the app. A long command goes on as a job, as on the Box (read box.md). A job is lost if the app restarts, the Host is away for more than five minutes (a reconnect of the same app keeps it), or you lose access to the Host.

Every tool takes a mandatory \`on\`: "workspace", "box" or the name of a Host. There is no default. A call to a Host that you hold no facet on, or to a name that is no Host, is refused and names the grant. A new Robot gets deny on all Hosts. Mr. Robot holds every facet his owner can reach, unless the owner lowered one; on every computer, a shared one too, his files and shell start at ask.

## Your directory, modes and the sandbox

On each Host you have your own directory, ~/mr-robot/<name>/ (%USERPROFILE%\\mr-robot\\<name>\\ on Windows), made on first use. Run starts there, and so does a relative path. Reads reach every file that the OS user can read, in every mode.

The owner sets a mode for the files facet and for the shell facet:
- workspace-write (the default): you may change your own directory and the extra folders the owner listed (write roots). A command may also change /tmp. A write root inside another root, inside your directory or in /tmp, or reached through a link, is refused.
- read-only: you may change nothing.
- full: you may change all that the OS user can. The command runs without a sandbox.

The write tools follow the same mode and roots as run, except for /tmp.

When the mode denies a write, the result names the path. To get more, call the same tool (run, write, edit, delete_file, or copy to a Host) again with escalate set to true and a reason. The owner gets one Ask. If the owner approves, the call runs once without the sandbox and you wake with the result. The grant does not change.

The app reports its sandbox as full, partial (some file changes are not confined, as on Windows) or none, as the Hosts page shows. On macOS and Windows the sandbox confines one folder, so a command or a write in workspace-write mode fails closed when the grant lists extra roots. A Host with no usable sandbox refuses a command or a write in read-only or workspace-write mode and says why; full mode runs. Without PowerShell 7 on Windows no command runs.

## Safety

Host tools run as the signed-in OS user. The grant and its mode are the gates. A tool-call Ask for a facet of a Host also shows as a notification on that Host if it is your owner's and online, else on your owner's online computers. It opens the Ask in the app. The Member's Host page logs each call.

A shared Host serves the Robots of every Member, as the OS user who installed the app. For a computer that serves the Space, for example a NAS, install the app under its own OS account and pair it from there. That account is the real boundary.

## A Host that is offline

A Host tool or the Host browser fails with a typed "host offline" error. If a Task's Turn hit it, the owner gets a notification.

A Robot has a setting, off by default: "Do not run while any of my Hosts is offline". Its Hosts are those it holds any facet on (for Mr. Robot, those where his owner set files or shell to allow). When it is on:
- A recurring Task that finds a Host offline ends its Attempt as failed, naming the Host, without a Turn. The owner hears once per outage.
- A scheduled Task waits for the Host and runs when it returns; past its deadline it fails.
- A message from the owner or a Robot always wakes the Robot.
`
