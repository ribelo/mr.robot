import { createECDH } from 'node:crypto'

/**
 * The VAPID key pair is derived from one random 32-byte secret kept in Alchemy state:
 * the secret is the P-256 private scalar, the public key is computed from it.
 * @returns the uncompressed public key, base64url, as browsers expect for applicationServerKey.
 */
export function vapidPublicKey(privateKeyHex: string): string {
  const ecdh = createECDH('prime256v1')
  ecdh.setPrivateKey(privateKeyHex, 'hex')
  return ecdh.getPublicKey('base64url')
}
