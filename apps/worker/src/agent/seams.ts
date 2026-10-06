/**
 * Mr. Robot's Cordis adapters for DSH seams that only need a thin bridge: credentials over the
 * Member/Home DOs (read-only inside a Robot: people manage keys in the PWA), the fs seam over R2
 * with DSH's file tools, and the browser-use provider registration for Browser Rendering.
 */
import type { Context } from '@deepseek-ai/cordis'
import BrowserUseRegistry from '@deepseek-ai/dsh-browser-use'
import {
  CredentialProvider,
  type CredentialInfo,
  type CredentialKey,
  type CredentialRecord,
  type CredentialRecordEntry,
  type CredentialRecordInfo,
  type CredentialRef,
  type ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import type { MemberFileName } from '../member/member.ts'
import { R2FileSystem } from '../workspace/r2-filesystem.ts'
import type { WorkspaceShape } from '../workspace/workspace.ts'
import type { CredentialSource, ProviderId } from './providers.ts'

/** Environment-style names DSH packages ask for, mapped to Providers. */
const REFS: Readonly<Record<string, ProviderId>> = {
  DEEPSEEK_API_KEY: 'deepseek',
  OPENROUTER_API_KEY: 'openrouter',
}

const READ_ONLY = 'credentials are managed in the Mr. Robot app, not by a Robot'

export function credentialsPlugin(source: CredentialSource): (ctx: Context) => Promise<void> {
  class RobotCredentials extends CredentialProvider {
    async resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
      const provider = REFS[String(ref)]
      if (provider === undefined) return undefined
      const credential = await source.resolve(provider)
      return credential?.kind === 'api-key' && credential.key !== '' ? { value: credential.key, source: 'mr-robot' } : undefined
    }

    async describe(ref: CredentialRef): Promise<CredentialInfo> {
      return { configured: (await this.resolve(ref)) !== undefined, writable: false } as unknown as CredentialInfo
    }

    async set(): Promise<void> {
      throw new Error(READ_ONLY)
    }

    async unset(): Promise<void> {
      throw new Error(READ_ONLY)
    }

    async readRecord(_key: CredentialKey): Promise<CredentialRecord | undefined> {
      return undefined
    }

    async describeRecord(_key: CredentialKey): Promise<CredentialRecordInfo> {
      return { configured: false, writable: false }
    }

    async listRecords(): Promise<readonly CredentialRecordEntry[]> {
      return []
    }

    async modifyRecord(): Promise<CredentialRecord | undefined> {
      throw new Error(READ_ONLY)
    }

    async deleteRecord(): Promise<void> {
      throw new Error(READ_ONLY)
    }
  }
  return async (ctx) => {
    await ctx.plugin(RobotCredentials)
  }
}

export function filesPlugin(workspace: WorkspaceShape, memberFile: (name: MemberFileName) => Promise<string>): (ctx: Context) => Promise<void> {
  return async (ctx) => {
    await ctx.plugin(R2FileSystem, { workspace, memberFile })
    await ctx.plugin(ToolFs, {})
  }
}

export function browserUsePlugin(): (ctx: Context) => Promise<void> {
  return async (ctx) => {
    await ctx.plugin(BrowserUseRegistry)
    ctx.browserUse.register('cloudflare-browser-rendering' as never)
  }
}
