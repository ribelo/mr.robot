/**
 * The door of shared Pages (v1.17 review 4): /p/* is outside the Access login, so what passes it is checked before any Durable Object is named.
 * An unsigned or altered token, and any address under /p other than <token>, <token>/content and <token>/pdf, reaches none; a revoked token reaches
 * the Member that held the share (the revocation lives there) and never a Robot.
 */
import { env, reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Me, SharedPageView } from '@mr-robot/protocol'
import { sharedPageChannel } from '../src/edge/shared-pages.ts'
import { mintShareToken } from '../src/pages/share-token.ts'
import type { Env } from '../src/env.ts'
import { api, settle, stubModels, testRobot } from './api.ts'
import { scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'
let annaId = ''

beforeEach(async () => {
  await reset()
  scripts.clear()
  await stubModels()
  annaId = (await api<Me>(ANNA, '/api/me')).body.id
})

/** The Worker's bindings, with every Durable Object a name was asked for recorded. */
function watched(): { readonly env: Env; readonly named: string[] } {
  const named: string[] = []
  const namespace = (label: string, real: DurableObjectNamespace) => ({ getByName: (name: string) => { named.push(`${label}:${name}`); return real.getByName(name) } })
  const bindings = env as unknown as Env
  return { env: { ...bindings, MEMBER: namespace('member', bindings.MEMBER as never), ROBOT: namespace('robot', bindings.ROBOT as never) } as unknown as Env, named }
}

const visit = (path: string, bindings: Env) => sharedPageChannel(new Request(`https://mr-robot.test${path}`), bindings)

describe('the /p door (v1.17 review 4)', () => {
  it('answers 404 to an unsigned, altered or made-up token and to any other address under /p, naming no Durable Object', async () => {
    const { env: bindings, named } = watched()
    const made = await mintShareToken('not-the-data-key-of-this-worker', annaId)
    const real = await mintShareToken((env as unknown as Env).DATA_KEY, annaId)
    const altered = real.replace(/.$/, (last) => (last === '0' ? '1' : '0'))
    for (const path of ['/p/', '/p/x', `/p/${made}`, `/p/${altered}`, `/p/${altered}/pdf`, `/p/${real}/other`, `/p/${real}/content/more`, '/p/../api/me']) {
      const response = await visit(path, bindings)
      expect(response.status, path).toBe(404)
      await response.body?.cancel()
    }
    expect(named).toEqual([])
  })

  it('a revoked token reaches the Member that held the share and no Robot', async () => {
    scripts.set('*', [{ text: '' }])
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    await settle(body.id)
    await testRobot(body.id).activateForTest()
    await env.ROBOT.getByName(body.id).saveFile('pages/a.md', '# A')
    const { url } = (await api<SharedPageView>(ANNA, `/api/robots/${body.id}/page/share`, { body: { path: 'pages/a.md' } })).body
    await api(ANNA, `/api/robots/${body.id}/page/share`, { method: 'DELETE', body: { path: 'pages/a.md' } })
    const { env: bindings, named } = watched()
    for (const suffix of ['', '/content', '/pdf']) {
      const response = await visit(new URL(url).pathname + suffix, bindings)
      expect(response.status).toBe(404)
      await response.body?.cancel()
    }
    expect(named).toEqual([`member:${annaId}`, `member:${annaId}`, `member:${annaId}`])
  })
})
