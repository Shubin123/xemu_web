// Adds the cross-origin isolation headers needed by Emscripten pthreads on
// static hosts such as GitHub Pages. The first visit reloads once after this
// worker takes control; normal servers should still send these headers
// directly, which avoids the reload.
'use strict';
// Replaced by the build: all assets in this worker's scope use one release key.
const RELEASE = '__XEMU_RELEASE__';

self.addEventListener('install', event => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
    const requestUrl = new URL(event.request.url);
    if (requestUrl.origin !== self.location.origin) return;

    event.respondWith((async () => {
        let request = event.request;
        const scope = new URL(self.registration.scope);
        if (request.method === 'GET' && requestUrl.pathname.startsWith(scope.pathname)) {
            requestUrl.searchParams.set('xemu-release', RELEASE);
            // Navigation requests cannot be cloned with a new URL and mode=navigate.
            request = new Request(requestUrl, {headers: request.headers,
                credentials: request.credentials, mode: 'same-origin', redirect: 'follow'});
        }
        // Revalidate HTTP cache while OPFS game/console storage remains separate.
        const response = await fetch(request, {cache: 'no-cache'});
        if (response.type === 'opaque') return response;

        const headers = new Headers(response.headers);
        headers.set('Cross-Origin-Opener-Policy', 'same-origin');
        headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
        headers.set('Cross-Origin-Resource-Policy', 'same-origin');
        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
        });
    })());
});
