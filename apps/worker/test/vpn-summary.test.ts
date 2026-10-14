/**
 * The Proton VPN card (v1.12 ticket 06): saving a WireGuard configuration stores it sealed and keeps
 * a public summary beside it; the Admin view shows the summary and never a key (ux-t4wi, ux-a3ec).
 */
import { reset } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AdminView } from '@mr-robot/protocol'
import { api } from './api.ts'
import { PROTON_FREE_WIREGUARD, PROTON_PRESHARED_KEY, PROTON_PRIVATE_KEY, PROTON_WIREGUARD } from './fixtures/proton-wireguard.ts'

const ANNA = 'anna@example.com'

beforeEach(async () => {
  await reset()
  await api(ANNA, '/api/me')
})

const admin = async () => (await api<AdminView>(ANNA, '/api/admin')).body
const save = (config: string | null) => api<{ ok: boolean; configured: boolean }>(ANNA, '/api/admin/vpn', { method: 'PUT', body: { config } })

describe('the Proton VPN summary', () => {
  it('shows endpoint, server name and country of a saved configuration and no key (ux-t4wi, ux-a3ec)', async () => {
    expect((await admin()).vpnSummary).toBeUndefined()
    expect((await save(PROTON_WIREGUARD)).body).toEqual({ ok: true, configured: true })
    const view = await admin()
    expect(view.vpnSummary).toEqual({ endpoint: '185.246.208.66:51820', serverName: 'PL#45', country: 'PL' })
    const text = JSON.stringify(view)
    for (const secret of [PROTON_PRIVATE_KEY, PROTON_PRESHARED_KEY, 'PrivateKey', 'PresharedKey']) expect(text).not.toContain(secret)
  })

  it('reads the country from a free server name and replaces the summary on a new save', async () => {
    await save(PROTON_WIREGUARD)
    await save(PROTON_FREE_WIREGUARD)
    expect((await admin()).vpnSummary).toEqual({ endpoint: 'node-pl-12.protonvpn.net:51820', serverName: 'pl-free-12', country: 'PL' })
  })

  it('keeps no country when the configuration names no Proton server', async () => {
    await save(PROTON_WIREGUARD.replace('# PL#45\n', ''))
    expect((await admin()).vpnSummary).toEqual({ endpoint: '185.246.208.66:51820' })
  })

  it('refuses text that is not a WireGuard configuration and keeps the stored one', async () => {
    await save(PROTON_WIREGUARD)
    const refused = await save('[Interface]\nPrivateKey = abc\n')
    expect(refused.status).toBe(400)
    expect((await admin()).vpnSummary?.serverName).toBe('PL#45')
  })

  it('removes the summary with the configuration', async () => {
    await save(PROTON_WIREGUARD)
    await save(null)
    expect((await admin()).vpnSummary).toBeUndefined()
  })
})
