/**
 * A plugin's form from its Schemastery config (cn-s1pd): every field of an object schema becomes a
 * PluginField; secret fields (role "secret") are split off so configuration never holds a secret (cn-a1i0).
 */
import type z from '@deepseek-ai/schemastery'
import * as Data from 'effect/Data'
import type { PluginField } from '@mr-robot/protocol'

export class PluginConfigInvalid extends Data.TaggedError('PluginConfigInvalid')<{ readonly plugin: string; readonly message: string }> {}

type Node = z<unknown>

/** The const members of a union of constants, as choice options. */
function constOptions(node: Node): Array<{ value: string; label: string }> | undefined {
  if (node.type !== 'union' || node.list === undefined) return undefined
  const options: Array<{ value: string; label: string }> = []
  for (const member of node.list as Node[]) {
    if (member.type !== 'const' || typeof member.value !== 'string') return undefined
    options.push({ value: member.value, label: typeof member.meta.description === 'string' ? member.meta.description : member.value })
  }
  return options
}

function fieldOf(key: string, node: Node): PluginField | undefined {
  if (node.meta.hidden === true) return undefined
  const label = typeof node.meta.description === 'string' ? node.meta.description : key
  const base = { key, label, description: node.meta.comment ?? null, options: [], required: node.meta.required === true }
  if (node.meta.role === 'secret') return { ...base, kind: 'secret' }
  if (node.type === 'string') return { ...base, kind: 'text' }
  if (node.type === 'number' || node.type === 'natural') return { ...base, kind: 'number' }
  if (node.type === 'boolean') return { ...base, kind: 'boolean' }
  const choice = constOptions(node)
  if (choice !== undefined) return { ...base, kind: 'choice', options: choice }
  if (node.type === 'array' && node.inner !== undefined) {
    const options = constOptions(node.inner as Node)
    if (options !== undefined) return { ...base, kind: 'choices', options }
  }
  return undefined
}

/** The fields of an object schema, in declaration order; nested objects and unsupported types are not shown. */
export function describeSchema(schema: Node): PluginField[] {
  if (schema.type !== 'object' || schema.dict === undefined) return []
  return Object.entries(schema.dict as Record<string, Node>).flatMap(([key, node]) => fieldOf(key, node) ?? [])
}

export type PlainValue = string | number | boolean | readonly string[]

/**
 * Validate a submitted form against the schema and split it: plain values for the configuration,
 * secret values for the vault. Secret fields left empty keep the stored secret.
 */
export function parseForm(plugin: string, schema: Node, input: Readonly<Record<string, unknown>>, secretsSet: ReadonlySet<string>):
  | { readonly ok: true; readonly values: Record<string, PlainValue>; readonly secrets: Record<string, string> }
  | { readonly ok: false; readonly error: PluginConfigInvalid } {
  const fields = describeSchema(schema)
  const values: Record<string, PlainValue> = {}
  const secrets: Record<string, string> = {}
  const probe: Record<string, unknown> = {}
  for (const field of fields) {
    const raw = input[field.key]
    if (field.kind === 'secret') {
      if (typeof raw === 'string' && raw.trim() !== '') { secrets[field.key] = raw.trim(); probe[field.key] = raw.trim() }
      else if (secretsSet.has(field.key)) probe[field.key] = 'stored'
      else if (field.required) return { ok: false, error: new PluginConfigInvalid({ plugin, message: `${field.label} is required` }) }
      continue
    }
    if (raw === undefined || raw === null || raw === '') continue
    probe[field.key] = raw
  }
  try {
    const normalized = schema(probe) as Record<string, unknown>
    for (const field of fields) {
      if (field.kind === 'secret') continue
      const value = normalized[field.key]
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') values[field.key] = value
      else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) values[field.key] = value as string[]
    }
  } catch (error) {
    return { ok: false, error: new PluginConfigInvalid({ plugin, message: error instanceof Error ? error.message : String(error) }) }
  }
  return { ok: true, values, secrets }
}
