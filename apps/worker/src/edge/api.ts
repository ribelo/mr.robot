/**
 * The HTTP API of the edge Worker. It holds no state: every call is routed to the
 * Durable Object that owns the data, after resolving the caller to a Member.
 */
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import {
  MemberPreferences,
  ProposalAnswer,
  SendMessage,
  SettingsPatch,
  type Me,
  type MemberView,
  type RobotPanel,
} from '@mr-robot/protocol'
import { HOME_ID, type Env } from '../env.ts'
import type { AnswerResult } from '../robot/robot.ts'
import { badRequest, call, conflict, decodeBody, forbidden, notFound, Router, type ApiError } from './http.ts'

export interface ApiContext {
  readonly request: Request
  readonly env: Env
  readonly ctx: ExecutionContext
  readonly member: MemberView
}

const home = (env: Env) => env.HOME.getByName(HOME_ID)

/** The caller may use this Robot (owner, or shared with the Home); returns how. */
function reach(c: ApiContext, robotId: string): Effect.Effect<'owner' | 'shared', ApiError> {
  return call(() => home(c.env).access(c.member.id, robotId)).pipe(
    Effect.flatMap((access) => access === null ? Effect.fail(notFound('no such robot')) : Effect.succeed(access)),
  )
}

function owner(c: ApiContext, robotId: string): Effect.Effect<void, ApiError> {
  return reach(c, robotId).pipe(Effect.flatMap((access) => access === 'owner' ? Effect.void : Effect.fail(forbidden('only the owner can do that'))))
}

function admin(c: ApiContext): Effect.Effect<void, ApiError> {
  return c.member.role === 'admin' ? Effect.void : Effect.fail(forbidden('admin only'))
}

const robot = (c: ApiContext, id: string) => c.env.ROBOT.getByName(id)

