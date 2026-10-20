export const BOX = `# The Box

A Robot with the box grant has a Box: a container in Cloudflare with Python 3.11 (NumPy, Pandas, matplotlib, IPython), Node, Bun and git. The grant is off until the owner grants it, for Mr. Robot too. The Box is not the owner's computer: the owner's computer is a Host (hosts.md).

## The tools

- box_run: run a bash command in /workspace on the Box. It returns stdout, stderr and the exit code. The default time limit is 120 seconds, the maximum 1800. Exit code 124 means that the time limit stopped the command. A long output arrives cut, with the path of the whole output under spill/ in the Workspace.
- box_read: read a text file on the Box.
- box_write: write a text file on the Box.

The paths are on the Box, under its /workspace. This is not the /workspace of the file tools: that one is the Robot's Workspace.

## What is kept

The disk of the Box is scratch. Only one folder is kept:
- When the Box boots, the box/ folder of the Workspace is copied to /workspace/box.
- When box/setup.sh exists, it runs at boot. Install the packages you need in it (pip3 install, npm install).
- When a Turn ends, and before the Box stops, the changed and new files under /workspace/box go back to box/ in the Workspace. A file you delete on the Box stays in the Workspace.

Keep scripts, data and results that you need again under /workspace/box.

## Starting and stopping

- The Box boots on the first command. It stops ten minutes after the last command. The next command boots it again, with a fresh disk.
- The Robot panel shows the state of the Box (off, booting, running, stopping) and a Stop button.

## Cost

The running time costs money at Cloudflare's container rate. It is the Box line of the Robot's cost. It counts toward the spend limit. A script that runs for hours stops when the limit is reached.

## Auto review

When Auto review is on, a reviewer model checks each box_run before it runs. Read auto-review.md.
`
