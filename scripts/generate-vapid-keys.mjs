// VAPID keypair generator for the web-push path (Plan 03-07, Part A).
// Run: node scripts/generate-vapid-keys.mjs
//
// Emits the EXACT JSON shape @negrel/webpush's importVapidKeys consumes
// (verified against the library's exportVapidKeys source): an ECDSA P-256
// keypair exported as a { publicKey: JsonWebKey, privateKey: JsonWebKey } pair.
// That JSON becomes the edge secret VAPID_KEYS (used by _shared/webpush.ts).
//
// It also derives the base64url-encoded uncompressed public key point
// (0x04 || X || Y, 65 bytes) that the browser needs as VITE_VAPID_PUBLIC_KEY
// (consumed by web/src/lib/push.ts -> urlBase64ToUint8Array -> applicationServerKey).
//
// SECURITY: the private key is written ONLY to the gitignored scripts/vapid-keys.json.
// Nothing secret is printed to stdout — only the PUBLIC key (safe to ship in the
// SPA build) and the output path. Never commit scripts/vapid-keys.json.

import { webcrypto } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUTPUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'vapid-keys.json')

// base64url of a raw byte buffer (no padding), the encoding the Push API and
// VAPID both use for key material.
function base64url(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Decode a JWK base64url coordinate (x / y) back into its raw 32-byte buffer.
function decodeJwkCoordinate(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const bytes = Buffer.from(padded, 'base64')
  if (bytes.length !== 32) {
    throw new Error(`Expected a 32-byte P-256 coordinate, received ${bytes.length} bytes`)
  }
  return bytes
}

async function main() {
  const keyPair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true, // extractable so we can export both halves as JWK
    ['sign', 'verify'],
  )

  const publicKey = await webcrypto.subtle.exportKey('jwk', keyPair.publicKey)
  const privateKey = await webcrypto.subtle.exportKey('jwk', keyPair.privateKey)

  // The exact shape importVapidKeys expects.
  const vapidKeys = { publicKey, privateKey }

  // Browser applicationServerKey: uncompressed EC point 0x04 || X || Y.
  const uncompressed = Buffer.concat([
    Buffer.from([0x04]),
    decodeJwkCoordinate(publicKey.x),
    decodeJwkCoordinate(publicKey.y),
  ])
  const vapidPublicKey = base64url(uncompressed)

  writeFileSync(OUTPUT_PATH, `${JSON.stringify(vapidKeys, null, 2)}\n`, { mode: 0o600 })

  console.log('VAPID keypair generated (ECDSA P-256).')
  console.log(`  Private keypair JSON -> ${OUTPUT_PATH} (gitignored; set as edge secret VAPID_KEYS)`)
  console.log('  Public key (safe to publish) for VITE_VAPID_PUBLIC_KEY:')
  console.log(`    ${vapidPublicKey}`)
  console.log('')
  console.log('Next (Part B, hosted): set VAPID_KEYS from the JSON file as a Supabase edge secret,')
  console.log('and set VITE_VAPID_PUBLIC_KEY above in web/.env.local + the Cloudflare Pages env.')
}

main().catch((error) => {
  console.error(`generate-vapid-keys: FAILED — ${error instanceof Error ? error.message : 'unknown_error'}`)
  process.exit(1)
})
