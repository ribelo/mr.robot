/**
 * The browser backends v1.16 removed (ob-ltsr): Container Chrome, via VPN, via proxy. Only the
 * migrations that move a Robot and the Home default off them read these names; nothing runs on them.
 */
const REMOVED_BROWSER_BACKENDS: ReadonlySet<string> = new Set(['container', 'container-vpn', 'container-proxy'])

/** Whether a stored backend name is one of the removed ones. */
export function isRemovedBrowserBackend(stored: unknown): boolean {
  return typeof stored === 'string' && REMOVED_BROWSER_BACKENDS.has(stored)
}
