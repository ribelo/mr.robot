/**
 * The places a Robot acts on (v1.16 ticket 01): the Workspace, a Box and its owner's Hosts through one set of tools, each call naming its
 * place with `on`. The grants stay as they were: the files group for the Workspace, the box group for the Box, a Host's files and shell
 * facets; the tools exist when the Robot holds any of them, and each call is checked against the grant of the place it names.
 */
import z from '@deepseek-ai/schemastery'
import { placesTools, type PlacesHost, type PlacesReach } from '../agent/tools/places.ts'
import { capability } from './define.ts'

export const Places = capability<{ host: PlacesHost; reach: PlacesReach }>({
  name: 'places',
  // SAFETY: the mount config is handed over by the Robot's own composition (robot.ts), typed there; the schema only has to exist for Cordis and cannot name these types.
  Config: z.object({ host: z.any().required(), reach: z.any().required() }) as never,
  tools: ({ host, reach }) => placesTools(host, reach),
  prompt: ({ reach }) => {
    if (!reach.box) return ''
    return [
      '## Your Box',
      '- run with on box runs bash on your Box: Python 3.11 with Pandas, NumPy and Polars, Node, Bun, uv, git, ripgrep, ffmpeg and more (docs/box.md lists every tool with its version). It boots on the first command and stops ten minutes after the last command or job; its running time costs money.',
      '- A command still going when run stops waiting goes on as a job. Start a long script, a server or a watcher with run_in_background and end your Turn: you are woken when it ends, with its exit code and the end of its output (all of it under spill/jobs/). Manage jobs with job_list, job_output and job_kill.',
      "- Its disk is scratch: only /workspace/box is kept. At boot your Workspace's box/ is copied there and box/setup.sh runs when it exists; when your Turn ends and before the Box stops, changed files go back to box/. Keep what you need again there, and install packages in box/setup.sh. It is not your Workspace: reach it with on box.",
    ].join('\n')
  },
})
