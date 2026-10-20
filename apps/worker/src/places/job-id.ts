/**
 * The name of a job: "j-" and eight hex digits, made by the Robot when a command starts (a Box job of v1.15 has the same shape). A job id
 * enters the code from a tool argument or a route, so it is parsed once there and carried as a JobId.
 */
import * as Schema from 'effect/Schema'

export const JobId = Schema.String.check(Schema.isPattern(/^j-[0-9a-f]{8}$/)).pipe(Schema.brand('JobId'))
export type JobId = typeof JobId.Type

/** A new job id. */
export const newJobId = (): JobId => Schema.decodeUnknownSync(JobId)(`j-${crypto.randomUUID().slice(0, 8)}`)

/** The job id a text is, or undefined when it is not one. */
export const parseJobId = (text: unknown): JobId | undefined => {
  const parsed = Schema.decodeUnknownOption(JobId)(text)
  return parsed._tag === 'Some' ? parsed.value : undefined
}
