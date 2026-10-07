/**
 * Browser Rendering integration test on staging (ticket 08): deploy the staging Worker, run the
 * production driver there against a fixture page, check the result, delete the Worker.
 * Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.
 */
import { execFileSync } from 'node:child_process'

const config = 'test/integration/staging.wrangler.jsonc'
const output = execFileSync('pnpm', ['exec', 'wrangler', 'deploy', '-c', config], { encoding: 'utf8' })
const url = /https:\/\/[^\s]+workers\.dev/.exec(output)?.[0]
if (url === undefined) throw new Error(`no URL in wrangler output:\n${output}`)
try {
  // A fresh workers.dev address takes a while to answer; wait for the fixture page (up to a minute).
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if ((await fetch(`${url}/fixture`).catch(() => undefined))?.ok === true) break
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  const body = await (await fetch(`${url}/run`)).text()
  let report: Record<string, unknown>
  try {
    report = JSON.parse(body) as Record<string, unknown>
  } catch {
    throw new Error(`the staging Worker failed:\n${body.slice(0, 2000)}`)
  }
  console.log(JSON.stringify(report, null, 2))
  const checks: Array<[string, boolean]> = [
    ['opens the fixture', report['title'] === 'Fixture shop'],
    ['types into a field', report['typed'] === 'Mr. Robot'],
    ['checks a checkbox', report['checked'] === 'true'],
    ['clicks a button', report['heading'] === 'Signed in'],
    ['takes a PNG screenshot', JSON.stringify(report['png']) === '[137,80,78,71]'],
    ['carries cookies into a new session', String(report['cookieInNewSession']).includes('session=ok')],
    ['streams screencast frames for the live view', Number(report['screencastFrames']) > 0],
    ['takeover typing reaches the page', report['takeoverTyped'] === 'Typed by a person'],
    ['takeover tap reaches the page', report['takeoverClicked'] === 'Signed in'],
    ['a page left running is reattached and its notification read', report['watchReattached'] === true && JSON.stringify(report['watchNotifications']).includes('Out for delivery')],
    ['a real bot check (DuckDuckGo) is recognised as a CAPTCHA', report['botCheck'] === 'bot check'],
    ['web search without a key returns real results', Number(report['searchCount']) >= 3 && /^https?:\/\/(?!www\.bing\.com)/.test(String(report['searchFirst']))],
  ]
  for (const [name, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1
} finally {
  execFileSync('pnpm', ['exec', 'wrangler', 'delete', '-c', config, '--force'], { stdio: 'ignore' })
}
