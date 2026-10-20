export const HOSTS = `# Hosts

A Host is a computer that runs the Mr. Robot desktop app and is paired to a Member. The app runs on Linux, macOS and Windows. A Host is private to the Member who paired it, or shared with the Home. The platform skill hosts has the practice: load it before you use a Host.

## Pairing

The Member opens the app, enters the server address and signs in through Cloudflare Access. It needs no inbound port. The page "This computer" shows the status and unpairs the Host.

A Host is offline when its heartbeat stops. The Hosts line in the runtime section of your prompt gives each Host's state, shell and sandbox, for example "Desk · online · bash on linux · sandbox full". my_capabilities gives the state for each facet. Never run a command to find out whether a Host is online.

## What a Host offers

A Host offers three facets, each a separate grant item:
- browser: the Host browser, which is Chrome on that computer. It needs a graphical session. Read browser.md.
- files: read, write, edit, glob, grep, delete_file and copy with on set to the name of the Host. copy moves one file of any size, binary too, between the Host and your Workspace, or between two Hosts (parked in your Workspace under tmp/, deleted after). The Host app and R2 exchange it directly, in parts of 64 MB, not through the model.
- shell: run with on set to the name of the Host. It runs a command in bash (pwsh on Windows) under the sandbox of the app. A command still going at its time limit goes on as a job (job_list, job_output, job_kill); run_in_background starts one at once. A job that ends wakes you, as on the Box (read box.md). A job is lost if the app restarts or the Host is away for more than five minutes.

Every tool takes a mandatory \`on\`: "workspace", "box" or the name of a Host. There is no default. A call to a Host that you hold no facet on, or to a name that is no Host, is refused and names the grant. A new Robot gets deny on all Hosts (read grants.md). Mr. Robot holds every facet his owner can reach, unless the owner lowered one; on a new computer his files and shell start at ask.

## Your directory, modes and the sandbox

On each Host you have your own directory, ~/mr-robot/<name>/ (%USERPROFILE%\\mr-robot\\<name>\\ on Windows), made on first use. Run starts there, and so does a relative path. Reads reach every file that the OS user can read, in every mode.

The owner sets a mode for the files facet and for the shell facet:
- workspace-write (the default): you may change your own directory and the extra folders the owner listed (write roots). A command may also change /tmp.
- read-only: you may change nothing.
- full: you may change all that the OS user can. The command runs without a sandbox.

The write tools follow the same mode and roots as run, except for /tmp.

When the sandbox denies a write, the result names the path. To get more, call run again with the same command, escalate set to true and a reason. The owner gets one Ask. If the owner approves, the command runs once without the sandbox and you wake with the result. The grant does not change.

The app reports its sandbox as full, partial (some file changes are not confined, as on Windows) or none, and the Hosts page shows it. On macOS and Windows the sandbox confines one folder, so a command in workspace-write mode fails closed when the grant lists extra roots. A Host with no usable sandbox refuses a command in read-only or workspace-write mode and says why; full mode runs. Without PowerShell 7 on Windows no command runs.

## Safety

Host tools run as the signed-in OS user. The grant and its mode are the gates. A tool-call Ask for a facet of a Host also shows as a notification on that Host, and opens the Ask in the app. The Host page of the Member logs each call.

A shared Host serves the Robots of every Member, as the OS user who installed the app. For a computer that serves the Home, for example a NAS, install the app under its own OS account and pair it from there. Reads stay as wide as the OS user, so that account is the real boundary.

## A Host that is offline

A Host tool or the Host browser fails with a typed "host offline" error. If a Task's Turn hit it, the owner gets a notification. The platform does not fall back to a cloud browser.

A Robot has a setting, off by default: "Do not run while any of my Hosts is offline". Its Hosts are those it holds any facet on. When it is on:
- A recurring Task that finds a Host offline ends its Attempt as failed, with the Host named. No Turn runs. The owner is told once for each outage.
- A scheduled Task waits for the Host and runs when it returns, if its deadline allows. If not, it fails.
- A message from the owner or from a Robot always wakes the Robot.
`
