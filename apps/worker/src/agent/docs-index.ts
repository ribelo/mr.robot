/**
 * The "Docs" section of the platform prompt (v1.11 ticket 02, sk-xseb): the product docs with one
 * line each, and the rule to read the relevant doc before answering a question about the product.
 */
import { PRODUCT_DOCS } from '../docs/index.ts'

export function docsIndex(): string {
  return [
    'Docs',
    'The platform ships product docs in /workspace/docs/. They are read-only. Read them with the read tool.',
    ...PRODUCT_DOCS.map((entry) => `- ${entry.path}: ${entry.summary}`),
    'Before you answer a question about Mr. Robot, its features or your own capabilities, read the relevant doc. If the answer is not there, say you do not know.',
  ].join('\n')
}
