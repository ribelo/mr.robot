import type { ModelChoice, ModelOption } from '@mr-robot/protocol'

const PROVIDER_NAMES: Record<string, string> = {
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
  'workers-ai': 'Workers AI',
  openai: 'ChatGPT',
  anthropic: 'Claude',
  'opencode-go': 'OpenCode Go',
}

const providerName = (provider: string) => PROVIDER_NAMES[provider] ?? provider
const key = (option: { provider: string; model: string }) => `${option.provider}/${option.model}`

/**
 * Every model, grouped by Provider. A Provider the person has not connected stays visible but
 * disabled, labelled with where to connect it, so a missing model explains itself.
 */
export function ModelSelect({ value, models, unavailable, onChange }: {
  value: ModelChoice
  models: readonly ModelOption[]
  unavailable: readonly ModelOption[]
  onChange: (option: ModelOption) => void
}) {
  const groups = (list: readonly ModelOption[]) => [...new Set(list.map((option) => option.provider))].map((provider) => [provider, list.filter((option) => option.provider === provider)] as const)
  const current = models.find((option) => key(option) === key(value))
  // The Provider is connected (it offers other models) but no longer lists this one.
  const gone = current === undefined && models.some((option) => option.provider === value.provider)
  return (
    <>
      <select
        value={key(value)}
        onChange={(event) => {
          const option = models.find((entry) => key(entry) === event.target.value)
          if (option !== undefined) onChange(option)
        }}
      >
        {current === undefined ? <option value={key(value)}>{providerName(value.provider)}: {value.model} ({gone ? 'no longer offered' : 'not connected'})</option> : null}
        {groups(models).map(([provider, options]) => (
          <optgroup key={provider} label={providerName(provider)}>
            {options.map((option) => <option key={key(option)} value={key(option)}>{option.label.replace(/ \([^)]*\)$/, '')}</option>)}
          </optgroup>
        ))}
        {groups(unavailable).map(([provider, options]) => (
          <optgroup key={`off-${provider}`} label={`${providerName(provider)}: connect it under your name → Providers`}>
            {options.map((option) => <option key={`off-${key(option)}`} value={`off-${key(option)}`} disabled>{option.label.replace(/ \([^)]*\)$/, '')}</option>)}
          </optgroup>
        ))}
      </select>
      {current === undefined ? <small className="muted">{gone ? `${providerName(value.provider)} no longer lists this model; pick another one.` : 'This model\'s Provider is not connected; the Robot cannot run until you connect it or pick another model.'}</small> : null}
    </>
  )
}
