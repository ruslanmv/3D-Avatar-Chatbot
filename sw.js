/**
 * sw.js — minimal service worker for PWA installability.
 *
 * Intentionally does NOT cache the app shell (the app is large and updates
 * often, so stale caches would do more harm than good).
 *
 * WHY THERE IS NO event.respondWith() BELOW
 * ----------------------------------------
 * This used to be a "pass-through" handler:
 *
 *     event.respondWith(fetch(event.request).catch(() => Response.error()));
 *
 * That caches nothing, so it could never make anything faster — but it did put
 * the service worker in the path of every request, including navigations, and
 * it turned any hiccup into a hard failure. Whenever that fetch rejected — the
 * network dropping, or simply the user navigating away, which aborts requests
 * that are still in flight — the catch answered with Response.error(), which
 * the browser reports as:
 *
 *     The FetchEvent for "…/vrm-manager" resulted in a network error response:
 *     the promise was resolved with an error response object.
 *
 * and the page is dead, with the browser's own error/offline handling
 * bypassed because we already answered the request.
 *
 * A worker that adds nothing must not intercept. Registering a fetch listener
 * without calling respondWith leaves the request entirely to the browser (this
 * is a genuine no-op, not a re-issued request) while still presenting a fetch
 * handler for installability checks in older browsers.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {
    // Deliberately empty: no respondWith → the browser performs the request
    // itself, exactly as it would with no service worker at all.
});
