/**
 * What a Robot sees of a page (robot-l9te), after Leash's observation: the visible actionable
 * elements with a numbered ref, role, label, value and the operations offered on each, the
 * page text (bounded), scroll room, and a CAPTCHA vendor signal.
 */

export type Operation = 'CLICK' | 'TYPE_TEXT' | 'SELECT' | 'CHECK'

export interface ObservedElement {
  readonly index: number
  readonly role: string
  readonly label: string
  readonly value: string
  readonly operations: readonly Operation[]
  readonly checked?: 'true' | 'false'
  readonly options?: ReadonlyArray<{ readonly value: string; readonly label: string }>
}

export interface Observation {
  readonly url: string
  readonly title: string
  readonly text: string
  readonly elements: readonly ObservedElement[]
  readonly canScrollUp: boolean
  readonly canScrollDown: boolean
  /** A CAPTCHA vendor is on the page (Turnstile, hCaptcha, reCAPTCHA). */
  readonly challenge: string | null
  /** The page is a block page ("You have been blocked", "Access denied"): the site refuses this browser (rb-kank). */
  readonly blocked?: boolean
  /** The backend that saw the page, for the block report. */
  readonly backend?: string
}

export const MAX_TEXT = 6_000
export const MAX_ELEMENTS = 200

/**
 * Runs inside the page. Marks each offered element with data-mr-ref so a later action finds the
 * same node; a ref whose element is gone or changed is stale and the Robot must observe again.
 */
