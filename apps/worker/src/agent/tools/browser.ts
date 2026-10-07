import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { BrowserAction } from '../../browser/driver.ts'
import { renderObservation, type Observation } from '../../browser/observe.ts'
import { tool } from './define.ts'

export interface BrowserHost {
  browserOpen(url: string): Promise<Observation>
  browserObserve(): Promise<Observation>
  browserAct(action: BrowserAction): Promise<Observation>
  browserWait(input: { text?: string; ms?: number }): Promise<Observation>
  browserScreenshot(): Promise<{ path: string; image: ScreenshotImage }>
}

/** Leash's primitives over Browser Rendering (robot-l9te): open, observe, act, screenshot, wait. */
export function browserTools(host: BrowserHost): ToolDefinition[] {
  return [
    tool<{ url: string }>({
      name: 'browser_open',
      description: 'Open a URL in your browser (it keeps your cookies and logins between Turns). Returns what is on the page.',
      parameters: { properties: { url: { type: 'string' } }, required: ['url'] },
      execute: async ({ url }) => renderObservation(await host.browserOpen(url)),
    }),
    tool<Record<string, never>>({
      name: 'browser_observe',
      description: 'Look at the current page: its numbered elements and text.',
      parameters: { properties: {} },
      execute: async () => renderObservation(await host.browserObserve()),
    }),
    tool<{ action: string; index?: number; text?: string; submit?: boolean; option?: string; checked?: boolean; key?: string; direction?: 'up' | 'down' }>({
      name: 'browser_act',
      description: 'Act on the page: click, type (into a text field, optionally submit with Enter), select (an option of a select), check (set a checkbox), press (a key such as Enter or Escape), scroll (up or down). Elements are referenced by the index from the latest observation. Returns the page after the action. Stop before payment or bank confirmation steps.',
      parameters: {
        properties: {
          action: { type: 'string', enum: ['click', 'type', 'select', 'check', 'press', 'scroll'] },
          index: { type: 'integer' },
          text: { type: 'string' },
          submit: { type: 'boolean' },
          option: { type: 'string' },
          checked: { type: 'boolean' },
          key: { type: 'string' },
          direction: { type: 'string', enum: ['up', 'down'] },
        },
        required: ['action'],
      },
      execute: async (args) => renderObservation(await host.browserAct(toAction(args))),
    }),
    tool<{ text?: string; ms?: number }>({
      name: 'browser_wait',
      description: 'Wait until some text appears on the page, or for a number of milliseconds.',
      parameters: { properties: { text: { type: 'string' }, ms: { type: 'integer' } } },
      execute: async (input) => renderObservation(await host.browserWait(input)),
    }),
    {
      // The screenshot comes back as an image the model sees (robot-cmz9), and is saved as the screen.
      name: 'browser_screenshot',
      description: 'Take a screenshot of the page. You see the image in the result; it is also saved in your Workspace and shown to your owner as your screen. Use it to read what the text observation cannot (image puzzles, charts, layout).',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: {
        schema: {},
        render: (_args: unknown, value: { path: string; image: ScreenshotImage }) => [
          { type: 'text', text: `Screenshot saved to ${value.path}.` },
          { type: 'image', attachment: value.image },
        ],
      },
      execute: async () => host.browserScreenshot(),
    } as unknown as ToolDefinition,
  ]
}

function toAction(args: { action: string; index?: number; text?: string; submit?: boolean; option?: string; checked?: boolean; key?: string; direction?: 'up' | 'down' }): BrowserAction {
  const index = () => {
    if (args.index === undefined) throw new Error(`${args.action} needs the element index`)
    return args.index
  }
  switch (args.action) {
    case 'click': return { action: 'click', index: index() }
    case 'type': return { action: 'type', index: index(), text: args.text ?? '', ...(args.submit === undefined ? {} : { submit: args.submit }) }
    case 'select': return { action: 'select', index: index(), option: args.option ?? '' }
    case 'check': return { action: 'check', index: index(), checked: args.checked ?? true }
    case 'press': return { action: 'press', key: args.key ?? 'Enter' }
    case 'scroll': return { action: 'scroll', direction: args.direction ?? 'down' }
    default: throw new Error(`unknown action ${args.action}`)
  }
}

/** A screenshot as DSH's image attachment reference; the id resolves to the Workspace file. */
export interface ScreenshotImage {
  readonly attachmentId: string
  readonly mediaType: 'image/png'
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly name: string
}
