import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { RobotHost } from '../host.ts'
import { tool } from './define.ts'

export const ASK_MAX_OPTIONS = 6
const STYLES = ['default', 'primary', 'danger'] as const

interface AskInput {
  prompt: string
  help?: string
  options?: Array<{ label: string; value: string; description?: string; style?: (typeof STYLES)[number] }>
  allow_custom?: boolean
  multi_select?: boolean
  dismiss_on_move_on?: boolean
  urgent?: boolean
}

/**
 * The text form of a question, for a Channel without buttons (Discord, gb-viep, dp-rys9): the prompt, numbered options, how to answer.
 * The owner answers with the number of an option, or with several numbers when the question takes several (answerByNumbers).
 */
export function questionText(question: { readonly prompt: string; readonly help: string | null; readonly options: ReadonlyArray<{ readonly label: string; readonly description: string | null }>; readonly allowCustom: boolean; readonly multiSelect: boolean; readonly urgent: boolean }): string {
  const numbers = question.options.length === 0 ? null : question.multiSelect ? 'Answer with one or more numbers here (for example 1, 3)' : 'Answer with a number here'
  const custom = question.allowCustom || question.options.length === 0
  return [
    question.urgent ? `Urgent: ${question.prompt}` : question.prompt,
    ...(question.help === null ? [] : [question.help]),
    ...question.options.map((option, index) => `${index + 1}. ${option.label}${option.description === null ? '' : ` — ${option.description}`}`),
    numbers === null ? 'Answer in the app, or write your own answer here.' : `${numbers}${custom ? ', write your own answer,' : ''} or answer in the app.`,
  ].join('\n')
}

/**
 * The option values a text of numbers names (dp-rys9): "2", "1, 3", "1 3" or "1 and 3", 1-based in the question's order. Undefined when the
 * text is not only numbers, names a number with no option, or names several for a question that takes one: it is then an ordinary message.
 */
export function answerByNumbers(question: { readonly options: ReadonlyArray<{ readonly value: string }>; readonly multiSelect: boolean }, text: string): readonly string[] | undefined {
  const trimmed = text.trim()
  if (!/^\d+(?:\s*(?:,|;|&|\s|\band\b)\s*\d+)*\.?$/i.test(trimmed)) return undefined
  const numbers = [...new Set((trimmed.match(/\d+/g) ?? []).map(Number))]
  if (numbers.length === 0 || numbers.some((number) => number < 1 || number > question.options.length)) return undefined
  if (!question.multiSelect && numbers.length > 1) return undefined
  return numbers.sort((a, b) => a - b).map((number) => question.options[number - 1]!.value)
}

/**
 * Asking the owner (v1.15 ticket 03, gb-b4wz): one question with real options, stored as an Ask. The call returns at once; the Robot goes on
 * with work that does not depend on the answer, or ends its Turn, and the answer wakes it as a steer (gb-htdw, gb-1lfb).
 */
export function askTools(host: RobotHost): ToolDefinition[] {
  return [
    tool<AskInput>({
      name: 'ask',
      description: "Put one question to your owner, with options they answer in one tap. Ask only before a consequential or irreversible act, for a true ambiguity, or for a fact only they hold; otherwise decide, state your assumption and go on. Write the prompt as you would say it to them. Give up to 6 real options, the one you recommend first; never an option that is only a way out. Set multi_select when several options may be chosen together. The call returns at once: go on with work that does not depend on the answer, or end your Turn with one short line. You are woken with the answer, so do not wait or poll. A dismissal is an answer too: do not ask again. For a question to another Robot, use robot_send.",
      parameters: {
        properties: {
          prompt: { type: 'string', description: 'The question, in your owner\'s language' },
          help: { type: 'string', description: 'Optional: one line of context that helps them choose' },
          options: {
            type: 'array',
            description: `At most ${ASK_MAX_OPTIONS} options`,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                label: { type: 'string', description: 'What the button says, short' },
                value: { type: 'string', description: 'What you get back when they choose it' },
                description: { type: 'string', description: 'Optional: what choosing it does' },
                style: { type: 'string', enum: [...STYLES], description: 'primary: the recommended; danger: destructive or irreversible; default otherwise' },
              },
              required: ['label', 'value'],
            },
          },
          allow_custom: { type: 'boolean', description: 'Let them write their own answer; false when left out' },
          multi_select: { type: 'boolean', description: 'Let them choose several options; you get every chosen value. false when left out' },
          dismiss_on_move_on: { type: 'boolean', description: 'Dismiss the question if their next message arrives unanswered; for low-stakes questions. false when left out' },
          urgent: { type: 'boolean', description: 'Push "needs you" at once: only when waiting would do harm. false when left out' },
        },
        required: ['prompt'],
      },
      execute: async ({ prompt, help, options, allow_custom, multi_select, dismiss_on_move_on, urgent }) => {
        if (prompt.trim() === '') throw new Error('ask: parameter "prompt" is required and must not be empty.')
        const listed = options ?? []
        if (listed.length > ASK_MAX_OPTIONS) throw new Error(`ask: at most ${ASK_MAX_OPTIONS} options; you gave ${listed.length}. Keep the real ones.`)
        if (listed.length === 0 && allow_custom !== true) throw new Error('ask: give at least one option, or set allow_custom so they can answer in their own words.')
        if (multi_select === true && listed.length < 2) throw new Error('ask: multi_select needs at least two options to choose from.')
        const seen = new Set<string>()
        const clean = listed.map((option, index) => {
          if (option.label.trim() === '' || option.value.trim() === '') throw new Error(`ask: option ${index + 1} needs a label and a value.`)
          if (seen.has(option.value)) throw new Error(`ask: two options have the value "${option.value}"; each value must be its own.`)
          seen.add(option.value)
          if (option.style !== undefined && !STYLES.includes(option.style)) throw new Error(`ask: option "${option.label}" has the style "${option.style}"; use default, primary or danger.`)
          return { label: option.label.trim(), value: option.value, description: option.description?.trim() || null, style: option.style ?? 'default' }
        })
        const question = { prompt: prompt.trim(), help: help?.trim() || null, options: clean, allowCustom: allow_custom === true, multiSelect: multi_select === true, dismissOnMoveOn: dismiss_on_move_on === true, urgent: urgent === true }
        const asked = host.propose('question', question.prompt, { question })
        return { askId: asked.id, status: 'waiting', note: 'Your owner sees the question now. Go on with work that does not depend on it, or end your Turn with one short line; you will be woken with the answer.' }
      },
    }),
  ]
}
