/**
 * Recorded HTTP for the real connectors (v1.5): a test sets the responses its calls should get, and
 * every request is kept for assertions. No test reaches the network.
 */
export interface RecordedCall {
  readonly method: string
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: string | null
}

type Responder = (call: RecordedCall) => Response | undefined

export const connectorFixtures = {
  calls: [] as RecordedCall[],
  responders: [] as Responder[],
  reset(): void {
    this.calls = []
    this.responders = []
  },
  /** Answer requests whose method and URL match with a JSON body (or a Response). */
  on(method: string, url: string | RegExp, answer: unknown | ((call: RecordedCall) => unknown), status = 200): void {
    this.responders.push((call) => {
      if (call.method !== method) return undefined
      if (typeof url === 'string' ? !call.url.startsWith(url) : !url.test(call.url)) return undefined
      const value = typeof answer === 'function' ? (answer as (call: RecordedCall) => unknown)(call) : answer
      return value instanceof Response ? value : Response.json(value, { status })
    })
  },
  fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const body = request.body === null ? null : await request.text()
    const call: RecordedCall = { method: request.method, url: request.url, headers: Object.fromEntries(request.headers), body }
    connectorFixtures.calls.push(call)
    for (const responder of [...connectorFixtures.responders].reverse()) {
      const response = responder(call)
      if (response !== undefined) return response
    }
    return Response.json({ error: `no recorded response for ${call.method} ${call.url}` }, { status: 599 })
  },
}
