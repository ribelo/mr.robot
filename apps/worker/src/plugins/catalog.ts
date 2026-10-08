/**
 * Every plugin the Plugins page lists (cn-dbm9): the capability plugins a Robot is granted by tool
 * group, and the connectors. A plugin may carry a Home settings schema (its detail page form) and,
 * for connectors, how a person connects an account. Adding an entry adds its row and page; the
 * web app has no per-plugin code.
 */
import z from '@deepseek-ai/schemastery'
import type { ConnectMethod, ConnectorKind } from '@mr-robot/protocol'
import { TOOL_GROUPS, type ToolGroup } from '../agent/catalog.ts'

export interface ConnectorSpec {
  readonly kind: ConnectorKind
  readonly connect: ConnectSpec
}

/** Connect by OAuth consent with a service choice, or by pasting values described by a schema. */
export type ConnectSpec =
  | { readonly method: 'oauth'; readonly services: Extract<ConnectMethod, { method: 'oauth' }>['services'] }
  | { readonly method: 'paste'; readonly schema: z<unknown>; readonly instructions: string }

export interface PluginEntry {
  readonly name: string
  readonly title: string
  readonly description: string
  /** An icon name the web app draws (DSH icon set). */
  readonly icon: string
  readonly group: 'capability' | 'connector'
  /** Tool groups this plugin provides; a disabled plugin's groups are neither mounted nor grantable. */
  readonly toolGroups: readonly ToolGroup[]
  /** The Home's settings for the plugin (admin only); secret fields carry role "secret". */
  readonly homeConfig?: z<unknown>
  /** Setup steps in Markdown for the plugin page; origin is this Mr. Robot's address (callback URLs). */
  readonly guide?: (origin: string) => string
  /** What the admin still has to set up, given the saved values and which secrets are stored. */
  readonly setupNeeded?: (values: Readonly<Record<string, unknown>>, secretsSet: ReadonlySet<string>) => string | null
  readonly connector?: ConnectorSpec
}

const capability = (name: ToolGroup, title: string, icon: string, extra: Partial<PluginEntry> = {}): PluginEntry => ({
  name, title, description: TOOL_GROUPS[name], icon, group: 'capability', toolGroups: [name], ...extra,
})

