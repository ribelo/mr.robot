/**
 * Encryption at rest for user-level secrets and Provider credentials: AES-256-GCM with a key
 * derived from the deploy-level DATA_KEY (a Workers Secret) through HKDF, one key per purpose.
 */
import * as Context from 'effect/Context'
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'

export class VaultError extends Data.TaggedError('VaultError')<{ readonly message: string; readonly cause?: unknown }> {}

export interface VaultShape {
  seal(plaintext: string): Effect.Effect<string, VaultError>
  open(sealed: string): Effect.Effect<string, VaultError>
}

export class Vault extends Context.Service<Vault, VaultShape>()('mr-robot/Vault') {}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function hexBytes(hex: string): Uint8Array {
  const clean = hex.trim()
  if (!/^(?:[0-9a-f]{2}){32,}$/i.test(clean)) throw new Error('DATA_KEY must be at least 32 bytes of hex')
  return Uint8Array.from(clean.match(/../g)!.map((pair) => parseInt(pair, 16)))
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function unbase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
}

/** A Vault for one purpose ("credentials", "secrets"), keyed from DATA_KEY. */
export function makeVault(dataKey: string, purpose: string): VaultShape {
  let key: Promise<CryptoKey> | undefined
  const derive = () => {
    key ??= (async () => {
      const material = await crypto.subtle.importKey('raw', hexBytes(dataKey), 'HKDF', false, ['deriveKey'])
      return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('mr-robot'), info: encoder.encode(purpose) },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      )
    })()
    return key
  }
  return {
    seal: (plaintext) => Effect.tryPromise({
      try: async () => {
        const iv = crypto.getRandomValues(new Uint8Array(12))
        const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await derive(), encoder.encode(plaintext)))
        return `v1.${base64(iv)}.${base64(sealed)}`
      },
      catch: (cause) => new VaultError({ message: 'cannot encrypt', cause }),
    }),
    open: (sealed) => Effect.tryPromise({
      try: async () => {
        const [version, iv, body] = sealed.split('.')
        if (version !== 'v1' || iv === undefined || body === undefined) throw new Error('unknown sealed format')
        return decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64(iv) }, await derive(), unbase64(body)))
      },
      catch: (cause) => new VaultError({ message: 'cannot decrypt', cause }),
    }),
  }
}
