/**
 * Calendar tools (v1.5 ticket 03, cn-s04t): calendars, events (list, search, read), create, update,
 * delete, respond to invitations, free/busy. Times are RFC 3339 or a date for all-day events.
 */
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { ConnectorRefused, type ConnectorHost, type ConnectorToolSpec } from '../connector.ts'
import { google, query } from './api.ts'

const CALENDAR = 'https://www.googleapis.com/calendar/v3'

const When = Schema.Struct({ dateTime: Schema.optional(Schema.String), date: Schema.optional(Schema.String), timeZone: Schema.optional(Schema.String) })
const Event = Schema.Struct({
  id: Schema.String,
  status: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  location: Schema.optional(Schema.String),
  start: Schema.optional(When),
  end: Schema.optional(When),
  htmlLink: Schema.optional(Schema.String),
  hangoutLink: Schema.optional(Schema.String),
  organizer: Schema.optional(Schema.Struct({ email: Schema.optional(Schema.String) })),
  attendees: Schema.optional(Schema.Array(Schema.Struct({ email: Schema.String, responseStatus: Schema.optional(Schema.String), self: Schema.optional(Schema.Boolean) }))),
})
type Event = typeof Event.Type
const Events = Schema.Struct({ items: Schema.optional(Schema.Array(Event)), timeZone: Schema.optional(Schema.String) })
const Calendars = Schema.Struct({ items: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.String, summary: Schema.optional(Schema.String), primary: Schema.optional(Schema.Boolean), accessRole: Schema.optional(Schema.String), timeZone: Schema.optional(Schema.String) }))) })
const FreeBusy = Schema.Struct({ calendars: Schema.Record(Schema.String, Schema.Struct({ busy: Schema.optional(Schema.Array(Schema.Struct({ start: Schema.String, end: Schema.String }))), errors: Schema.optional(Schema.Array(Schema.Unknown)) })) })
const Ignored = Schema.Unknown

const shown = (event: Event) => ({
  id: event.id,
  summary: event.summary ?? '(no title)',
  start: event.start?.dateTime ?? event.start?.date ?? null,
  end: event.end?.dateTime ?? event.end?.date ?? null,
  allDay: event.start?.date !== undefined,
  ...(event.location === undefined ? {} : { location: event.location }),
  ...(event.description === undefined ? {} : { description: event.description.slice(0, 2000) }),
  ...(event.attendees === undefined ? {} : { attendees: event.attendees.map((attendee) => ({ email: attendee.email, response: attendee.responseStatus ?? 'needsAction', ...(attendee.self === true ? { you: true } : {}) })) }),
  ...(event.hangoutLink === undefined ? {} : { meet: event.hangoutLink }),
  ...(event.status === 'cancelled' ? { cancelled: true } : {}),
  ...(event.htmlLink === undefined ? {} : { link: event.htmlLink }),
})

type Args = Record<string, unknown>
const str = (args: Args, key: string): string => (typeof args[key] === 'string' ? (args[key] as string) : '')
const calendarOf = (args: Args) => encodeURIComponent(str(args, 'calendarId') || 'primary')

/** A start or end as Calendar wants it: a date for all-day events, else a date-time with an optional zone. */
const time = (value: string, timeZone: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? { date: value } : { dateTime: value, ...(timeZone === '' ? {} : { timeZone }) })

/** The fields of an event the model may set; only those given are sent. */
function eventBody(args: Args): Record<string, unknown> {
  const zone = str(args, 'timeZone')
  return {
    ...(str(args, 'summary') === '' ? {} : { summary: str(args, 'summary') }),
    ...(typeof args['description'] === 'string' ? { description: args['description'] } : {}),
    ...(typeof args['location'] === 'string' ? { location: args['location'] } : {}),
    ...(str(args, 'start') === '' ? {} : { start: time(str(args, 'start'), zone) }),
    ...(str(args, 'end') === '' ? {} : { end: time(str(args, 'end'), zone) }),
    ...(Array.isArray(args['attendees']) ? { attendees: (args['attendees'] as unknown[]).filter((item): item is string => typeof item === 'string').map((email) => ({ email })) } : {}),
    ...(args['meet'] === true ? { conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}),
  }
}

