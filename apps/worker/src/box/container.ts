/**
 * A Robot's Box in a Cloudflare Container (v1.14 ticket 10): one container per Robot, keyed by its id, on the
 * image of infra/computer/Dockerfile. The Robot drives it through BoxBackend (backend.ts); the container
 * runs commands with the Container exec API and keeps no state the Robot needs: its disk is scratch.
 */
import { Container } from '@cloudflare/containers'
import type { Env } from '../env.ts'

const text = new TextDecoder()

export class ComputerContainer extends Container<Env> {
  /** A backstop only: the Robot stops its Box ten minutes after the last command (ao-joux). */
  override sleepAfter = '30m'
  /** setup.sh installs packages (ao-ia4z). */
  override enableInternet = true

  async begin(): Promise<void> {
    if (this.ctx.container?.running !== true) await this.start()
  }

  async running(): Promise<boolean> {
    return this.ctx.container?.running === true
  }

  /** One command under bash, killed after its time limit (exit code 124). */
  async run(command: string, cwd: string, seconds: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    this.renewActivityTimeout()
    const process = await this.ctx.container!.exec(['timeout', '--kill-after=5', String(seconds), 'bash', '-lc', command], { cwd, env: { HOME: '/root', PATH: '/usr/local/python/bin:/usr/local/bin:/usr/bin:/bin' } })
    const out = await process.output()
    return { stdout: text.decode(out.stdout), stderr: text.decode(out.stderr), exitCode: out.exitCode }
  }

  /** A file's bytes, or null when it is not there. */
  async read(path: string): Promise<Uint8Array | null> {
    const process = await this.ctx.container!.exec(['bash', '-lc', 'test -f "$0" && base64 -w0 "$0"', path], {})
    const out = await process.output()
    if (out.exitCode !== 0) return null
    return Uint8Array.from(atob(text.decode(out.stdout)), (char) => char.charCodeAt(0))
  }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    const encoded = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
    const stdin = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(encoded)); controller.close() } })
    const process = await this.ctx.container!.exec(['bash', '-lc', 'mkdir -p "$(dirname "$0")" && base64 -d > "$0"', path], { stdin })
    const out = await process.output()
    if (out.exitCode !== 0) throw new Error(`cannot write ${path}: ${text.decode(out.stderr)}`)
  }

  /** Every file under a directory with its size and change time: the manifest the sync compares. */
  async list(directory: string): Promise<Array<{ path: string; size: number; mtime: number }>> {
    const process = await this.ctx.container!.exec(['bash', '-lc', 'test -d "$0" && find "$0" -type f -printf "%P\\t%s\\t%T@\\n"', directory], {})
    const out = await process.output()
    return text.decode(out.stdout).split('\n').filter((line) => line !== '').map((line) => {
      const [path, size, mtime] = line.split('\t')
      return { path: path!, size: Number(size), mtime: Number(mtime) }
    })
  }

  async end(): Promise<void> {
    await this.stop().catch(() => undefined)
  }
}
