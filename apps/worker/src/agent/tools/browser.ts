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
      parameters: { properties: { url: { type: 'string', description: 'The http or https address to open' } }, required: ['url'] },
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
          action: { type: 'string', enum: ['click', 'type', 'select', 'check', 'press', 'scroll'], description: 'What to do on the element' },
          index: { type: 'integer', description: 'Element number from the latest observation (click, type, select, check)' },
          text: { type: 'string', description: 'Text to type (type)' },
          submit: { type: 'boolean', description: 'Press Enter after typing' },
          option: { type: 'string', description: 'Option to choose (select)' },
          checked: { type: 'boolean', description: 'true to tick the box, false to clear it (check; default true)' },
          key: { type: 'string', description: 'Key to press, for example Enter or Escape (press; default Enter)' },
          direction: { type: 'string', enum: ['up', 'down'], description: 'Scroll direction (scroll; default down)' },
        },
        required: ['action'],
      },
      execute: async (args) => renderObservation(await host.browserAct(toAction(args))),
    }),
    tool<{ text?: string; ms?: number }>({
      name: 'browser_wait',
      description: 'Wait until some text is visible on the page: the visible page text and the page title are searched (exact match, case-sensitive). With text, ms is the timeout (default 30 000 ms, at most 60 000) and the call throws when the text does not appear in time. Without text, wait ms milliseconds (default 1 000, at most 30 000).',
      parameters: { properties: { text: { type: 'string', description: 'Text to wait for in the visible page text or the page title' }, ms: { type: 'integer', description: 'With text: the timeout in milliseconds (default 30000). Without text: how long to wait (default 1000)' } } },
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
