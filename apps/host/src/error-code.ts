/** The OS-style code (ENOENT, EEXIST, ELOOP) of an error that has one, or one a DSH package set; undefined otherwise. */
export function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined
}
