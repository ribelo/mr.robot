/** Contacts (v1.5 ticket 04, cn-0c23): search and read people in the account's Google Contacts (read-only). */
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import type { ConnectorHost, ConnectorToolSpec } from '../connector.ts'
import { google, query } from './api.ts'

const PEOPLE = 'https://people.googleapis.com/v1'
const MASK = 'names,emailAddresses,phoneNumbers,addresses,organizations,birthdays,biographies'

const Person = Schema.Struct({
  resourceName: Schema.String,
  names: Schema.optional(Schema.Array(Schema.Struct({ displayName: Schema.optional(Schema.String) }))),
  emailAddresses: Schema.optional(Schema.Array(Schema.Struct({ value: Schema.String, type: Schema.optional(Schema.String) }))),
  phoneNumbers: Schema.optional(Schema.Array(Schema.Struct({ value: Schema.String, type: Schema.optional(Schema.String) }))),
  addresses: Schema.optional(Schema.Array(Schema.Struct({ formattedValue: Schema.optional(Schema.String), type: Schema.optional(Schema.String) }))),
  organizations: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.optional(Schema.String), title: Schema.optional(Schema.String) }))),
  birthdays: Schema.optional(Schema.Array(Schema.Struct({ date: Schema.optional(Schema.Struct({ year: Schema.optional(Schema.Number), month: Schema.optional(Schema.Number), day: Schema.optional(Schema.Number) })) }))),
  biographies: Schema.optional(Schema.Array(Schema.Struct({ value: Schema.optional(Schema.String) }))),
})
type Person = typeof Person.Type
const Search = Schema.Struct({ results: Schema.optional(Schema.Array(Schema.Struct({ person: Person }))) })

const shown = (person: Person) => ({
  id: person.resourceName,
  name: person.names?.[0]?.displayName ?? '',
  emails: (person.emailAddresses ?? []).map((entry) => (entry.type === undefined ? entry.value : `${entry.value} (${entry.type})`)),
  phones: (person.phoneNumbers ?? []).map((entry) => (entry.type === undefined ? entry.value : `${entry.value} (${entry.type})`)),
  ...(person.addresses === undefined ? {} : { addresses: person.addresses.map((entry) => entry.formattedValue ?? '').filter(Boolean) }),
  ...(person.organizations === undefined ? {} : { organization: [person.organizations[0]?.name, person.organizations[0]?.title].filter(Boolean).join(', ') }),
  ...(person.birthdays?.[0]?.date === undefined ? {} : { birthday: [person.birthdays[0].date.year, person.birthdays[0].date.month, person.birthdays[0].date.day].filter((part) => part !== undefined).join('-') }),
  ...(person.biographies?.[0]?.value === undefined ? {} : { notes: person.biographies[0].value }),
})

type Args = Record<string, unknown>
const str = (args: Args, key: string): string => (typeof args[key] === 'string' ? (args[key] as string) : '')

export function contactsTools(host: ConnectorHost): ReadonlyArray<ConnectorToolSpec<never>> {
  const specs: Array<ConnectorToolSpec<Args>> = [
    {
      name: 'contacts_search',
      service: 'contacts',
      description: 'Find people in Google Contacts by name, e-mail, phone or company: their addresses, phones and e-mails.',
      parameters: { properties: { query: { type: 'string' }, max: { type: 'number' } }, required: ['query'] },
      action: (args) => `search contacts "${str(args, 'query')}"`,
      run: (args, use) => Effect.gen(function* () {
        const url = (text: string) => `${PEOPLE}/people:searchContacts${query({ query: text, readMask: MASK, pageSize: Math.min(Number(args['max'] ?? 10) || 10, 30) })}`
        // The People API answers from a cache it fills on a first, empty search (its documented warm-up).
        yield* google(host, use, { method: 'GET', url: url('') }, Search)
        const found = yield* google(host, use, { method: 'GET', url: url(str(args, 'query')) }, Search)
        return (found.results ?? []).map((result) => shown(result.person))
      }),
    },
    {
      name: 'contacts_get',
      service: 'contacts',
      description: 'Read one contact by its id (people/…) from contacts_search.',
      parameters: { properties: { id: { type: 'string' } }, required: ['id'] },
      action: (args) => `read contact ${str(args, 'id')}`,
      run: (args, use) => Effect.map(google(host, use, { method: 'GET', url: `${PEOPLE}/${str(args, 'id').split('/').map(encodeURIComponent).join('/')}${query({ personFields: MASK })}` }, Person), shown),
    },
  ]
  return specs as unknown as ReadonlyArray<ConnectorToolSpec<never>>
}
