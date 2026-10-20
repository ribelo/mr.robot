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
    '- box_run runs bash on your Box: Python 3.11 with NumPy, Pandas and matplotlib, Node, Bun and git. It boots on the first command and stops ten minutes after the last one; its running time costs money.',
    "- Its disk is scratch: only /workspace/box is kept. At boot your Workspace's box/ folder is copied there, and box/setup.sh runs when it exists; when your Turn ends and before the Box stops, changed files under /workspace/box go back to box/ in your Workspace. Put scripts, data and results you need again there, and install the packages you need in box/setup.sh.",
    "- The Box is not your file tools' /workspace: read results with box_read, or keep them under /workspace/box and read them from box/ with your file tools after the Turn.",
  ].join('\n'),
})
