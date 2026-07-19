import { supabase } from './supabase'

// Browser-side web-push client. Mirrors the resumes.ts shape (guard/support
// check first, then the browser op, then the table write) so the enable flow
// is: register '/sw.js' -> request permission (INSIDE a user gesture) ->
// pushManager.subscribe with the VAPID public key -> upsert the subscription
// into push_subscriptions (own-row RLS, Plan 05). The private VAPID key never
// ships here; only VITE_VAPID_PUBLIC_KEY (provisioned in Plan 07) is consumed.

export type PushStatus = 'enabled' | 'disabled' | 'unsupported' | 'dead-subscription'

// Convert a base64url VAPID public key into the Uint8Array the Push API expects
// for applicationServerKey (standard MDN conversion).
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  const output = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i)
  }
  return output
}

function pushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window
  )
}

async function storedEndpoints(): Promise<Set<string>> {
  const { data, error } = await supabase.from('push_subscriptions').select('endpoint')
  if (error) throw error
  return new Set(((data ?? []) as { endpoint: string }[]).map((row) => row.endpoint))
}

// Re-subscribe health check run on every app load (RESEARCH Pitfall 3):
// - 'unsupported' when the browser lacks the service worker / Push APIs.
// - 'enabled' when the browser's current subscription endpoint is also stored.
// - 'dead-subscription' when the DB has a row for this user but the browser no
//   longer holds a matching subscription, or permission was revoked to 'denied'
//   while a row remains — the notice tells the user push fell back to email.
// - 'disabled' otherwise (nothing subscribed here yet).
export async function getPushStatus(): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported'

  const registration = await navigator.serviceWorker.getRegistration()
  const browserSub = registration ? await registration.pushManager.getSubscription() : null
  const stored = await storedEndpoints()

  if (browserSub && stored.has(browserSub.endpoint)) return 'enabled'

  const permissionDenied =
    typeof Notification !== 'undefined' && Notification.permission === 'denied'
  if (stored.size > 0 && (permissionDenied || !browserSub)) return 'dead-subscription'

  return 'disabled'
}

// MUST be called from a click handler: browsers auto-deny a permission request
// made outside a user gesture (RESEARCH deprecated-patterns note). Throws one of
// the three bounded reasons the Settings copy interpolates:
//   'browser unsupported' | 'permission denied' | 'subscription failed'.
export async function enablePushOnThisDevice(): Promise<void> {
  if (!pushSupported()) throw new Error('browser unsupported')

  const registration = await navigator.serviceWorker.register('/sw.js')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('permission denied')

  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (!vapidPublicKey) {
    // The public key ships in Plan 07; without it we cannot subscribe. Surface a
    // bounded machine code (never PII) and the bounded user-facing reason.
    console.error('vapid_key_missing')
    throw new Error('subscription failed')
  }

  let subscription: PushSubscription
  try {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    })
  } catch {
    throw new Error('subscription failed')
  }

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      endpoint: subscription.endpoint,
      subscription: subscription.toJSON(),
      user_agent: navigator.userAgent,
    },
    { onConflict: 'endpoint' },
  )
  if (error) throw error
}

// Unsubscribe this browser and delete the matching endpoint row so the health
// check no longer reports a stored subscription for this device.
export async function disablePushOnThisDevice(): Promise<void> {
  if (!pushSupported()) return

  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = registration ? await registration.pushManager.getSubscription() : null
  if (!subscription) return

  const { endpoint } = subscription
  await subscription.unsubscribe()

  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
  if (error) throw error
}
