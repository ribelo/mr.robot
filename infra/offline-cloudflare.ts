/**
 * A Cloudflare API that holds nothing: every lookup answers "not found" and every
 * list is empty, so planning against it shows a deployment from a clean account.
 */
export function useOfflineCloudflare(): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    if (!url.startsWith('https://api.cloudflare.com/')) throw new Error(`unexpected request during planning: ${url}`)
    if (url.includes('page=')) {
      return json(200, { success: true, errors: [], messages: [], result: [], result_info: { page: 1, per_page: 50, count: 0, total_count: 0, total_pages: 1 } })
    }
    const code = url.includes('/workers/') ? 10007 : 10006
    return json(404, { success: false, errors: [{ code, message: 'not found' }], messages: [], result: null })
  }) as typeof fetch
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
