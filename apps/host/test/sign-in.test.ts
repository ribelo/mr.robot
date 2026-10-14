import { describe, expect, it } from 'vitest'
import { discordToken, headerOf, isSignInKind, isWebPage, reachedApp, slackCookie, slackToken, withoutElectron } from '../src/sign-in.ts'

const config = (teams: Record<string, unknown>) => JSON.stringify({ teams, lastActiveTeamId: 'T1' })

describe('reachedApp', () => {
  it('is true on the Slack web client and the Discord channels view only', () => {
    expect(reachedApp('slack', 'https://app.slack.com/client/T0123ABC/C0456DEF')).toBe(true)
    expect(reachedApp('slack', 'https://slack.com/signin')).toBe(false)
    expect(reachedApp('slack', 'https://acme.slack.com/ssb/redirect')).toBe(false)
    expect(reachedApp('discord-user', 'https://discord.com/channels/@me')).toBe(true)
    expect(reachedApp('discord-user', 'https://discord.com/login')).toBe(false)
    expect(reachedApp('discord-user', 'not a url')).toBe(false)
  })
})

describe('slackToken', () => {
  const teams = { T1: { token: 'xoxc-one' }, T2: { token: 'xoxc-two' } }
  it('takes the workspace named by the client URL', () => {
    expect(slackToken(config(teams), 'https://app.slack.com/client/T2/C9')).toBe('xoxc-two')
  })
  it('falls back to the first workspace with a token when the URL names none of them', () => {
    expect(slackToken(config({ T1: { name: 'no token' }, ...teams }), 'https://app.slack.com/client/E99/C9')).toBe('xoxc-one')
  })
  it('is undefined while the configuration is missing, broken or holds no xoxc token', () => {
    expect(slackToken(null, 'https://app.slack.com/client/T1/C9')).toBeUndefined()
    expect(slackToken('{', 'https://app.slack.com/client/T1/C9')).toBeUndefined()
    expect(slackToken(config({ T1: { token: 'xoxp-other' } }), 'https://app.slack.com/client/T1/C9')).toBeUndefined()
    expect(slackToken('{"teams":null}', 'https://app.slack.com/client/T1/C9')).toBeUndefined()
  })
})

describe('slackCookie', () => {
  it('takes the d cookie of a slack.com domain', () => {
    expect(slackCookie([{ name: 'x', value: 'xoxd-no', domain: '.slack.com' }, { name: 'd', value: 'xoxd-yes%2B', domain: '.slack.com' }])).toBe('xoxd-yes%2B')
  })
  it('ignores a d cookie of another site or without the xoxd- prefix', () => {
    expect(slackCookie([{ name: 'd', value: 'xoxd-x', domain: '.example.com' }, { name: 'd', value: 'other', domain: '.slack.com' }])).toBeUndefined()
  })
})

describe('discordToken', () => {
  it('accepts a user token and refuses empty, bot and OAuth headers', () => {
    expect(discordToken(' mfa.abc ')).toBe('mfa.abc')
    expect(discordToken(undefined)).toBeUndefined()
    expect(discordToken('')).toBeUndefined()
    expect(discordToken('Bot abc')).toBeUndefined()
    expect(discordToken('Bearer abc')).toBeUndefined()
  })
})

describe('small helpers', () => {
  it('finds a header whatever its case', () => {
    expect(headerOf({ Authorization: 'x' }, 'authorization')).toBe('x')
    expect(headerOf({}, 'authorization')).toBeUndefined()
  })
  it('lets only https pages through', () => {
    expect(isWebPage('https://slack.com/signin')).toBe(true)
    for (const url of ['slack://open', 'discord://-/channels', 'file:///etc/passwd', 'http://slack.com', 'nonsense']) expect(isWebPage(url)).toBe(false)
  })
  it('knows the two kinds', () => {
    expect(isSignInKind('slack') && isSignInKind('discord-user')).toBe(true)
    expect(isSignInKind('discord') || isSignInKind(undefined)).toBe(false)
  })
  it('drops the Electron and app tokens from a user agent', () => {
    expect(withoutElectron('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) mr-robot-host/0.1.0 Chrome/130.0.0.0 Electron/33.0.0 Safari/537.36'))
      .toBe('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36')
  })
})
