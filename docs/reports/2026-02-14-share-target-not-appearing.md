# Share Target Not Appearing in Android Share Sheet

## Problem Summary

When a user tries to share a `.txt` file from WhatsApp or any other app on Android, the "Resumo de Grupo" PWA does not appear in the share sheet. This means the Share Target feature — which is supposed to let users send files directly to the app — is completely non-functional.

## Reproduction

- **Steps to reproduce**:
  1. Open the app in Chrome Android
  2. Install the PWA ("Add to Home Screen" or Chrome install prompt)
  3. Open WhatsApp, long-press on a message, export chat as `.txt`
  4. Tap "Share" on the exported file
  5. Look for "Resumo de Grupo" in the share sheet
- **Expected behavior**: App appears in the share sheet as an option
- **Actual behavior**: App does not appear at all

## Environment / Context

- Runtime: Chrome 76+ on Android (required for Web Share Target API)
- Hosting: Vercel (static + serverless)
- PWA: manifest.json with `share_target`, Service Worker registered via `app.js`

## Evidence from Repo

### Files Involved

- `public/manifest.json` — share_target config and icons
- `public/sw.js` — Service Worker (fetch handler)
- `public/share.html` — Share Target handler page
- `public/index.html` — apple-touch-icon reference
- `public/icons/` — SVG icon files only

### Key Snippets

**manifest.json:10-22** — SVG-only icons with combined purpose:
```json
"icons": [
  { "src": "/icons/icon-192.svg", "sizes": "192x192", "type": "image/svg+xml", "purpose": "any maskable" },
  { "src": "/icons/icon-512.svg", "sizes": "512x512", "type": "image/svg+xml", "purpose": "any maskable" }
]
```

**sw.js:35-39** — All POST requests skipped:
```javascript
self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/api/') || event.request.method !== 'GET') {
    return;
  }
```

**sw.js:2-8** — share.html not precached:
```javascript
const STATIC_ASSETS = [
  '/', '/index.html', '/styles.css', '/app.js', '/manifest.json'
];
```

**index.html:13** — References non-existent PNG icon:
```html
<link rel="apple-touch-icon" href="/icons/icon-192.png">
```

### System / Flow Explanation

The Web Share Target API works as follows:
1. The PWA **must be installed** on the device (added to home screen via Chrome). This is an absolute requirement — without installation, the share target is never registered and the app cannot appear in the share sheet.
2. Chrome reads `manifest.json` and registers `share_target` config
3. When the user shares a file matching the `accept` types, the PWA appears in the share sheet
4. Tapping the PWA triggers a POST to the `action` URL (`/share`) with `multipart/form-data`
5. The Service Worker should intercept this POST, cache the file data, and redirect to the app
6. The app page reads the cached data and processes it

## Findings

### Confirmed Facts

- The Service Worker explicitly skips all non-GET requests (line 37), so the POST from share target is never intercepted
- `share.html` expects data from `caches.open('share-target-cache').match('/share-target-data')`, but nothing ever writes to that cache
- `share.html` is not in the Service Worker's precache list
- `index.html:13` references `/icons/icon-192.png` which does not exist (404)
- Chrome/Lighthouse accepts SVG as a valid icon format for installability (PNG, SVG, and WebP are all supported)
- The `purpose: "any maskable"` combined value is valid per spec but discouraged by Chrome docs — separate entries are recommended

### ~~Corrected~~ Previously Incorrect Assumptions

- ~~"Chrome requires PNG icons for PWA installability"~~ — **WRONG.** Chrome accepts SVG icons. The Lighthouse installability audit accepts PNG, SVG, and WebP. SVG-only icons should NOT prevent installation.

### Unknowns / Critical Question

- **Has the user ever installed the PWA on their Android device?** The Share Target API ONLY works after the PWA is installed. If the user has only visited the website in the browser (without installing), the app will never appear in the share sheet — this is expected behavior, not a bug.

### Root Cause (Most Likely)

**Two issues, in order of likelihood:**

