/**
 * The SQL-counting seam of the scale test (v1.19 ticket 01): every statement a test Robot runs on its SQLite, with the
 * rows SQLite read for it (the cursor's rowsRead, the number Cloudflare bills), while a test counts. The test and the
 * Robot DO share this module (one isolate under the vitest plugin).
 */
export interface SqlRead {
  readonly query: string
  readonly bindings: readonly unknown[]
  readonly cursor: { readonly rowsRead: number }
}

let recording: SqlRead[] | undefined

/** Start recording every statement a Robot runs. */
export function countSqlReads(): void {
  recording = []
}

/** Stop recording; the statements run since countSqlReads. */
export function stopCountingSqlReads(): readonly SqlRead[] {
  const done = recording ?? []
  recording = undefined
  return done
}

/** Count this Robot's SQL while a test records: its storage's one SqlStorage gets an exec that records each statement. */
export function countSql(storage: DurableObjectStorage): void {
  const sql = storage.sql
  if (storage.sql !== sql) throw new Error('the storage gives a new SqlStorage on each access: the counting seam cannot hold')
  const exec = sql.exec.bind(sql)
  Object.defineProperty(sql, 'exec', {
    configurable: true,
    value: (query: string, ...bindings: SqlStorageValue[]) => {
      const cursor = exec(query, ...bindings)
      recording?.push({ query, bindings, cursor })
      return cursor
    },
  })
}
