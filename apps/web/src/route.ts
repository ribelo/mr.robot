import { useEffect, useState } from 'react'

export type Route =
  | { readonly page: 'home' }
  | { readonly page: 'robot'; readonly id: string; readonly panel: boolean }
  | { readonly page: 'trajectory'; readonly id: string }
  | { readonly page: 'advanced'; readonly id: string }
  | { readonly page: 'takeover'; readonly id: string }
  | { readonly page: 'files'; readonly id: string; readonly path: string | null }
  | { readonly page: 'admin' }
  | { readonly page: 'profile' }
  | { readonly page: 'pair'; readonly code: string }
  | { readonly page: 'this-computer' }
  | { readonly page: 'plugins' }
  | { readonly page: 'plugin'; readonly name: string }

export function parse(hash: string): Route {
  // A query after the path (#/me?connected=…) is for the page, not the route.
  const parts = hash.replace(/^#\/?/, '').split('?')[0]!.split('/').filter(Boolean)
  if (parts[0] === 'r' && parts[1] !== undefined) {
    const id = decodeURIComponent(parts[1])
    if (parts[2] === 'trajectory') return { page: 'trajectory', id }
    if (parts[2] === 'settings') return { page: 'advanced', id }
    if (parts[2] === 'takeover') return { page: 'takeover', id }
    if (parts[2] === 'files') return { page: 'files', id, path: parts.length > 3 ? parts.slice(3).map(decodeURIComponent).join('/') : null }
    return { page: 'robot', id, panel: parts[2] === 'panel' }
  }
  if (parts[0] === 'admin') return { page: 'admin' }
  if (parts[0] === 'me') return { page: 'profile' }
  if (parts[0] === 'this-computer') return { page: 'this-computer' }
  if (parts[0] === 'plugins') return parts[1] === undefined ? { page: 'plugins' } : { page: 'plugin', name: decodeURIComponent(parts[1]) }
  if (parts[0] === 'pair' && parts[1] !== undefined) return { page: 'pair', code: decodeURIComponent(parts[1]) }
  return { page: 'home' }
}

export function href(route: Route): string {
  switch (route.page) {
    case 'home': return '#/'
    case 'robot': return `#/r/${encodeURIComponent(route.id)}${route.panel ? '/panel' : ''}`
    case 'trajectory': return `#/r/${encodeURIComponent(route.id)}/trajectory`
    case 'advanced': return `#/r/${encodeURIComponent(route.id)}/settings`
    case 'takeover': return `#/r/${encodeURIComponent(route.id)}/takeover`
    case 'files': return `#/r/${encodeURIComponent(route.id)}/files${route.path === null ? '' : `/${route.path.split('/').map(encodeURIComponent).join('/')}`}`
    case 'admin': return '#/admin'
    case 'profile': return '#/me'
    case 'this-computer': return '#/this-computer'
    case 'pair': return `#/pair/${encodeURIComponent(route.code)}`
    case 'plugins': return '#/plugins'
    case 'plugin': return `#/plugins/${encodeURIComponent(route.name)}`
  }
}

export function go(route: Route): void {
  location.hash = href(route)
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.hash))
  useEffect(() => {
    const update = () => setRoute(parse(location.hash))
    addEventListener('hashchange', update)
    return () => removeEventListener('hashchange', update)
  }, [])
  return route
}
