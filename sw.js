/**
 * sw.js — minimal service worker for PWA installability.
 *
 * Intentionally does NOT cache the app shell (the app is large and updates
 * often, so stale caches would do more harm than good). It only exists so the
 * page is installable / "Add to Home Screen" and provides a network
 * pass-through fetch handler. Safe and self-updating.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
    // Network pass-through — no caching, so content is never stale.
    event.respondWith(fetch(event.request).catch(() => Response.error()));
});
