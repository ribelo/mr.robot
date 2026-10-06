/** "6:43 PM", "Yesterday", or "Sep 27" as in the robot list. */
export function listTime(at: number, now = Date.now()): string {
  const date = new Date(at)
  const today = new Date(now)
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  if (at >= startOfToday) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (at >= startOfToday - 86_400_000) return 'Yesterday'
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

/** "Yesterday 6:44 PM" separators inside a Conversation. */
export function separatorTime(at: number, now = Date.now()): string {
  const time = new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const day = listTime(at, now)
  return day.includes(':') ? time : `${day} ${time}`
}