export const PLUGINS: readonly PluginEntry[] = [
  capability('files', 'Files', 'folder'),
  capability('web', 'Web', 'globe'),
  capability('browser', 'Browser', 'browser'),
  capability('routines', 'Routines', 'alarm'),
  capability('messaging', 'Messaging', 'send'),
  capability('secrets', 'Logins', 'key'),
  capability('skills', 'Skills', 'sparkle'),
  capability('notify', 'Notifications', 'bell'),
  capability('exa', 'Exa research', 'search', {
    toolGroups: ['exa', 'exa-agent'],
    description: 'Web search, page crawling, code context and long agent runs through Exa, paid per call from the Home\'s key.',
    homeConfig: z.object({ apiKey: z.string().role('secret').description('Exa API key').comment('From dashboard.exa.ai → API keys. Calls are billed to this key.') }) as never,
    setupNeeded: (_values, secrets) => (secrets.has('apiKey') ? null : 'Add the Home\'s Exa API key.'),
  }),
  {
    name: 'google', title: 'Google', icon: 'google', group: 'connector', toolGroups: [],
    description: 'Gmail, Calendar, Drive with Docs and Sheets, and Contacts for the Google accounts people connect.',
    homeConfig: z.object({
      clientId: z.string().required().description('OAuth client ID').comment('From Google Auth Platform → Clients: the web client created for Mr. Robot.'),
      clientSecret: z.string().role('secret').required().description('OAuth client secret'),
    }) as never,
    setupNeeded: (values, secrets) => (typeof values['clientId'] === 'string' && values['clientId'] !== '' && secrets.has('clientSecret') ? null : 'The Home admin sets up the Google OAuth client once.'),
    guide: (origin) => [
      'Do this once for the whole Home. It takes a few screens in Google Cloud; nothing is installed.',
      '',
      '1. Open [console.cloud.google.com](https://console.cloud.google.com/projectcreate) and create a project named **Mr Robot**.',
      '2. Enable the APIs (use the project you just created): [Gmail](https://console.cloud.google.com/apis/library/gmail.googleapis.com), [Calendar](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com), [Drive](https://console.cloud.google.com/apis/library/drive.googleapis.com), [Docs](https://console.cloud.google.com/apis/library/docs.googleapis.com), [Sheets](https://console.cloud.google.com/apis/library/sheets.googleapis.com) and [People](https://console.cloud.google.com/apis/library/people.googleapis.com) — press **Enable** on each.',
      '3. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview) and press **Get started**: app name **Mr. Robot**, your e-mail as support and contact address, audience **External**. Then open [Audience](https://console.cloud.google.com/auth/audience) and press **Publish app** so the status is *In production*: in *Testing* Google ends every sign-in after 7 days. At sign-in Google warns that the app is unverified; for a private app that is expected: press **Advanced → Go to Mr. Robot (unsafe)**.',
      '4. Open [Clients](https://console.cloud.google.com/auth/clients) → **Create client** → type **Web application**, name **Mr. Robot**. Under **Authorized redirect URIs** add exactly:',
      '',
      `   \`${origin}/api/connections/google/oauth/callback\``,
      '',
      '5. Press **Create**, copy the **Client ID** and **Client secret** into the fields below and press **Save**.',
      '',
      'Then each person connects their own Google accounts under their name → Connections → Google, choosing which services each account grants.',
    ].join('\n'),
    connector: {
      kind: 'google',
      connect: {
        method: 'oauth',
        services: [
          { value: 'gmail', label: 'Gmail (read, label, draft)' },
          { value: 'gmail-send', label: 'Gmail sending' },
          { value: 'calendar', label: 'Calendar' },
          { value: 'drive', label: 'Drive, Docs and Sheets' },
          { value: 'contacts', label: 'Contacts' },
        ],
      },
    },
  },
  {
    name: 'slack', title: 'Slack', icon: 'slack', group: 'connector', toolGroups: [],
    description: 'Read a Slack workspace (channels, unread, threads, search, people) and, with a write grant, post and mark read.',
    connector: {
      kind: 'slack',
      connect: {
        method: 'paste',
        schema: z.object({
          token: z.string().role('secret').required().description('Token (xoxc-…)'),
          cookie: z.string().role('secret').required().description('Cookie d (xoxd-…)'),
        }) as never,
        instructions: 'Open the workspace in the browser and sign in. Press F12 → Console and run: JSON.parse(localStorage.getItem("localConfig_v2")).teams — copy the token starting with xoxc- . Then open Application → Cookies → https://app.slack.com and copy the cookie named d (it starts with xoxd-). Paste both here. If you sign out of Slack in that browser, paste them again.',
      },
    },
  },
  {
    name: 'discord', title: 'Discord', icon: 'discord', group: 'connector', toolGroups: [],
    description: 'A Discord bot on your server: Robots read and post in channels and DMs, and talk to you through their own channel.',
    guide: () => [
      'Do this once for the Home. The bot belongs to you, not to Mr. Robot: nothing is published anywhere.',
      '',
      '1. Open [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application**, name it **Mr. Robot** (or anything you like).',
      '2. Open **Bot**. Press **Reset Token** → **Yes, do it**, then **Copy**. In Mr. Robot open your name → **Connections** → Discord → **Connect**, paste the token and press **Connect**.',
      '3. On the same page, switch on **Message Content Intent** under *Privileged Gateway Intents* and press **Save Changes** — without it the bot cannot read messages.',
      '4. Your Discord connection then shows **Invite the bot to a server**: open it, pick your server and allow. The bot appears in the member list.',
      '5. Give a robot its channel: open the robot → ⚙ profile → *Talk to this Robot on Discord*, and paste the channel id (right-click the channel → Copy Channel ID with Developer Mode on).',
    ].join('\n'),
    connector: {
      kind: 'discord',
      connect: {
        method: 'paste',
        schema: z.object({
          token: z.string().role('secret').required().description('Bot token'),
        }) as never,
        instructions: 'Set up the bot once: open discord.com/developers/applications → New Application, name it Mr. Robot. In Bot, press Reset Token and copy it, and switch on Message Content Intent. Paste the token here; the row then shows the link that invites the bot to your server.',
      },
    },
  },
]

export const pluginByName = (name: string): PluginEntry | undefined => PLUGINS.find((plugin) => plugin.name === name)

/** Tool groups of the plugins the Home switched off. */
export function disabledToolGroups(enabled: Readonly<Record<string, boolean>>): Set<string> {
  return new Set(PLUGINS.filter((plugin) => enabled[plugin.name] === false).flatMap((plugin) => plugin.toolGroups))
}
