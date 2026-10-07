/**
 * Effect inside the Durable Objects (ticket 23, robot-naul): each DO runs its RPC methods as
 * Effect programs over services (SQLite, vaults, other DOs) and only adapts at the boundary.
 * Expected failures are typed; at the RPC boundary they become Errors whose name and status
 * survive Workers RPC, so the edge maps them to HTTP statuses.
 */
import * as Context from 'effect/Context'
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Cause from 'effect/Cause'
import * as Layer from 'effect/Layer'
import * as ManagedRuntime from 'effect/ManagedRuntime'

/** The thing asked for does not exist. */
export class NotFound extends Data.TaggedError('NotFound')<{ readonly message: string }> {}
/** The request is malformed or not allowed in the current state. */
export class Invalid extends Data.TaggedError('Invalid')<{ readonly message: string }> {}
/** Someone else changed it first, or it is busy. */
export class Conflict extends Data.TaggedError('Conflict')<{ readonly message: string }> {}

export type DurableError = NotFound | Invalid | Conflict

const STATUS: Record<DurableError['_tag'], number> = { NotFound: 404, Invalid: 400, Conflict: 409 }

export const notFound = (message: string) => new NotFound({ message })
export const invalid = (message: string) => new Invalid({ message })
export const conflict = (message: string) => new Conflict({ message })

/** One Durable Object's SQLite, as an Effect service. */
export interface SqlShape {
  all<T extends Record<string, SqlStorageValue>>(query: string, ...bindings: unknown[]): Effect.Effect<T[]>
  first<T extends Record<string, SqlStorageValue>>(query: string, ...bindings: unknown[]): Effect.Effect<T | undefined>
  run(query: string, ...bindings: unknown[]): Effect.Effect<void>
  /** Synchronous work in one SQLite transaction. */
  transaction<A>(work: () => A): Effect.Effect<A>
  /** The raw handle, for DSH packages that take SqlStorage themselves. */
  readonly raw: SqlStorage
}

export class Sql extends Context.Service<Sql, SqlShape>()('mr-robot/Sql') {}

export function sqlLayer(storage: DurableObjectStorage): Layer.Layer<Sql> {
  const raw = storage.sql
  return Layer.succeed(Sql)({
    raw,
    all: (query, ...bindings) => Effect.sync(() => raw.exec(query, ...bindings).toArray() as never),
    first: (query, ...bindings) => Effect.sync(() => raw.exec(query, ...bindings).toArray()[0] as never),
    run: (query, ...bindings) => Effect.sync(() => { raw.exec(query, ...bindings) }),
    transaction: (work) => Effect.sync(() => storage.transactionSync(work)),
  })
}

/** Small JSON values in a kv table (created by the DO). */
export const kvGet = <T>(key: string) => Effect.gen(function* () {
  const sql = yield* Sql
  const row = yield* sql.first<{ v: string }>('SELECT v FROM kv WHERE k = ?', key)
  return row === undefined ? undefined : (JSON.parse(row.v) as T)
})
export const kvSet = (key: string, value: unknown) => Effect.gen(function* () {
  const sql = yield* Sql
  yield* sql.run('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', key, JSON.stringify(value))
})
export const kvDelete = (key: string) => Effect.gen(function* () {
  const sql = yield* Sql
  yield* sql.run('DELETE FROM kv WHERE k = ?', key)
})

/** Runs a DO's programs; the boundary where typed failures become RPC errors. */
export class DurableRuntime<R> {
  private readonly runtime: ManagedRuntime.ManagedRuntime<R, never>

  constructor(layer: Layer.Layer<R>) {
    this.runtime = ManagedRuntime.make(layer)
  }

  async run<A>(program: Effect.Effect<A, DurableError | { readonly _tag: string; readonly message: string }, R>): Promise<A> {
    const exit = await this.runtime.runPromiseExit(program)
    if (Exit.isSuccess(exit)) return exit.value
    const failure = Cause.findErrorOption(exit.cause)
    if (failure._tag === 'Some') {
      const error = failure.value as { _tag?: string; message?: string }
      const status = STATUS[error._tag as DurableError['_tag']]
      throw Object.assign(new Error(error.message ?? String(error)), { name: error._tag ?? 'Error', ...(status === undefined ? {} : { status }) })
    }
    throw Cause.squash(exit.cause)
  }
}
