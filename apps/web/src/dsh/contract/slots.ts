/**
 * Trimmed from DSH ui-conversation contract/slots.ts: only the image and View props the
 * trajectory needs. The DSH shell (composer, workspace, file upload) is not part of Mr. Robot.
 */
import type { ReactNode } from 'react'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

export type MessageImageSource =
  | { readonly attachment: ImageAttachmentRef; readonly label?: string }
  | { readonly preview: { readonly url: string; readonly label?: string } }

export type MessageImageLoader = ((attachment: ImageAttachmentRef) => Promise<string>) & {
  peek?: (attachment: ImageAttachmentRef) => string | undefined
}

export interface MessageImagesOwnerProps {
  images: readonly MessageImageSource[]
  loadImage: MessageImageLoader
  align: 'start' | 'end'
  compact?: boolean
  thumbnail?: boolean
}

export type RenderMessageImages = (owner: Omit<MessageImagesOwnerProps, 'loadImage'>) => ReactNode

/** One-shot request to focus a record in a View. */
export interface ConversationViewRequest {
  readonly view: string
  readonly focus: string
}
