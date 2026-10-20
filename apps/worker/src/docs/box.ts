import { BOX_TOOLS, type BoxTool } from './box-tools.generated.ts'

/** The image's tools as two Markdown bullets: the programs with their versions (and the command, when it is not their name), then the Python packages (ob-m73k). */
function boxToolList(tools: readonly BoxTool[]): string {
  const programs = tools.flatMap((tool) => (tool.kind === 'program' ? [tool.command === tool.name ? `${tool.name} ${tool.version}` : `${tool.name} ${tool.version} (\`${tool.command}\`)`] : []))
  const packages = tools.flatMap((tool) => (tool.kind === 'package' ? [`${tool.name} ${tool.version}`] : []))
  return [`- Programs: ${programs.join(', ')}.`, `- Python packages: ${packages.join(', ')}.`].join('\n')
}

export const BOX = `# The Box

A Robot with the box grant has a Box: a container in Cloudflare on the Box image. The grant is off until the owner grants it, for Mr. Robot too. The Box is not the owner's computer: that is a Host (read hosts.md). The platform skill box has the practice: load it before you use the Box for more than a short command.

## The tools

The tools of every place take a mandatory \`on\`; the Box is on "box". There is no default.
- run with on "box": run a bash command in /workspace on the Box. It waits up to timeout_seconds (default 120, maximum 1800) and returns stdout, stderr and the exit code. A command that is still going then is not killed: it goes on as a job (read Jobs). A long output arrives cut; the whole output is under spill/ in the Workspace.
- read, write, edit, glob, grep and delete_file with on "box": work on files of the Box.
- copy moves a file between the Box and the Workspace, of any size: from: { on, path } and to: { on, path }. The file goes straight between the Box and R2. A copy between the Box and a Host, or between two Hosts, parks the file in the Workspace under tmp/ and deletes it when the copy ends.
- ws is a program on the Box, for a script: \`ws ls [path]\`, \`ws get <path> [dest]\`, \`ws put <file> <path>\` and \`ws rm <path>\`. Its Workspace paths are relative (for example inbox/video.mp4). It reaches your Workspace only, while the Box is up. It needs the files group at allow. At ask it is refused, because a script cannot wait for your owner: use copy.
- job_list, job_output and job_kill: read Jobs.

Paths on the Box are under its /workspace. That is not the /workspace of on "workspace", which is your Workspace. The owner's files, the product docs and the platform skills are in the Workspace only; the Box refuses their names.

## The image

The versions below are those the image was built with. It has no browser, pandoc, tesseract, LibreOffice, Docker or login-bound CLI; install anything else in box/setup.sh (pip3 install, npm install).

### Tools and packages

${boxToolList(BOX_TOOLS)}

## Layers and what is kept

- The Workspace, in R2, keeps what must last.
- The box/ folder of the Workspace is small and kept. At boot it is copied to /workspace/box, and box/setup.sh runs if it exists. When a Turn ends, and before the Box stops, the changed and new files under /workspace/box go back to box/. A file you delete on the Box stays in the Workspace. A file over 20 MB does not go back.
- The rest of the Box disk is scratch. The next boot starts with a fresh disk.

The uv and Bun caches are in /workspace/box/.cache/. When the Box stops, they go whole to box/.cache.tar.zst; the next boot unpacks it before setup.sh. Delete it for empty caches.

## Jobs

A job is a command that goes on by itself. It has an id, for example j-3fa9c1d2.

- A run that is still going at its time limit becomes a job. You get { kind: "promoted", jobId, stdout, stderr } with what it printed so far.
- run with run_in_background starts a job at once and returns { kind: "background", jobId }.
- job_list lists the jobs of every place, on the Box and on Hosts: place, status (running, completed, killed or lost), start, end and exit code.
- job_output returns what a job printed since you last looked. With wait it waits for the job to end, or for timeout_seconds (default 30, maximum 600).
- job_kill sends TERM to the whole job and KILL five seconds later.

When a job ends, you wake as a follow-up with the job id, the exit code and the last 40 lines of its output. The whole output is in spill/jobs/<id>.log in your Workspace.

A Box job lives as long as its Box. The Box stays up while a job runs. If the Box is lost or stopped under a running job, the job is lost and you wake with it as failed.

## Starting, stopping and cost

- The Box boots on the first command. It stops ten minutes after the last command or job. The next command boots it again.
- The Robot panel shows the state of the Box, its running jobs with a Stop button each, and a Stop button for the Box.
- The running time costs money at Cloudflare's container rate. It is the Box line of the Robot's cost and counts toward the spend limit.

When Auto review is on, a reviewer model checks each run before it runs. Read auto-review.md.
`