1. **MOST LIKELY — PWA not installed**: The user may not have installed the PWA (via "Add to Home Screen" or Chrome's install prompt). Without installation, the share target simply does not exist. The app visiting the website as a regular webpage will never show up in the share sheet. This is the most likely explanation.

2. **CONFIRMED BUG — SW skips POST**: Even if the PWA is installed and appears in the share sheet, tapping it would fail. The Service Worker's fetch handler skips all non-GET requests (`event.request.method !== 'GET'`). The POST from the share target goes to the network, Vercel serves `share.html` as static HTML, and the POST body (containing the shared file) is lost. The user sees a spinner and gets redirected to the home page with nothing.

3. **BUG — Cache mismatch**: `share.html` reads from a cache key (`/share-target-data` in `share-target-cache`) that nothing ever writes to.

### Alternative Hypotheses

- SVG icons with combined `purpose: "any maskable"` causing Chrome installability issues: **possible but unlikely**. Chrome docs discourage combining but don't forbid it.
- MIME type mismatch for `.txt` files: **unlikely**. `text/plain` and `.txt` are standard.
- Chrome version too old: **unlikely**. Share Target requires Chrome 76+ (2019).

## Fix Plan

### Minimal Safe Fix

**Step 0 — Verify PWA installation (CRITICAL FIRST STEP)**:
Before any code changes, verify whether the PWA can be installed:
1. Open the deployed app in Chrome Android
2. Look for the install banner or go to Chrome menu → "Install app" / "Add to Home Screen"
3. If the install option appears → install it and test the share target
4. If the install option does NOT appear → there's an installability issue to investigate

**Step 1 — Fix Service Worker to handle Share Target POST**:
Use the official web.dev pattern — cache the **individual file**, not the entire FormData (FormData round-trip through cache is unreliable with binary files):

```javascript
const CACHE_NAME = 'resumo-grupo-v2'; // Increment to force SW update
const STATIC_ASSETS = [
  '/', '/index.html', '/styles.css', '/app.js', '/manifest.json', '/share.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== 'share-target-cache')
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Handle Share Target POST — cache the shared file individually
  // (following web.dev official pattern: cache file, not FormData)
  if (url.pathname === '/share' && event.request.method === 'POST') {
    event.respondWith((async () => {
      const formData = await event.request.formData();
      const cache = await caches.open('share-target-cache');

      // Extract the shared file (check all possible field names)
      const file = formData.get('file') || formData.get('audio');

      if (file && file instanceof File) {
        // Cache the file blob directly (reliable for both text and binary)
        await cache.put('/shared-file', new Response(file));
        // Cache metadata separately (name, type) so we can reconstruct the File
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

  // Skip API calls and non-GET requests
  if (event.request.url.includes('/api/') || event.request.method !== 'GET') {
    return;
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) return response;
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const toCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, toCache));
        }
        return networkResponse;
      });
    })
  );
});
```

**Step 2 — Update app.js init to handle `?share-target`**:
```javascript
// In init():
if (location.search.includes('share-target')) {
  try {
    const cache = await caches.open('share-target-cache');
    const fileResp = await cache.match('/shared-file');
    const metaResp = await cache.match('/shared-meta');

    if (fileResp && metaResp) {
      const blob = await fileResp.blob();
      const meta = JSON.parse(await metaResp.text());

      // Clean cache immediately
      await cache.delete('/shared-file');
      await cache.delete('/shared-meta');

      // Reconstruct File with original name and type
      const file = new File([blob], meta.name, { type: meta.type });
      await handleFile(file);
    }
  } catch (err) {
    console.error('Error handling share target:', err);
  }
  // Clean URL regardless
  history.replaceState(null, '', '/');
  return;
}
```

**Step 3 — Add PNG icons (recommended, not critical)**:
While SVG icons are valid, adding PNG icons improves compatibility with older Chrome versions and ensures the apple-touch-icon reference works:
1. Generate `icon-192.png` and `icon-512.png` from existing SVGs
2. Update `manifest.json` with separate purpose entries:
   ```json
   "icons": [
     { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
     { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
     { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
     { "src": "/icons/icon-192.svg", "sizes": "any", "type": "image/svg+xml" },
     { "src": "/icons/icon-512.svg", "sizes": "any", "type": "image/svg+xml" }
   ]
   ```
   Note: SVG icons should use `"sizes": "any"` (not fixed dimensions) since SVGs are scalable.

### Long-Term Fix

Same as minimal fix. The architecture is correct — just has implementation bugs.

### Risks and Tradeoffs

- **Cache version**: Updating `sw.js` requires incrementing `CACHE_NAME` (e.g., `resumo-grupo-v2`) so the new SW replaces the old one on existing installs.
- **File metadata loss**: The cache approach stores the file blob and metadata separately. The filename and MIME type are preserved via the `/shared-meta` cache entry.
- **Activate event**: The new activate handler must NOT delete `share-target-cache` (only old version caches).

## Validation Plan

- **Step 1 — Verify installability (before any code changes)**:
  1. Open the deployed app in Chrome Android
  2. Open DevTools → Application → Manifest → check for installability errors
  3. If installable, install the PWA and test the share sheet

- **Step 2 — After code changes**:
  1. Deploy to Vercel
  2. Open in Chrome Android, verify "Install app" prompt appears
  3. Install the PWA
  4. Share a `.txt` file from Files app or WhatsApp
  5. Verify "Resumo de Grupo" appears in the share sheet
  6. Tap it and verify the file is loaded into the app
  7. Verify the summary flow works end to end

- **Monitoring**: Check Vercel function logs for `/api/upload` calls originating from share target flow

## Appendix

- [Receiving shared files — web.dev (official pattern)](https://web.dev/patterns/files/receive-shared-files) — **critical reference**, shows correct cache pattern
- [Web Share Target API — Chrome Docs](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target)
- [PWA Installability Criteria — Lighthouse](https://developer.chrome.com/docs/lighthouse/pwa/installable-manifest) — confirms SVG is accepted
- [MDN: manifest icons](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/icons) — SVG should use `sizes: "any"`

## Revision History

- **2026-02-14 (v2)**: Corrected SVG icon assessment — SVG IS accepted by Chrome for installability. Downgraded from BLOCKER to recommended improvement. Added "PWA not installed" as the most likely root cause. Fixed the cache approach to use individual file caching (web.dev official pattern) instead of `new Response(formData)` which is unreliable for binary data.
- **2026-02-14 (v1)**: Initial report — incorrectly classified SVG-only icons as a BLOCKER.
