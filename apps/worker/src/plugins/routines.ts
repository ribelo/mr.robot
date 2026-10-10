/** Routines: the product's own tools over the Robot's routine table and alarm. */
import z from '@deepseek-ai/schemastery'
import { routineTools, type RoutinesHost } from '../agent/tools/routines.ts'
import { capability } from './define.ts'

export const Routines = capability<{ host: RoutinesHost }>({
  name: 'routines',
  Config: z.object({ host: z.any().required() }) as never,
  tools: ({ host }) => routineTools(host),
})