export const api = new Router<ApiContext>()
  // ------------------------------------------------------------ me
  .on('GET', '/api/me', (c) => call(async (): Promise<Me> => {
    const profile = await c.env.MEMBER.getByName(c.member.id).profile()
    return { ...c.member, home: c.env.HOME_NAME, timeZone: profile.timeZone, quietHours: profile.quietHours, vapidPublicKey: c.env.VAPID_PUBLIC_KEY }
  }))
  .on('PATCH', '/api/me', (c) => Effect.gen(function* () {
    const patch = yield* decodeBody(c.request, MemberPreferences)
    yield* call(() => c.env.MEMBER.getByName(c.member.id).updateProfile(patch))
    if (patch.name !== undefined) yield* call(() => home(c.env).rename(c.member.id, patch.name!))
    return { ok: true }
  }))
  .on('GET', '/api/me/files/:name', (c, { name }) => fileName(name).pipe(
    Effect.flatMap((file) => call(() => c.env.MEMBER.getByName(c.member.id).file(file))),
    Effect.map((content) => ({ name, content })),
  ))
  .on('PUT', '/api/me/files/:name', (c, { name }) => Effect.gen(function* () {
    const file = yield* fileName(name)
    const { content } = yield* decodeBody(c.request, Schema.Struct({ content: Schema.String }))
    yield* call(() => c.env.MEMBER.getByName(c.member.id).writeFile(file, content))
    return { ok: true }
  }))

  // ------------------------------------------------------------ robots
  .on('GET', '/api/robots', (c) => call(() => home(c.env).reachable(c.member.id)))
  .on('POST', '/api/robots', (c) => Effect.gen(function* () {
    const { brief } = yield* decodeBody(c.request, Schema.Struct({ brief: Schema.optional(Schema.String) }))
    return yield* call(() => home(c.env).createRobot(c.member.id, brief))
  }))
  .on('GET', '/api/robots/:id/conversation', (c, { id }) => reach(c, id).pipe(Effect.andThen(call(() => robot(c, id).conversation()))))
  .on('GET', '/api/robots/:id/trajectory', (c, { id }) => reach(c, id).pipe(Effect.andThen(call(() => robot(c, id).trajectory()))))
  .on('POST', '/api/robots/:id/messages', (c, { id }) => Effect.gen(function* () {
    yield* reach(c, id)
    const message = yield* decodeBody(c.request, SendMessage)
    if (message.text.trim() === '' && (message.attachments ?? []).length === 0) return yield* Effect.fail(badRequest('empty message'))
    const sender = { kind: 'member' as const, memberId: c.member.id, name: c.member.name }
    const wakeup = yield* call(() => robot(c, id).wake({ kind: 'member', sender, text: message.text, attachments: message.attachments ?? [] }))
    return { wakeup }
  }))
  .on('GET', '/api/robots/:id/panel', (c, { id }) => Effect.gen(function* () {
    const access = yield* reach(c, id)
    const entry = (yield* call(() => home(c.env).reachable(c.member.id))).find((summary) => summary.id === id)
    if (entry === undefined) return yield* Effect.fail(notFound())
    const panel: RobotPanel = yield* call(() => robot(c, id).panel(access === 'owner', entry))
    return panel
  }))
  .on('PATCH', '/api/robots/:id/settings', (c, { id }) => Effect.gen(function* () {
    yield* owner(c, id)
    const patch = yield* decodeBody(c.request, SettingsPatch)
    return yield* call(() => robot(c, id).updateSettings(patch))
  }))
  .on('POST', '/api/robots/:id/proposals/:proposal', (c, { id, proposal }) => Effect.gen(function* () {
    yield* owner(c, id)
    const answer = yield* decodeBody(c.request, ProposalAnswer)
    const result = yield* call((): Promise<AnswerResult> => robot(c, id).answer(proposal, answer.revision, answer.approve))
    if (!result.ok) return yield* Effect.fail(result.reason === 'stale' ? conflictStale() : notFound('no such proposal'))
    return result.proposal
  }))
  .on('POST', '/api/robots/:id/pause', (c, { id }) => owner(c, id).pipe(Effect.andThen(call(() => robot(c, id).pause()))))
  .on('POST', '/api/robots/:id/resume', (c, { id }) => owner(c, id).pipe(Effect.andThen(call(() => robot(c, id).resume()))))
  .on('DELETE', '/api/robots/:id', (c, { id }) => owner(c, id).pipe(Effect.andThen(call(() => robot(c, id).remove()))))

  // ------------------------------------------------------------ admin (robot-x26m, robot-1rap, robot-d2uv)
  .on('GET', '/api/admin/members', (c) => admin(c).pipe(Effect.andThen(call(() => home(c.env).members()))))
  .on('POST', '/api/admin/members', (c) => Effect.gen(function* () {
    yield* admin(c)
    const { email } = yield* decodeBody(c.request, Schema.Struct({ email: Schema.String }))
    if (!email.includes('@')) return yield* Effect.fail(badRequest('not an e-mail address'))
    return yield* call(() => home(c.env).invite(email))
  }))
  .on('DELETE', '/api/admin/members/:member', (c, { member }) => Effect.gen(function* () {
    yield* admin(c)
    if (member === c.member.id) return yield* Effect.fail(badRequest('you cannot remove yourself'))
    yield* call(() => home(c.env).remove(member))
    return { ok: true }
  }))

function fileName(name: string): Effect.Effect<'USER.md' | 'PROACTIVE_PREFERENCES.md', ApiError> {
  return name === 'USER.md' || name === 'PROACTIVE_PREFERENCES.md' ? Effect.succeed(name) : Effect.fail(notFound('no such file'))
}

function conflictStale(): ApiError {
  return badRequestConflict('the proposal changed since you saw it; reload and answer the current one')
}

function badRequestConflict(message: string): ApiError {
  return new (badRequest('').constructor as new (args: { status: number; message: string }) => ApiError)({ status: 409, message })
}