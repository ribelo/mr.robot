import type { ReactNode } from 'react'
import { useAtomRefresh, useAtomValue } from '@effect/atom-react'
import * as Cause from 'effect/Cause'
import { AsyncResult, type Atom } from 'effect/reactivity'
import { describeFailure, type ApiFailure } from '../client/api-failure.ts'
import { ErrorState, Loading } from './States.tsx'

/**
 * An API atom on screen (fe-2hh0, pl-fxge): the loading state until the first value, the error
 * state with Try again on a failure, and the value afterwards (kept while a refresh runs).
 */
export function AtomView<A>({ atom, what, errorTitle, children }: {
  atom: Atom.Atom<AsyncResult.AsyncResult<A, ApiFailure>>
  what?: string
  errorTitle?: string
  children: (value: A) => ReactNode
}) {
  const result = useAtomValue(atom)
  const refresh = useAtomRefresh(atom)
  return <>{renderResult(result, { ...(what === undefined ? {} : { what }), ...(errorTitle === undefined ? {} : { errorTitle }), retry: refresh }, children)}</>
}

export function renderResult<A>(result: AsyncResult.AsyncResult<A, ApiFailure>, options: { what?: string; errorTitle?: string; retry?: () => void }, children: (value: A) => ReactNode): ReactNode {
  if (AsyncResult.isSuccess(result)) return children(result.value)
  if (AsyncResult.isFailure(result)) {
    const failure = Cause.findErrorOption(result.cause)
    const message = failure._tag === 'Some' ? describeFailure(failure.value) : 'something unexpected happened; reload the page'
    return <ErrorState {...(options.errorTitle === undefined ? {} : { title: options.errorTitle })} message={message} {...(options.retry === undefined ? {} : { onRetry: options.retry })} />
  }
  return <Loading {...(options.what === undefined ? {} : { what: options.what })} />
}
