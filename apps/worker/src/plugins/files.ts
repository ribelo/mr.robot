/** Workspace files: Mr. Robot's file tools plus DSH's fs tools over R2. */
import z from '@deepseek-ai/schemastery'
import type { MemberFileName } from '../member/member.ts'
import { filesPlugin } from '../agent/seams.ts'
import { fileTools } from '../agent/tools/files.ts'
import type { WorkspaceShape } from '../workspace/workspace.ts'
import { capability } from './define.ts'

type Host = Parameters<typeof fileTools>[0]

export const Files = capability<{ host: Host; workspace: WorkspaceShape; memberFile: (name: MemberFileName) => Promise<string> }>({
  name: 'files',
  Config: z.object({ host: z.any().required(), workspace: z.any().required(), memberFile: z.any().required() }) as never,
  tools: ({ host }) => fileTools(host),
  seams: (ctx, { workspace, memberFile }) => filesPlugin(workspace, memberFile)(ctx),
})
