// Deno-only web-push wrapper (RFC 8291/8292) over the verified @negrel/webpush
// 0.5.0 API. NEVER import this from web/ code or the pure modules — it uses Deno
// globals and the JSR specifier, and it holds the VAPID PRIVATE key.
//
// The library self-discloses that its crypto has not been expert-reviewed, so the
// payload is restricted to non-sensitive fields (title/body/url/tag) — never
// resume content, JD text, or secrets (T-3-21 unaudited-crypto mitigation).
import * as webpush from 'jsr:@negrel/webpush@0.5.0'

export interface PushPayload {
  title: string
  body: string
  url: string
  tag?: string
}

export type PushOutcome = 'sent' | 'gone' | 'failed'

// Lazy singleton: import the VAPID keys and build the ApplicationServer once per
// isolate. VAPID_KEYS is the JSON produced by the library's keygen script; keys
// are non-extractable so they cannot be exfiltrated from the running isolate.
let appServerPromise: Promise<webpush.ApplicationServer> | null = null

function applicationServer(): Promise<webpush.ApplicationServer> {
  if (!appServerPromise) {
    appServerPromise = (async () => {
      const vapidKeys = await webpush.importVapidKeys(
        JSON.parse(Deno.env.get('VAPID_KEYS')!),
        { extractable: false },
      )
      return await webpush.ApplicationServer.new({
        contactInformation: 'mailto:jk8839888@gmail.com',
        vapidKeys,
      })
    })()
  }
  return appServerPromise
}

// Send one push. Returns:
//   'sent'   — delivered to the push service (2xx).
//   'gone'   — TERMINAL: the subscription is dead (410 via isGone(), or 404 which
//              some push services use for dead endpoints). Caller deletes the row.
//   'failed' — TRANSIENT: any other error. Caller keeps the row retryable (F4).
export async function sendPush(
  subscriptionJson: unknown,
  payload: PushPayload,
): Promise<PushOutcome> {
  try {
    const appServer = await applicationServer()
    // deno-lint-ignore no-explicit-any
    const subscriber = appServer.subscribe(subscriptionJson as any)
    await subscriber.pushTextMessage(JSON.stringify(payload), {})
    return 'sent'
  } catch (err) {
    if (err instanceof webpush.PushMessageError) {
      if (err.isGone() || err.response.status === 404) return 'gone'
      return 'failed'
    }
    return 'failed'
  }
}
