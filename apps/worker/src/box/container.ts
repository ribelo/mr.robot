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

  /**
   * A job (v1.15 ticket 07): the command in its own session, stdout and stderr in /workspace/.jobs/<id>.out and .err, its exit code in
   * <id>.exit when it ends, its process group in <id>.pid. The exec call returns as soon as the command is started.
   */
  async spawn(job: string, command: string, cwd: string): Promise<void> {
    this.renewActivityTimeout()
    const script = [
      'mkdir -p /workspace/.jobs',
      // The wrapper is its own session leader; its pid is the process group the job runs in.
      'setsid nohup bash -c \'echo $$ > "$2.pid"; cd "$3"; bash -lc "$1" > "$2.out" 2> "$2.err" < /dev/null; echo $? > "$2.exit.tmp"; mv "$2.exit.tmp" "$2.exit"\' _ "$0" "/workspace/.jobs/' + job + '" "$1" > /dev/null 2>&1 < /dev/null &',
      'for i in 1 2 3 4 5 6 7 8 9 10; do test -f "/workspace/.jobs/' + job + '.pid" && exit 0; sleep 0.1; done',
      'exit 1',
    ].join('\n')
    const process = await this.ctx.container!.exec(['bash', '-c', script, command, cwd], { env: { HOME: '/root', PATH: '/usr/local/python/bin:/usr/local/bin:/usr/bin:/bin' } })
    const out = await process.output()
    if (out.exitCode !== 0) throw new Error(`the job did not start: ${text.decode(out.stderr)}`)
  }

  async status(job: string): Promise<{ state: 'running' } | { state: 'exited'; exitCode: number } | { state: 'gone' }> {
    const script = 'f="/workspace/.jobs/$0"; if [ -f "$f.exit" ]; then echo "exited $(cat "$f.exit")"; elif [ -f "$f.pid" ] && kill -0 "$(cat "$f.pid")" 2>/dev/null; then echo running; else echo gone; fi'
    const out = await (await this.ctx.container!.exec(['bash', '-c', script, job], {})).output()
    const [state, code] = text.decode(out.stdout).trim().split(' ')
    return state === 'running' ? { state: 'running' } : state === 'exited' ? { state: 'exited', exitCode: Number(code) } : { state: 'gone' }
  }

  async output(job: string, stream: 'out' | 'err', offset: number): Promise<{ text: string; bytes: number; size: number }> {
    const script = 'f="/workspace/.jobs/$0.$1"; test -f "$f" || { echo 0; exit 0; }; stat -c %s "$f"; tail -c +"$(( $2 + 1 ))" "$f" | head -c 262144 | base64 -w0'
    const out = await (await this.ctx.container!.exec(['bash', '-c', script, job, stream, String(offset)], {})).output()
    const [size = '0', body = ''] = text.decode(out.stdout).split('\n')
    const raw = Uint8Array.from(atob(body.trim()), (char) => char.charCodeAt(0))
    return { text: text.decode(raw), bytes: raw.length, size: Number(size) }
  }

  async killJob(job: string): Promise<void> {
    const script = 'f="/workspace/.jobs/$0.pid"; test -f "$f" || exit 0; p="$(cat "$f")"; kill -TERM -- "-$p" 2>/dev/null; ( sleep 5; kill -KILL -- "-$p" 2>/dev/null ) > /dev/null 2>&1 < /dev/null &'
    await (await this.ctx.container!.exec(['bash', '-c', script, job], {})).output()
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
