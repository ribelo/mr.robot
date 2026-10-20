import type { CredentialSave } from '@mr-robot/protocol'

/** What the owner does with a question or a credential request (v1.15): the card calls this, the page sends it. */
export type AskReply =
  | { readonly kind: 'option'; readonly value: string }
  | { readonly kind: 'custom'; readonly text: string }
  /** A multi-select question (v1.17): every chosen value, and the owner's words when the question allows them. */
  | { readonly kind: 'options'; readonly values: readonly string[]; readonly text?: string }
  | { readonly kind: 'dismiss' }
  | { readonly kind: 'save'; readonly entry: Omit<CredentialSave, 'revision'> }
  | { readonly kind: 'decline' }
  /** "Always allow this" on a tool-call Ask (v1.17, dp-u9z9): its items go to allow for the Robot, and the call runs. */
  | { readonly kind: 'always-allow' }
  /**
   * Send a draft (v1.17, dp-wd2q): the owner's edit is stored first, so what goes is what the card shows (dp-qbt7). `alone`: "This Robot sends
   * on its own" (dp-ef0p), the write grant goes to allow as well.
   */
  | { readonly kind: 'send'; readonly edit?: DraftEditText; readonly alone?: true }

/** The owner's text of a draft. */
export interface DraftEditText {
  readonly body: string
  readonly subject?: string
}
