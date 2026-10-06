import type {
  Conversation,
  Me,
  MemberView,
  ModelChoice,
  ModelOption,
  ProvidersView,
  ProposalView,
  RobotPanel,
  RobotSettings,
  RobotSummary,
  SendMessage,
  SettingsCatalog,
  SettingsPatch,
  Trajectory,
} from '@mr-robot/protocol'

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(path, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
    credentials: 'same-origin',
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })
  const body = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new ApiError(response.status, body.error ?? response.statusText)
  return body as T
}

export const api = {
  me: () => request<Me>('/api/me'),
  updateMe: (patch: Partial<Pick<Me, 'name' | 'timeZone' | 'quietHours'>>) => request('/api/me', { method: 'PATCH', body: patch }),
  memberFile: (name: string) => request<{ name: string; content: string }>(`/api/me/files/${name}`),
  writeMemberFile: (name: string, content: string) => request(`/api/me/files/${name}`, { method: 'PUT', body: { content } }),
  robots: () => request<RobotSummary[]>('/api/robots'),
  createRobot: (brief?: string) => request<{ id: string }>('/api/robots', { body: brief === undefined ? {} : { brief } }),
  conversation: (id: string) => request<Conversation>(`/api/robots/${id}/conversation`),
  trajectory: (id: string) => request<Trajectory>(`/api/robots/${id}/trajectory`),
  send: (id: string, message: SendMessage) => request(`/api/robots/${id}/messages`, { body: message }),
  panel: (id: string) => request<RobotPanel>(`/api/robots/${id}/panel`),
  catalog: (id: string) => request<SettingsCatalog>(`/api/robots/${id}/catalog`),
  updateSettings: (id: string, patch: SettingsPatch) => request<RobotSettings>(`/api/robots/${id}/settings`, { method: 'PATCH', body: patch }),
  answer: (id: string, proposal: ProposalView, approve: boolean) =>
    request<ProposalView>(`/api/robots/${id}/proposals/${proposal.id}`, { body: { revision: proposal.revision, approve } }),
  pause: (id: string) => request(`/api/robots/${id}/pause`, { body: {} }),
  resume: (id: string) => request(`/api/robots/${id}/resume`, { body: {} }),
  remove: (id: string) => request(`/api/robots/${id}`, { method: 'DELETE' }),
  deleteRoutine: (id: string, routine: string) => request(`/api/robots/${id}/routines/${routine}`, { method: 'DELETE' }),
  rewind: (id: string, atSeq: number) => request(`/api/robots/${id}/rewind`, { body: { atSeq } }),
  undoRewind: (id: string, rewind: string) => request(`/api/robots/${id}/rewinds/${rewind}/undo`, { body: {} }),
  upload: async (id: string, file: File) => {
    const response = await fetch(`/api/robots/${id}/files?name=${encodeURIComponent(file.name)}`, {
      method: 'PUT',
      headers: { 'content-type': file.type || 'application/octet-stream' },
      body: file,
    })
    if (!response.ok) throw new ApiError(response.status, 'upload failed')
    return (await response.json()) as { name: string; path: string; size: number; contentType: string }
  },
  subscribePush: (subscription: PushSubscriptionJSON, device: string) => request('/api/push/subscriptions', { body: { ...subscription, device } }),
  unsubscribePush: (endpoint: string) => request('/api/push/subscriptions', { method: 'DELETE', body: { endpoint } }),
  providers: () => request<ProvidersView>('/api/providers'),
  setApiKey: (provider: string, key: string, shared: boolean) => request(`/api/providers/${provider}`, { method: 'PUT', body: { key, shared } }),
  startOAuth: (provider: string) => request<{ url: string; userCode?: string }>(`/api/providers/${provider}/oauth/start`, { body: {} }),
  finishOAuth: (provider: string, shared: boolean, pasted?: string) =>
    request<{ connected: boolean }>(`/api/providers/${provider}/oauth/finish`, { body: pasted === undefined ? { shared } : { shared, pasted } }),
  shareProvider: (provider: string, shared: boolean) => request(`/api/providers/${provider}`, { method: 'PATCH', body: { shared } }),
  removeProvider: (provider: string) => request(`/api/providers/${provider}`, { method: 'DELETE' }),
  homeSettings: () => request<{ defaultModel: ModelChoice; robotSpendLimitUsd: number | null; memberSpendLimitUsd: number | null; models: ModelOption[] }>('/api/admin/settings'),
  updateHomeSettings: (patch: Record<string, unknown>) => request('/api/admin/settings', { method: 'PATCH', body: patch }),
  members: () => request<MemberView[]>('/api/admin/members'),
  invite: (email: string) => request<MemberView>('/api/admin/members', { body: { email } }),
  removeMember: (id: string) => request(`/api/admin/members/${id}`, { method: 'DELETE' }),
}