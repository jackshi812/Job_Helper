// web/public/sw.js — vanilla service worker, no build step.
// Vite serves /public at the site root, so this file is reachable at /sw.js and
// registers with root scope. It has NO fetch handler (T-3-26: scope limited to
// push display + navigation) and ships as plain JS so there is no build coupling.

// Show a notification for every push. notify-tick sends either a single
// "Strong match: {title}" payload or a burst-collapsed "{n} strong matches"
// payload; the `tag` collapses repeated pushes so a burst never stacks.
self.addEventListener('push', (event) => {
  let data
  try {
    data = event.data ? event.data.json() : null
  } catch {
    data = null
  }
  if (!data) data = { title: 'New job matches', url: '/' }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      data: { url: data.url },
      tag: data.tag,
    }),
  )
})

// Route a notification click to the app. Resolve the target against our own
// origin and reject anything cross-origin BEFORE navigating (Codex SW-origin
// note): a malicious/garbled payload can never drive focus/openWindow to an
// off-origin URL. Prefer focusing an already-open same-origin tab and steering
// it to the target; only open a new window when no app tab exists (UI-SPEC:
// focus existing tab before opening a new one).
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const target = new URL(event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : '/', self.location.origin)
  if (target.origin !== self.location.origin) {
    target.href = self.location.origin + '/'
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const win of wins) {
        if (new URL(win.url).origin === self.location.origin && 'focus' in win) {
          return win.focus().then((focused) => {
            const nav = focused || win
            return nav.navigate ? nav.navigate(target.href) : nav
          })
        }
      }
      return clients.openWindow(target.href)
    }),
  )
})
