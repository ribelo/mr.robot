import type { CredentialSave } from '@mr-robot/protocol'

/** What the owner does with a question or a credential request (v1.15): the card calls this, the page sends it. */
export type AskReply =
  | { readonly kind: 'option'; readonly value: string }
  | { readonly kind: 'custom'; readonly text: string }
  | { readonly kind: 'dismiss' }
  | { readonly kind: 'save'; readonly entry: Omit<CredentialSave, 'revision'> }
  | { readonly kind: 'decline' }
