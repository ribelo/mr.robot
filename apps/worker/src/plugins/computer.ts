/** A computer (v1.14 ticket 10): a container with Python, NumPy, Pandas, matplotlib, Node, Bun and git. */
import z from '@deepseek-ai/schemastery'
import { computerTools, type ComputerHost } from '../agent/tools/computer.ts'
import { capability } from './define.ts'

export const Computer = capability<{ host: ComputerHost }>({
  name: 'computer',
  Config: z.object({ host: z.any().required() }) as never,
  tools: ({ host }) => computerTools(host),
  prompt: () => [
    '## Your computer',
    '- computer_run runs bash on your computer: Python 3.11 with NumPy, Pandas and matplotlib, Node, Bun and git. It boots on the first command and stops ten minutes after the last one; its running time costs money.',
    "- Its disk is scratch: only /workspace/computer is kept. At boot your Workspace's computer/ folder is copied there, and computer/setup.sh runs when it exists; when your Turn ends and before the computer stops, changed files under /workspace/computer go back to computer/ in your Workspace. Put scripts, data and results you need again there, and install the packages you need in computer/setup.sh.",
    '- The computer is not your file tools\' /workspace: read results with computer_read, or keep them under /workspace/computer and read them from computer/ with your file tools after the Turn.',
  ].join('\n'),
})