export const OBSERVE_SCRIPT = `(() => {
  const MAX_TEXT = ${MAX_TEXT}, MAX_ELEMENTS = ${MAX_ELEMENTS}
  for (const old of document.querySelectorAll('[data-mr-ref]')) old.removeAttribute('data-mr-ref')
  const visible = (el) => {
    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false
    const box = el.getBoundingClientRect()
    return box.width > 0 && box.height > 0 && box.bottom > -200 && box.top < innerHeight + 1200
  }
  const roleOf = (el) => {
    const explicit = el.getAttribute('role')
    if (explicit) return explicit
    const tag = el.tagName.toLowerCase()
    if (tag === 'a') return 'link'
    if (tag === 'button' || tag === 'summary') return 'button'
    if (tag === 'select') return 'combobox'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase()
      if (type === 'checkbox') return 'checkbox'
      if (type === 'radio') return 'radio'
      if (type === 'submit' || type === 'button' || type === 'reset' || type === 'image') return 'button'
      if (type === 'hidden') return null
      if (type === 'file') return 'file'
      return type === 'password' ? 'password' : 'textbox'
    }
    if (el.isContentEditable) return 'textbox'
    return 'button'
  }
  const labelOf = (el) => {
    const aria = el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') || '').split(' ').map((id) => document.getElementById(id)?.innerText || '').join(' ').trim()
    if (aria) return aria
    if (el.labels && el.labels.length > 0) return [...el.labels].map((label) => label.innerText).join(' ')
    const text = (el.innerText || el.value || '').trim()
    return (text || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('name') || '').replace(/\\s+/g, ' ').slice(0, 120)
  }
  const selector = 'a[href], button, input, select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=radio], [role=tab], [role=menuitem], [role=option], [role=switch], [role=combobox], [role=textbox], [contenteditable=true], [onclick]'
  const elements = []
  let index = 0
  for (const el of document.querySelectorAll(selector)) {
    if (elements.length >= MAX_ELEMENTS) break
    if (!visible(el)) continue
    const role = roleOf(el)
    if (role === null || role === 'file') continue
    const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true'
    const editable = role === 'textbox' || role === 'password' || role === 'searchbox'
    const readonly = el.readOnly === true
    const operations = disabled ? [] : el.tagName === 'SELECT' ? ['SELECT'] : role === 'checkbox' || role === 'radio' || role === 'switch' ? ['CHECK', 'CLICK'] : editable && !readonly ? ['TYPE_TEXT', 'CLICK'] : ['CLICK']
    if (operations.length === 0) continue
    index += 1
    el.setAttribute('data-mr-ref', String(index))
    const entry = { index, role, label: labelOf(el), value: role === 'password' ? (el.value ? '••••' : '') : el.tagName === 'SELECT' ? (el.selectedOptions[0]?.innerText || '') : (el.value ?? el.innerText ?? '').toString().slice(0, 200), operations }
    if (role === 'checkbox' || role === 'radio' || role === 'switch') entry.checked = String(el.checked === true || el.getAttribute('aria-checked') === 'true')
    if (el.tagName === 'SELECT') entry.options = [...el.options].slice(0, 50).map((option) => ({ value: option.value, label: option.innerText.trim() }))
    elements.push(entry)
  }
  const text = (document.body?.innerText || '').replace(/\\n{3,}/g, '\\n\\n').slice(0, MAX_TEXT)
  const frames = [...document.querySelectorAll('iframe')].map((frame) => frame.src || '')
  const challenge = frames.some((src) => src.includes('challenges.cloudflare.com')) ? 'turnstile'
    : frames.some((src) => /hcaptcha\\.com/.test(src)) ? 'hcaptcha'
      : frames.some((src) => /recaptcha/.test(src)) ? 'recaptcha'
        // Sites' own bot checks (seen on DuckDuckGo, Google and Brave from Browser Rendering, 2026-10-07).
        : /confirm (that )?(this search was made by|you are) a human|verify (that )?you are (a )?human|unusual traffic from your computer|not a robot|verifying you('|’)re not a bot|complete the security check/i.test(text) ? 'bot check' : null
  // A block page: short, and its title or opening says the visitor is blocked (Allegro, Cloudflare WAF, Akamai).
  const head = ((document.title || '') + '\\n' + text.slice(0, 600))
  const blocked = text.length < 4000 && /you( have|'ve|’ve) been blocked|sorry, you have been blocked|access (to this page )?(has been )?denied|(your |this )?request (has been |was )?blocked|you don't have permission to access|403 forbidden/i.test(head)
  const scroller = document.scrollingElement || document.documentElement
  return {
    url: location.href,
    title: document.title,
    text,
    elements,
    canScrollUp: scroller.scrollTop > 0,
    canScrollDown: scroller.scrollTop + innerHeight < scroller.scrollHeight - 4,
    challenge,
    blocked,
  }
})()`

/** The observation as the model reads it. */
export function renderObservation(observation: Observation): string {
  const lines = [
    `URL: ${observation.url}`,
    `Title: ${observation.title}`,
    observation.blocked === true ? `This page blocks your browser (${observation.backend ?? 'this backend'}). Do not retry or work around it: tell your owner the site blocked the ${observation.backend ?? 'current'} browser and suggest switching this Robot's browser backend in Advanced settings.` : '',
    observation.challenge === null ? '' : `A ${observation.challenge} CAPTCHA is on this page. Solve an ordinary one yourself (click its checkbox, take a screenshot to read an image puzzle); if it needs your owner, call browser_request_takeover.`,
    `Scroll: ${observation.canScrollUp ? 'more above' : 'top'}, ${observation.canScrollDown ? 'more below' : 'bottom'}`,
    '',
    'Elements (act on them by index):',
    ...observation.elements.map((element) => {
      const extra = [
        element.value === '' ? '' : ` value="${element.value}"`,
        element.checked === undefined ? '' : ` checked=${element.checked}`,
        element.options === undefined ? '' : ` options=[${element.options.map((option) => option.label).join(' | ')}]`,
      ].join('')
      return `[${element.index}] ${element.role} "${element.label}"${extra} {${element.operations.join(', ')}}`
    }),
    '',
    'Page text:',
    observation.text,
  ]
  return lines.filter((line, position) => line !== '' || position > 3).join('\n')
}
