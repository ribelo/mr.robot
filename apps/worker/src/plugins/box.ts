/** A Box (v1.14 ticket 10, named Computer then): a container with Python, NumPy, Pandas, matplotlib, Node, Bun and git. */
import z from '@deepseek-ai/schemastery'
import { boxTools, type BoxHost } from '../agent/tools/box.ts'
import { capability } from './define.ts'

export const Box = capability<{ host: BoxHost }>({
  name: 'box',
  Config: z.object({ host: z.any().required() }) as never,
  tools: ({ host }) => boxTools(host),
  prompt: () => [
    '## Your Box',
    '- box_run runs bash on your Box: Python 3.11 (NumPy, Pandas, matplotlib), Node, Bun, git. It boots on the first command and stops ten minutes after the last command or job; its running time costs money.',
    '- A command still going when box_run stops waiting goes on as a job. Start a long script, a server or a watcher with run_in_background and end your Turn: you are woken when it ends, with its exit code and the end of its output (all of it under spill/jobs/). Manage jobs with job_list, job_output and job_kill.',
    "- Its disk is scratch: only /workspace/box is kept. At boot your Workspace's box/ is copied there and box/setup.sh runs when it exists; when your Turn ends and before the Box stops, changed files go back to box/. Keep what you need again there, and install packages in box/setup.sh. It is not your file tools' /workspace: read results with box_read.",
  ].join('\n'),
})
