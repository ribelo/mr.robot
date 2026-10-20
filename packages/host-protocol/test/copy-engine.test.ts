/**
 * The copy engine (v1.16 ticket 06): parts up and ranges down over presigned URLs, with retries. R2 is a map of URL → bytes behind a `fetch`;
 * the expected bytes are made by the test and compared byte for byte.
 */
import { describe, expect, it } from 'vitest'
import { copyTimeoutMs, CopyFailed, downloadFile, uploadFile, type CopyIo, type TargetFile } from '../src/index.ts'

const bytesOf = (length: number) => Uint8Array.from({ length }, (_, index) => (index * 13 + (index >> 9)) & 255)

/** A fake R2: PUT stores the body under the part's URL, GET answers a range of what the URL holds. `faults` are the statuses (or 'network') of the next requests. */
function r2(objects: Map<string, Uint8Array>, faults: Array<number | 'network'> = []) {
  const requests: string[] = []
  const sleeps: number[] = []
  const io: CopyIo = {
    sleep: async (ms) => { sleeps.push(ms) },
    fetch: async (url, init) => {
      requests.push(`${init.method} ${url}`)
      const fault = faults.shift()
      if (fault === 'network') throw new TypeError('connection reset')
      if (fault !== undefined) return new Response('no', { status: fault })
      if (init.method === 'PUT') {
        objects.set(url, new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer()))
        return new Response(null, { status: 200, headers: { etag: `"etag-${url}"` } })
      }
      const held = objects.get(url)
      const range = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init.headers).get('range') ?? '')
      if (held === undefined || range === null) return new Response('no', { status: 404 })
      return new Response(held.slice(Number(range[1]), Number(range[2]) + 1), { status: 206 })
    },
  }
  return { io, requests, sleeps }
}

const file = (bytes: Uint8Array) => ({ size: async () => bytes.length, read: async (offset: number, length: number) => bytes.slice(offset, offset + length) })

function target() {
  const written = { bytes: new Uint8Array(0), finished: false, abandoned: false }
  const sink: TargetFile = {
    write: async (offset, piece) => {
      const grown = new Uint8Array(Math.max(written.bytes.length, offset + piece.length))
      grown.set(written.bytes)
      grown.set(piece, offset)
      written.bytes = grown
    },
    finish: async () => { written.finished = true },
    abandon: async () => { written.abandoned = true },
  }
  return { written, sink }
}

describe('upload', () => {
  it('sends each part of the file to its own link and returns the ETags in order', async () => {
    const bytes = bytesOf(2500)
    const objects = new Map<string, Uint8Array>()
    const { io } = r2(objects)
    const parts = [0, 1, 2].map((index) => ({ number: index + 1, url: `https://r2.test/part${index + 1}`, offset: index * 1000, length: Math.min(1000, 2500 - index * 1000) }))
    const etags = await uploadFile(file(bytes), bytes.length, parts, io)
    expect(etags).toEqual([{ number: 1, etag: '"etag-https://r2.test/part1"' }, { number: 2, etag: '"etag-https://r2.test/part2"' }, { number: 3, etag: '"etag-https://r2.test/part3"' }])
    expect([...objects.values()].flatMap((part) => [...part])).toEqual([...bytes])
  })

  it('tries a part again after a network failure and a busy R2, pausing longer each time, and then succeeds', async () => {
    const objects = new Map<string, Uint8Array>()
    const { io, requests, sleeps } = r2(objects, ['network', 503])
    await uploadFile(file(bytesOf(10)), 10, [{ number: 1, url: 'https://r2.test/only', offset: 0, length: 10 }], io)
    expect(requests).toHaveLength(3)
    expect(sleeps).toEqual([500, 1000])
    expect(objects.get('https://r2.test/only')).toEqual(bytesOf(10))
  })

  it('gives up after four attempts, naming the last answer', async () => {
    const { io, requests } = r2(new Map(), [500, 500, 500, 500, 500])
    const failure = await uploadFile(file(bytesOf(10)), 10, [{ number: 1, url: 'https://r2.test/only', offset: 0, length: 10 }], io).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(CopyFailed)
    expect((failure as Error).message).toBe('part 1 failed after 4 attempts: R2 answered 500')
    expect(requests).toHaveLength(4)
  })

  it('does not try a refusal again: an expired link says so at once', async () => {
    const { io, requests } = r2(new Map(), [403])
    const failure = await uploadFile(file(bytesOf(10)), 10, [{ number: 1, url: 'https://r2.test/only', offset: 0, length: 10 }], io).catch((error: unknown) => error)
    expect((failure as Error).message).toContain('R2 answered 403 (the link expired or was refused)')
    expect(requests).toHaveLength(1)
  })

  it('refuses a file that changed size while it was copied', async () => {
    const { io } = r2(new Map())
    const failure = await uploadFile(file(bytesOf(10)), 12, [{ number: 1, url: 'https://r2.test/only', offset: 0, length: 12 }], io).catch((error: unknown) => error)
    expect((failure as Error).message).toBe('the file changed while it was copied')
  })
})

describe('download', () => {
  it('fetches the object in ranges, writes them at their offsets and makes the file appear only at the end', async () => {
    const bytes = bytesOf(2500)
    const { io, requests } = r2(new Map([['https://r2.test/obj', bytes]]))
    const { written, sink } = target()
    const total = await downloadFile(sink, { url: 'https://r2.test/obj', size: 2500, partBytes: 1000 }, io)
    expect(total).toBe(2500)
    expect(written.bytes).toEqual(bytes)
    expect(written.finished).toBe(true)
    expect(requests).toHaveLength(3)
  })

  it('asks again for a range that came back short, and an empty object is an empty file', async () => {
    const bytes = bytesOf(100)
    const objects = new Map([['https://r2.test/obj', bytes]])
    let short = true
    const { io } = r2(objects)
    const inner = io.fetch
    const { written, sink } = target()
    const total = await downloadFile(sink, { url: 'https://r2.test/obj', size: 100, partBytes: 100 }, { ...io, fetch: async (url, init) => {
      const response = await inner(url, init)
      if (!short) return response
      short = false
      return new Response((await response.arrayBuffer()).slice(0, 40), { status: 206 })
    } })
    expect(total).toBe(100)
    expect(written.bytes).toEqual(bytes)
    const empty = target()
    expect(await downloadFile(empty.sink, { url: 'https://r2.test/none', size: 0, partBytes: 100 }, io)).toBe(0)
    expect(empty.written.finished).toBe(true)
  })

  it('leaves no file behind when a range cannot be fetched', async () => {
    const { io } = r2(new Map([['https://r2.test/obj', bytesOf(100)]]), [403])
    const { written, sink } = target()
    await expect(downloadFile(sink, { url: 'https://r2.test/obj', size: 100, partBytes: 50 }, io)).rejects.toBeInstanceOf(CopyFailed)
    expect(written.finished).toBe(false)
    expect(written.abandoned).toBe(true)
  })
})

describe('copy timeout', () => {
  it('allows two minutes and a second per megabyte, at most six hours', () => {
    expect(copyTimeoutMs(0)).toBe(120_000)
    expect(copyTimeoutMs(2_000_000_000)).toBe(120_000 + 2000_000)
    expect(copyTimeoutMs(10 ** 12)).toBe(6 * 3600_000)
  })
})
