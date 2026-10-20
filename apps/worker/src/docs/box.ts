export const BOX = `# The Box

A Robot with the box grant has a Box: a container in Cloudflare with Python 3.11 (NumPy, Pandas, matplotlib, IPython), Node, Bun and git. The grant is off until the owner grants it, for Mr. Robot too. The Box is not the owner's computer: the owner's computer is a Host (hosts.md).

## The tools

The Box has no tools of its own. The tools of every place take a mandatory \`on\`; the Box is on "box". There is no default.
- run with on "box": run a bash command in /workspace on the Box. It waits in the foreground up to timeout_seconds (default 120, maximum 1800) and returns stdout, stderr and the exit code. A command that is still going then is not killed: it goes on as a job (read Jobs below). A long output arrives cut, with the path of the whole output under spill/ in the Workspace.
- read, write, edit, glob, grep and delete_file with on "box": work on files of the Box.
- copy moves a file between the Box and the Workspace, of any size. Name both ends: from: { on, path } and to: { on, path }. The file goes straight between the Box and R2; it does not pass through you or through the Worker. A copy between the Box and a Host, or between two Hosts, parks the file in the Workspace under tmp/ and deletes it when the copy ends.
- ws is a program on the Box for a script: \`ws ls [path]\`, \`ws get <path> [dest]\`, \`ws put <file> <path>\` and \`ws rm <path>\`. Its paths in the Workspace are relative to it (for example inbox/video.mp4). Use it inside a command to fetch a file when the command needs it. It works while the Box is up and stops working when the Box stops.
- job_list, job_output and job_kill: manage jobs. They work the same for a job on the Box and a job on a Host.

The paths are on the Box, under its /workspace. This is not the /workspace of on "workspace": that one is the Robot's Workspace. The owner's files, the product docs and the platform skills are in the Workspace only; the Box refuses their names.

## What is kept

The disk of the Box is scratch. Only one folder is kept:
- When the Box boots, the box/ folder of the Workspace is copied to /workspace/box.
- When box/setup.sh exists, it runs at boot. Install the packages you need in it (pip3 install, npm install).
- When a Turn ends, and before the Box stops, the changed and new files under /workspace/box go back to box/ in the Workspace. A file you delete on the Box stays in the Workspace.

Keep scripts, data and results that you need again under /workspace/box.

## Jobs

A job is a command that goes on by itself. It has an id, for example j-3fa9c1d2.

- A run on the Box that is still going at its time limit becomes a job. You get { kind: "promoted", jobId, stdout, stderr } with what it printed so far.
- run with run_in_background starts a job at once and returns { kind: "background", jobId }. Use it for a server, a watcher or a long script.
- job_list lists the jobs: status (running, completed, killed or lost), start, end and exit code.
- job_output returns what a job printed since you last looked. With wait it waits until the job ends, or for timeout_seconds (default 30, maximum 600). Wait only when you need the result now.
- job_kill sends TERM to the whole job and KILL five seconds later.

When a job ends, you wake as a follow-up. The message has the job id, the exit code and the last 40 lines of its output. The whole output is in spill/jobs/<id>.log in your Workspace. So you can start a job, tell the owner, and end your Turn.

A job is bounded by the life of the Box. The Box stays up while a job runs, and the ten minutes of idle time count from the end of the last job. If the Box is lost or stopped (by the owner, or by a restart) under a running job, the job is marked lost and you wake with it as failed. After the Box has stopped, job_output points to the log in spill/jobs/.

## Starting and stopping

- The Box boots on the first command. It stops ten minutes after the last command or job. The next command boots it again, with a fresh disk.
- The Robot panel shows the state of the Box (off, booting, running, stopping), its running jobs with a Stop button each, and a Stop button for the Box.

## Cost

The running time costs money at Cloudflare's container rate. It is the Box line of the Robot's cost. It counts toward the spend limit. A script that runs for hours stops when the limit is reached.

## Auto review

When Auto review is on, a reviewer model checks each run before it runs. Read auto-review.md.
`
