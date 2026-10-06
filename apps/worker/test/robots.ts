import { env } from 'cloudflare:workers'
import type { RobotInit } from '../src/robot/robot.ts'

export const OWNER = { kind: 'member', memberId: 'm-owner', name: 'Owner' } as const

/** Create an active Robot on the stub model. */
export async function robot(id: string, init: Partial<RobotInit> = {}) {
  const stub = env.ROBOT.getByName(id)
  await stub.create({
    id,
    ownerId: OWNER.memberId,
    ownerName: OWNER.name,
    kind: 'robot',
    identity: { name: id, title: '', description: '', avatarColor: '#f4a03a' },
    sharing: 'private',
    status: 'active',
    model: { provider: 'stub', model: 'stub', effort: 'off' },
    timeZone: 'Europe/Warsaw',
    spendLimitUsd: null,
    ...init,
  })
  return stub
}

export function say(text: string) {
  return { kind: 'member' as const, sender: OWNER, text }
}
