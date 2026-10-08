/** A connector mounted as a Robot capability: its tools for the granted accounts, an accounts tool, its rules. */
import z from '@deepseek-ai/schemastery'
import type { ConnectorKind } from '@mr-robot/protocol'
import { accountsTool, type ConnectorHost, type ConnectorPlugin } from '../connectors/connector.ts'
import { capability } from './define.ts'

type ConnectorConfig = { plugin: ConnectorPlugin; host: ConnectorHost }

const byKind = new Map<ConnectorKind, ReturnType<typeof capability<ConnectorConfig>>>()

/** One capability per connector kind: a Robot holding Google and Discord mounts both, each with its own prompt section. */
export function connectorCapability(kind: ConnectorKind) {
  let found = byKind.get(kind)
  if (found === undefined) {
    found = capability<ConnectorConfig>({
      name: `connector-${kind}`,
      Config: z.object({ plugin: z.any().required(), host: z.any().required() }) as never,
      tools: ({ plugin, host }) => [accountsTool(host), ...plugin.tools(host)],
      prompt: ({ plugin, host }) => [
        `- ${host.kind} accounts granted to you: ${host.accounts.map((account) => `${account.label} (${account.account}${account.write ? ', writing granted' : ''})`).join('; ')}. Every ${host.kind} tool result starts with the account it acted on; when several are granted, name the one you mean with the account parameter.`,
        plugin.prompt?.(host) ?? '',
      ].filter(Boolean).join('\n'),
    })
    byKind.set(kind, found)
  }
  return found
}