const eventProperties = {
  calendarId: { type: 'string', description: 'Default: the primary calendar.' },
  summary: { type: 'string' },
  start: { type: 'string', description: 'RFC 3339 date-time (2026-10-09T10:00:00+02:00), or YYYY-MM-DD for an all-day event.' },
  end: { type: 'string', description: 'Like start; for an all-day event the day after the last day.' },
  timeZone: { type: 'string', description: 'IANA zone when start/end carry no offset.' },
  description: { type: 'string' },
  location: { type: 'string' },
  attendees: { type: 'array', items: { type: 'string' }, description: 'E-mail addresses; they get an invitation.' },
  meet: { type: 'boolean', description: 'Add a Google Meet link.' },
}

export function calendarTools(host: ConnectorHost): ReadonlyArray<ConnectorToolSpec<never>> {
  const specs: Array<ConnectorToolSpec<Args>> = [
    {
      name: 'calendar_calendars',
      service: 'calendar',
      description: 'List the calendars of the account: id, name, primary, your access, time zone.',
      parameters: { properties: {} },
      action: () => 'list calendars',
      run: (_args, use) => Effect.map(google(host, use, { method: 'GET', url: `${CALENDAR}/users/me/calendarList` }, Calendars), (body) => (body.items ?? []).map((item) => ({ id: item.id, name: item.summary ?? item.id, primary: item.primary === true, access: item.accessRole ?? null, timeZone: item.timeZone ?? null }))),
    },
    {
      name: 'calendar_events',
      service: 'calendar',
      description: 'List events between from and to (RFC 3339), recurring ones expanded, in time order; query searches titles, descriptions, places and attendees.',
      parameters: { properties: { calendarId: eventProperties.calendarId, from: { type: 'string' }, to: { type: 'string' }, query: { type: 'string' }, max: { type: 'number' } }, required: ['from', 'to'] },
      action: (args) => `events ${str(args, 'from')} – ${str(args, 'to')}${str(args, 'query') === '' ? '' : ` matching "${str(args, 'query')}"`}`,
      run: (args, use) => Effect.map(
        google(host, use, { method: 'GET', url: `${CALENDAR}/calendars/${calendarOf(args)}/events${query({ timeMin: str(args, 'from'), timeMax: str(args, 'to'), q: str(args, 'query') || undefined, singleEvents: true, orderBy: 'startTime', maxResults: Math.min(Number(args['max'] ?? 50) || 50, 250) })}` }, Events),
        (body) => ({ timeZone: body.timeZone ?? null, events: (body.items ?? []).map(shown) }),
      ),
    },
    {
      name: 'calendar_event',
      service: 'calendar',
      description: 'Read one event.',
      parameters: { properties: { calendarId: eventProperties.calendarId, eventId: { type: 'string' } }, required: ['eventId'] },
      action: (args) => `read event ${str(args, 'eventId')}`,
      run: (args, use) => Effect.map(google(host, use, { method: 'GET', url: `${CALENDAR}/calendars/${calendarOf(args)}/events/${encodeURIComponent(str(args, 'eventId'))}` }, Event), shown),
    },
    {
      name: 'calendar_create',
      service: 'calendar',
      description: 'Create an event. Attendees get an invitation e-mail.',
      parameters: { properties: eventProperties, required: ['summary', 'start', 'end'] },
      action: (args) => `create "${str(args, 'summary')}" ${str(args, 'start')}`,
      run: (args, use) => Effect.map(
        google(host, use, { method: 'POST', url: `${CALENDAR}/calendars/${calendarOf(args)}/events${query({ sendUpdates: Array.isArray(args['attendees']) ? 'all' : 'none', conferenceDataVersion: args['meet'] === true ? 1 : undefined })}`, json: eventBody(args) }, Event),
        shown,
      ),
    },
    {
      name: 'calendar_update',
      service: 'calendar',
      description: 'Change an event: only the fields given change. Attendees are told when they are on it.',
      parameters: { properties: { eventId: { type: 'string' }, ...eventProperties }, required: ['eventId'] },
      action: (args) => `update event ${str(args, 'eventId')}`,
      run: (args, use) => Effect.map(
        google(host, use, { method: 'PATCH', url: `${CALENDAR}/calendars/${calendarOf(args)}/events/${encodeURIComponent(str(args, 'eventId'))}${query({ sendUpdates: 'all', conferenceDataVersion: args['meet'] === true ? 1 : undefined })}`, json: eventBody(args) }, Event),
        shown,
      ),
    },
    {
      name: 'calendar_delete',
      service: 'calendar',
      description: 'Delete an event (attendees are told).',
      parameters: { properties: { calendarId: eventProperties.calendarId, eventId: { type: 'string' } }, required: ['eventId'] },
      action: (args) => `delete event ${str(args, 'eventId')}`,
      run: (args, use) => Effect.as(google(host, use, { method: 'DELETE', url: `${CALENDAR}/calendars/${calendarOf(args)}/events/${encodeURIComponent(str(args, 'eventId'))}?sendUpdates=all` }, Ignored), { deleted: true }),
    },
    {
      name: 'calendar_respond',
      service: 'calendar',
      description: 'Answer an invitation as the account: accepted, declined or tentative.',
      parameters: { properties: { calendarId: eventProperties.calendarId, eventId: { type: 'string' }, response: { type: 'string', enum: ['accepted', 'declined', 'tentative'] } }, required: ['eventId', 'response'] },
      action: (args) => `${str(args, 'response')} event ${str(args, 'eventId')}`,
      run: (args, use, account) => Effect.gen(function* () {
        const url = `${CALENDAR}/calendars/${calendarOf(args)}/events/${encodeURIComponent(str(args, 'eventId'))}`
        const event = yield* google(host, use, { method: 'GET', url }, Event)
        const attendees = event.attendees ?? []
        if (!attendees.some((attendee) => attendee.self === true || attendee.email.toLowerCase() === account.account.toLowerCase())) return yield* new ConnectorRefused({ message: `${account.account} is not invited to this event` })
        const answered = attendees.map((attendee) => (attendee.self === true || attendee.email.toLowerCase() === account.account.toLowerCase() ? { ...attendee, responseStatus: str(args, 'response') } : attendee))
        return shown(yield* google(host, use, { method: 'PATCH', url: `${url}?sendUpdates=all`, json: { attendees: answered } }, Event))
      }),
    },
    {
      name: 'calendar_freebusy',
      service: 'calendar',
      description: 'Busy times between from and to (RFC 3339) for the account\'s calendars or the ones named (e-mail addresses work for colleagues who share free/busy).',
      parameters: { properties: { from: { type: 'string' }, to: { type: 'string' }, calendars: { type: 'array', items: { type: 'string' } } }, required: ['from', 'to'] },
      action: (args) => `free/busy ${str(args, 'from')} – ${str(args, 'to')}`,
      run: (args, use) => Effect.map(
        google(host, use, { method: 'POST', url: `${CALENDAR}/freeBusy`, json: { timeMin: str(args, 'from'), timeMax: str(args, 'to'), items: (Array.isArray(args['calendars']) && args['calendars'].length > 0 ? (args['calendars'] as string[]) : ['primary']).map((id) => ({ id })) } }, FreeBusy),
        (body) => Object.fromEntries(Object.entries(body.calendars).map(([id, entry]) => [id, entry.busy ?? []])),
      ),
    },
  ]
  return specs as unknown as ReadonlyArray<ConnectorToolSpec<never>>
}
