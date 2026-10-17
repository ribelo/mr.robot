/** Tasks: the product's own tools over the Home's Task store. */
import z from '@deepseek-ai/schemastery'
import { taskTools, type TasksHost } from '../agent/tools/tasks.ts'
import { capability } from './define.ts'

export const Tasks = capability<{ host: TasksHost }>({
  name: 'tasks',
  Config: z.object({ host: z.any().required() }) as never,
  tools: ({ host }) => taskTools(host),
})
