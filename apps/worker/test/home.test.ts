import { reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Me } from '@mr-robot/protocol'
import { api, robots, stubModels } from './api.ts'

beforeEach(async () => {
  await reset()
  await stubModels()
})

describe('signing in to the Home', () => {
  it('makes the first person the admin and reuses them on the next sign-in (robot-7v5x, robot-q7rj)', async () => {
    const first = await api<Me>('anna@example.com', '/api/me')
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ email: 'anna@example.com', role: 'admin', status: 'active', home: 'Test Home' })
    const again = await api<Me>('Anna@Example.com', '/api/me')
    expect(again.body.id).toBe(first.body.id)
  })

  it('starts with no Robots except the personal Mr. Robot (robot-mn09, robot-1xbe)', async () => {
    const list = await robots('anna@example.com')
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ kind: 'chief', identity: { name: 'Mr. Robot' }, sharing: 'private' })
  })

  it('lets only invited people in; removing a Member revokes access and pauses their Robots (robot-d2uv)', async () => {
    await api('anna@example.com', '/api/me')
    expect((await api('ben@example.com', '/api/me')).status).toBe(403)
    const invite = await api<{ status: string }>('anna@example.com', '/api/admin/members', { body: { email: 'ben@example.com' } })
    expect(invite.body.status).toBe('invited')
    const ben = await api<Me>('ben@example.com', '/api/me')
    expect(ben.body).toMatchObject({ role: 'member', status: 'active' })
    expect((await robots('ben@example.com')).map((robot) => robot.kind)).toEqual(['chief'])
    expect((await api('ben@example.com', '/api/admin/members')).status).toBe(403)

    await api('anna@example.com', `/api/admin/members/${ben.body.id}`, { method: 'DELETE' })
    expect((await api('ben@example.com', '/api/me')).status).toBe(403)
    const fleet = await api<{ id: string; status: string }[]>('anna@example.com', '/api/admin/members')
    expect(fleet.body.find((member) => member.id === ben.body.id)?.status).toBe('removed')
  })
})
