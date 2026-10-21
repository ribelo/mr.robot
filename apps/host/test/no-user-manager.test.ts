/**
 * A service Host on Linux runs without a user systemd manager (v1.21, cw-omrg): a system service has no $XDG_RUNTIME_DIR/systemd/private,
 * so DSH's subprocess-local falls back to a process group for each command (with one warning) instead of a transient user scope. Commands
 * and jobs still run and stop. This file runs in its own process, so the environment it changes is its own.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Effect from 'effect/Effect'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { access, connected, jobName } from './connected.ts'

let home = ''
let runtime = ''
let host: Awaited<ReturnType<typeof connected>>
const call = (name: string, payload: unknown) => Effect.runPromise(host.rpc[name]!(payload))

beforeAll(async () => {
  // No user manager: the runtime directory holds no systemd socket, and no session bus is named.
  runtime = await mkdtemp(join(tmpdir(), 'mr-robot-no-manager-'))
  process.env['XDG_RUNTIME_DIR'] = runtime
  delete process.env['DBUS_SESSION_BUS_ADDRESS']
  home = await mkdtemp(join(homedir(), '.mr-robot-host-service-'))
  host = await connected(home)
})
afterAll(async () => {
  await host.close()
  await rm(home, { recursive: true, force: true })
  await rm(runtime, { recursive: true, force: true })
})

describe.runIf(process.platform === 'linux')('commands on a Linux Host without a user systemd manager (cw-omrg)', () => {
  it('run confined, and a job started in the background stops when the Robot kills it', async () => {
    // The fallback: the command stays in this process's control group instead of a transient scope of its own.
    const group = (await call('Run', { command: 'cat /proc/self/cgroup', background: false, job: jobName(), access: access({ mode: 'full' }) })) as { stdout: { text: string } }
    expect(group.stdout.text).toBe(await readFile('/proc/self/cgroup', 'utf8'))
    const ran = (await call('Run', { command: 'echo service', background: false, job: jobName(), access: access() })) as { kind: string; exitCode: number; stdout: { text: string } }
    expect(ran).toMatchObject({ kind: 'foreground', exitCode: 0 })
    expect(ran.stdout.text.trim()).toBe('service')
    const job = jobName()
    await call('Run', { command: 'sleep 60', background: true, job, access: access() })
    expect(await call('JobKill', { job })).toEqual({ outcome: 'requested' })
    await vi.waitFor(() => expect(host.shell.jobs.list('bot').find((entry) => entry.job === job)?.state).toBe('killed'), { timeout: 10_000 })
  })
})
