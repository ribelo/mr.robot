import { env, reset, runInDurableObject, SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AdminView, Me, MemberAvatar, RobotPanel, RobotSettings, RobotSummary } from '@mr-robot/protocol'
import { api, robots, settle, stubModels } from './api.ts'
import { scripts } from './stub-llm.ts'

const ANNA = 'anna@example.com'
const BEN = 'ben@example.com'

beforeEach(async () => {
  await reset()
  scripts.clear()
  await stubModels()
  await api(ANNA, '/api/me')
})

const me = async (as = ANNA) => (await api<Me>(as, '/api/me')).body

/** A picture as the app sends it: the bytes start with the format's signature. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 5, 6, 7, 8])
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 9, 9])
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0])

async function upload(body: BodyInit, contentType?: string): Promise<{ status: number; body: MemberAvatar & { error?: string } }> {
  const response = await SELF.fetch('https://mr-robot.test/api/me/avatar', {
    method: 'PUT', body, headers: { 'x-dev-identity': ANNA, ...(contentType === undefined ? {} : { 'content-type': contentType }) },
  })
  return { status: response.status, body: await response.json() }
}

const picture = (as: string, memberId: string, key: string) =>
  SELF.fetch(`https://mr-robot.test/api/members/${memberId}/avatar/${key}`, { headers: { 'x-dev-identity': as } })

describe('a Member avatar (ux-2ft4, ux-s88l, ux-g4l9)', () => {
  it('starts as initials on a colour, and the colour can be changed', async () => {
    const start = await me()
    expect(start.avatar).toMatchObject({ kind: 'initials', color: expect.stringMatching(/^#[0-9a-f]{6}$/) })
    // The same Member keeps the same colour until they change it.
    expect((await me()).avatar).toEqual(start.avatar)
    expect((await api(ANNA, '/api/me', { method: 'PATCH', body: { avatarColor: '#112233' } })).status).toBe(200)
    expect((await me()).avatar).toEqual({ kind: 'initials', color: '#112233' })
    expect((await api(ANNA, '/api/me', { method: 'PATCH', body: { avatarColor: 'red' } })).status).toBe(400)
  })

  it('uploads a picture, serves it to the Space, replaces it and removes it', async () => {
    await api(ANNA, '/api/me', { method: 'PATCH', body: { avatarColor: '#112233' } })
    const anna = await me()
    const first = await upload(PNG, 'image/png')
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ kind: 'picture', color: '#112233', key: expect.stringMatching(/^avatar-[0-9a-f]{24}$/) })
    const firstKey = (first.body as Extract<MemberAvatar, { kind: 'picture' }>).key
    expect((await me()).avatar).toEqual(first.body)

    const served = await picture(ANNA, anna.id, firstKey)
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/png')
    expect(served.headers.get('cache-control')).toBe('private, max-age=300')
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG)

    // Another Member of the Space sees it too, in the Admin members table and as the picture.
    await api(ANNA, '/api/admin/members', { body: { email: BEN } })
    await api(BEN, '/api/me')
    expect((await picture(BEN, anna.id, firstKey)).status).toBe(200)
    const admin = (await api<AdminView>(ANNA, '/api/admin')).body
    expect(admin.members.find((member) => member.id === anna.id)?.avatar).toEqual(first.body)
    expect(admin.members.find((member) => member.email === BEN)?.avatar.kind).toBe('initials')

    // A new picture (a multipart form here) takes a new key; the old one is gone.
    const form = new FormData()
    form.append('picture', new File([WEBP], 'me.webp', { type: 'image/webp' }))
    const second = await upload(form)
    expect(second.status).toBe(200)
    const secondKey = (second.body as Extract<MemberAvatar, { kind: 'picture' }>).key
    expect(secondKey).not.toBe(firstKey)
    expect((await picture(ANNA, anna.id, firstKey)).status).toBe(404)
    expect((await picture(ANNA, anna.id, secondKey)).headers.get('content-type')).toBe('image/webp')

    // A colour change keeps the picture.
    await api(ANNA, '/api/me', { method: 'PATCH', body: { avatarColor: '#445566' } })
    expect((await me()).avatar).toEqual({ kind: 'picture', color: '#445566', key: secondKey })

    const removed = await api<MemberAvatar>(ANNA, '/api/me/avatar', { method: 'DELETE' })
    expect(removed.body).toEqual({ kind: 'initials', color: '#445566' })
    expect((await me()).avatar).toEqual({ kind: 'initials', color: '#445566' })
    expect((await picture(ANNA, anna.id, secondKey)).status).toBe(404)
  })

  it('refuses a picture over 1 MB, a type other than PNG, JPEG or WebP, and nothing', async () => {
    const big = new Uint8Array(1024 * 1024 + 1)
    big.set(JPEG)
    expect(await upload(big, 'image/jpeg')).toEqual({ status: 400, body: { error: 'a picture is at most 1 MB' } })
    expect(await upload(GIF, 'image/png')).toEqual({ status: 400, body: { error: 'a picture is PNG, JPEG or WebP' } })
    expect(await upload(new Uint8Array(), 'image/png')).toEqual({ status: 400, body: { error: 'send a picture' } })
    expect((await me()).avatar.kind).toBe('initials')
    expect((await upload(JPEG, 'image/jpeg')).body.kind).toBe('picture')
  })
})

describe('a Robot avatar seed (ux-0zm6, ux-h0s4, ux-4fgy)', () => {
  async function newRobot(): Promise<string> {
    scripts.set('*', [{ text: 'Hello.' }])
    const { body } = await api<{ id: string }>(ANNA, '/api/robots', { body: {} })
    await settle(body.id)
    return body.id
  }
  const summary = async (id: string) => (await robots(ANNA)).find((robot) => robot.id === id) as RobotSummary
  const panel = async (id: string) => (await api<RobotPanel>(ANNA, `/api/robots/${id}/panel`)).body

  it('uses the id of a Robot stored before seeds existed, and keeps a seed drawn with Another look', async () => {
    const id = await newRobot()
    // As stored before v1.12: no seed in the Robot's config or in the Space's registry.
    await runInDurableObject(env.ROBOT.getByName(id), async (_robot, state) => {
      state.storage.sql.exec("UPDATE robot SET v = json_remove(v, '$.identity.avatarSeed') WHERE k = 'config'")
    })
    await runInDurableObject(env.SPACE.getByName('space'), async (_home, state) => {
      state.storage.sql.exec("UPDATE robot SET identity = json_remove(identity, '$.avatarSeed') WHERE id = ?", id)
    })
    expect((await summary(id)).identity.avatarSeed).toBe(id)
    expect((await panel(id)).settings.identity.avatarSeed).toBe(id)

    const identity = (await panel(id)).settings.identity
    const saved = await api<RobotSettings>(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { identity: { ...identity, avatarSeed: 'another-look-1' } } })
    expect(saved.status).toBe(200)
    expect(saved.body.identity.avatarSeed).toBe('another-look-1')
    expect((await summary(id)).identity.avatarSeed).toBe('another-look-1')
    expect((await panel(id)).summary.identity.avatarSeed).toBe('another-look-1')

    // An identity sent without a seed (a rename from an older app) keeps the seed.
    const { avatarSeed: _kept, ...withoutSeed } = identity
    await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { identity: { ...withoutSeed, name: 'Scout' } } })
    expect((await summary(id)).identity).toMatchObject({ name: 'Scout', avatarSeed: 'another-look-1' })

    expect((await api(ANNA, `/api/robots/${id}/settings`, { method: 'PATCH', body: { identity: { ...identity, avatarSeed: '' } } })).status).toBe(400)
  })

  it('gives a new Robot its id as the seed', async () => {
    const id = await newRobot()
    expect((await summary(id)).identity.avatarSeed).toBe(id)
  })
})
