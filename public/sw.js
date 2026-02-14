const CACHE_NAME = 'resumo-grupo-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/share.html'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean old caches (preserve share-target-cache)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== 'share-target-cache')
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch event
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Handle Share Target POST — cache the shared file individually
  // Following web.dev official pattern: cache file blob, not FormData
  // Reference: https://web.dev/patterns/files/receive-shared-files
  if (url.pathname === '/share' && event.request.method === 'POST') {
    event.respondWith((async () => {
      const formData = await event.request.formData();
      const cache = await caches.open('share-target-cache');

      // Check all possible field names from manifest share_target params
      const file = formData.get('audio') || formData.get('file');

      if (file && file instanceof File) {
        // Cache the file blob directly (reliable for both text and binary)
        await cache.put('/shared-file', new Response(file));
        // Cache metadata separately so we can reconstruct the File object
        await cache.put('/shared-meta', new Response(JSON.stringify({
          name: file.name,
          type: file.type,
          size: file.size,
        })));
      }

      return Response.redirect('/?share-target', 303);
    })());
    return;
  }

  // Skip API calls and non-GET requests - always go to network
  if (event.request.url.includes('/api/') || event.request.method !== 'GET') {
    return;
  }

  // Cache-first for static assets, fallback to network
  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        return response;
      }
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      });
    })
  );
});
