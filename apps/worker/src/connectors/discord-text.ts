/**
 * What a Robot's text needs before it goes to Discord (pure functions): Discord does not render
 * Markdown tables, and a message holds at most 2000 characters.
 */

/** Discord's limit for the content of one message. */
export const DISCORD_MESSAGE_LIMIT = 2000

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const SEPARATOR_ROW = /^\s*\|(\s*:?-{3,}:?\s*\|?)+\s*$/

interface Fence {
  readonly marker: string
  /** The opening line, to open the fence again in the next message. */
  readonly opener: string
}

/** The fence still open after these lines, or null. */
function fenceAfter(lines: readonly string[], start: Fence | null): Fence | null {
  let open = start
  for (const line of lines) {
    const match = FENCE.exec(line)
    if (match === null) continue
    const marker = match[1]!
    if (open === null) open = { marker, opener: line.trim().length > 40 ? marker : line.trim() }
    else if (marker[0] === open.marker[0] && marker.length >= open.marker.length && match[2]!.trim() === '') open = null
  }
  return open
}

/** A table (consecutive lines that start with "|", one of them a "|---|" separator row) becomes a code block. */
export function fenceTables(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let fence: Fence | null = null
  for (let index = 0; index < lines.length;) {
    const line = lines[index]!
    if (fence === null && /^\s*\|/.test(line)) {
      let end = index
      while (end < lines.length && /^\s*\|/.test(lines[end]!)) end += 1
      const run = lines.slice(index, end)
      if (run.some((row) => SEPARATOR_ROW.test(row))) out.push('```', ...run, '```')
      else out.push(...run)
      index = end
      continue
    }
    fence = fenceAfter([line], fence)
    out.push(line)
    index += 1
  }
  return out.join('\n')
}

/** Where to cut `rest` so the head fits in `max`: a paragraph break, else a line break, else hard. */
function cutAt(rest: string, max: number, floor: number): { head: string; tail: string } {
  const window = rest.slice(0, max + 1)
  const paragraph = window.lastIndexOf('\n\n')
  if (paragraph > floor) return { head: rest.slice(0, paragraph), tail: rest.slice(paragraph).replace(/^\n+/, '') }
  const line = window.lastIndexOf('\n')
  if (line > floor) return { head: rest.slice(0, line), tail: rest.slice(line + 1) }
  let hard = max
  // Never cut a surrogate pair in two.
  const code = rest.charCodeAt(hard - 1)
  if (code >= 0xd800 && code <= 0xdbff) hard -= 1
  return { head: rest.slice(0, hard), tail: rest.slice(hard) }
}

/**
 * Split text into messages of at most `limit` characters: at paragraph breaks first, then line
 * breaks, then anywhere. A code block cut in two is closed in the first message and opened again
 * in the next one. Nothing is dropped except the breaks the cuts fall on.
 */
export function splitMessage(text: string, limit: number = DISCORD_MESSAGE_LIMIT): string[] {
  const parts: string[] = []
  let rest = text
  let carried: Fence | null = null
  while (rest.trim() !== '') {
    const prefix = carried === null ? '' : carried.opener + '\n'
    const full = prefix + rest
    if (full.length <= limit) {
      parts.push(full)
      break
    }
    let cut = cutAt(full, limit, prefix.length)
    let open = fenceAfter(cut.head.split('\n'), null)
    if (open !== null && cut.head.length + 1 + open.marker.length > limit) {
      // Room for the closing fence.
      cut = cutAt(full, limit - 1 - open.marker.length, prefix.length)
      open = fenceAfter(cut.head.split('\n'), null)
    }
    parts.push(open === null ? cut.head : cut.head + '\n' + open.marker)
    carried = open
    rest = cut.tail
  }
  return parts.filter((part) => part.trim() !== '')
}

/** The messages to post for a Robot's text: tables fenced, then split to Discord's limit. */
export function discordMessages(text: string): string[] {
  return splitMessage(fenceTables(text))
}