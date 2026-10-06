import { reset } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Conversation, SkillView } from '@mr-robot/protocol'
import { api, settle, stubModels, testRobot } from './api.ts'
import { requests, scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const BEN = 'ben@example.com'
const realFetch = globalThis.fetch

/** A gzipped tarball shaped like GitHub's: everything under one "<owner>-<repo>-<sha>/" directory. */
async function tarball(files: Record<string, string>): Promise<ArrayBuffer> {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  for (const [path, content] of Object.entries(files)) {
    const body = encoder.encode(content)
    const header = new Uint8Array(512)
    header.set(encoder.encode(`ribelo-skills-abc123/${path}`).slice(0, 100), 0)
    header.set(encoder.encode(body.length.toString(8).padStart(11, '0') + '\0'), 124)
    header[156] = '0'.charCodeAt(0)
    chunks.push(header, body, new Uint8Array((512 - (body.length % 512)) % 512))
  }
  chunks.push(new Uint8Array(1024))
  const tar = new Blob(chunks as unknown as ArrayBuffer[]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Response(tar).arrayBuffer()
}

beforeEach(async () => {
  await reset()
  scripts.clear()
  requests.clear()
  await stubModels()
  await api(ANNA, '/api/me')
  await api(ANNA, '/api/admin/members', { body: { email: BEN } })
  await api(BEN, '/api/me')
})

afterEach(() => {
  globalThis.fetch = realFetch
})

async function robotWithSkills(skills: string[]): Promise<string> {
  scripts.set('*', [{ text: 'Hello.' }])
  const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
  await settle(body.id)
  await api(ANNA, `/api/robots/${body.id}/settings`, { method: 'PATCH', body: { codeMode: false, grants: { tools: ['skills'], skills, recipients: [], secrets: [] } } })
  await testRobot(body.id).activateForTest()
  return body.id
}

async function syncLibrary() {
  const archive = await tarball({
    'README.md': '# my skills',
    'skills/engineering/tdd/SKILL.md': '---\nname: tdd\ndescription: Test-driven development\n---\n# TDD\nRed, green, refactor.',
    'skills/engineering/tdd/references/notes.md': 'extra',
    'skills/writing/sage/SKILL.md': '---\nname: sage\ndescription: Structure documentation\n---\n# Sage',
    'other/ignored/SKILL.md': '---\nname: ignored\ndescription: outside the path\n---',
  })
  let authorization: string | null = null
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url === 'https://api.github.com/repos/ribelo/skills/tarball/master') {
      authorization = new Headers(init?.headers).get('authorization')
      return new Response(archive)
    }
    return realFetch(input, init)
  }) as typeof fetch
  await api(ANNA, '/api/admin/skills/repository', { method: 'PUT', body: { repo: 'ribelo/skills', ref: 'master', path: 'skills', token: 'ghp_test' } })
  const synced = await api<{ synced: string[] }>(ANNA, '/api/admin/skills/sync', { body: {} })
  return { synced: synced.body.synced, authorization: () => authorization }
}

describe('the Home skill library', () => {
  it('syncs the configured Git repository and lists its skills (robot-7qpi, robot-qjvu)', async () => {
    const { synced, authorization } = await syncLibrary()
    expect(synced.sort()).toEqual(['sage', 'tdd'])
    expect(authorization()).toBe('Bearer ghp_test')
    const { skills } = (await api<{ skills: SkillView[] }>(BEN, '/api/skills')).body
    expect(skills.map((skill) => [skill.name, skill.description, skill.source])).toEqual([['sage', 'Structure documentation', 'git'], ['tdd', 'Test-driven development', 'git']])
    expect((await api(BEN, '/api/admin/skills/sync', { body: {} })).status).toBe(403)
  })

  it('offers only granted skills to the Robot (robot-icrv)', async () => {
    await syncLibrary()
    const id = await robotWithSkills(['tdd'])
    scripts.set(id, [{ text: 'ok' }])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'what skills do you have?' } })
    await settle(id)
    const request = JSON.stringify(requests.get(id)!.at(-1))
    expect(request).toContain('Test-driven development')
    expect(request).not.toContain('Structure documentation')
  })

  it('publishes a Robot-written skill once the owner approves it; a private one stays with its owner (robot-lszy, robot-jqfw)', async () => {
    const id = await robotWithSkills([])
    scripts.set(id, [
      { calls: [{ name: 'propose_skill', args: { name: 'allegro-cart', description: 'Fill an Allegro cart', content: '---\nname: allegro-cart\n---\nSteps.', visibility: 'private' } }] },
      { text: 'I proposed a skill.' },
    ])
    await api(ANNA, `/api/robots/${id}/messages`, { body: { text: 'remember how you did that' } })
    await settle(id)
    const question = (await api<Conversation>(ANNA, `/api/robots/${id}/conversation`)).body.items.find((item) => item.kind === 'question')
    if (question?.kind !== 'question') throw new Error('no skill question')
    expect(question.proposal).toMatchObject({ kind: 'skill', skill: { name: 'allegro-cart' } })
    expect((await api<{ skills: SkillView[] }>(ANNA, '/api/skills')).body.skills).toEqual([])

    scripts.set(id, [{ text: 'Published.' }])
    await api(ANNA, `/api/robots/${id}/proposals/${question.proposal.id}`, { body: { revision: question.proposal.revision, approve: true } })
    await settle(id)
    expect((await api<{ skills: SkillView[] }>(ANNA, '/api/skills')).body.skills).toEqual([expect.objectContaining({ name: 'allegro-cart', source: 'robot', visibility: 'private' })])
    expect((await api<{ skills: SkillView[] }>(BEN, '/api/skills')).body.skills).toEqual([])
  })
})
