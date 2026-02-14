# Rethink v2: Share Target Not Appearing — What We're Still Missing

## What Was Previously Concluded

The [2026-02-13-rethink-share-target-not-appearing.md](2026-02-13-rethink-share-target-not-appearing.md) and [2026-02-14-share-target-not-appearing.md](2026-02-14-share-target-not-appearing.md) reports identified:

1. **SW skips POST** — Fixed: Service Worker now intercepts POST to `/share`
2. **SVG icons** — PNG icons added alongside SVG
3. **Manifest cache** — **RULED OUT**: User uninstalled and reinstalled; still doesn't work
4. **MIME wildcards** — Added `text/*`, `audio/*`, `application/ogg`
5. **Scope** — Added `"scope": "/"`
6. **All fixes deployed** — Yet the app still does NOT appear in the share sheet

**Critical new fact**: Uninstall + reinstall did NOT fix it. Hypothesis #1 from the previous rethink was wrong.

---

## Assumptions Challenged

| # | Assumption | Evidence Strength | Challenge | Test to Confirm |
|---|-----------|-------------------|-----------|-----------------|
| 1 | "Uninstall/reinstall fixes manifest cache" | **Refuted** | User did this; no change. Manifest cache was not the cause. | N/A |
| 2 | "Production manifest matches local" | **Weak** | Fetched production manifest shows `accept: ["text/plain", ".txt"]` for file — NO `text/*`. Audio has NO `audio/*` or `application/ogg`. NO `scope`. Local manifest has all of these. | Fetch `https://group-resume.vercel.app/manifest.json` and compare |
| 3 | "PWA installs as WebAPK" | **Unverified** | Share Target only works with WebAPK, NOT shortcut installs. Chrome creates WebAPK when installability criteria are met. If icons 404 or criteria fail, user gets shortcut → no share target. | Check Chrome DevTools Application > Manifest for installability errors |
| 4 | "Service Worker registers successfully" | **Weak** | `navigator.serviceWorker.register('/sw.js').catch(() => {});` — errors are swallowed. SW might be failing silently. | Add `catch(err => console.error('SW registration failed:', err))` and test |
| 5 | "Two files entries are valid" | **Spec-compliant** | Squoosh uses ONE entry: `{"name":"file","accept":["image/*"]}`. We use two (file + audio). Spec allows it, but Chrome might have edge cases. | Try consolidating to single entry with combined accept |
| 6 | "WhatsApp/Android send standard MIME types" | **Weak** | Android often uses `application/octet-stream` for unknown/exported files. Our accept arrays may not include it. | Add `application/octet-stream` and `*/*` to accept |
| 7 | "SW affects share sheet visibility" | **Correct** | SW only affects *receiving* the share. Visibility is determined at install/registration time from manifest. | N/A |

---

## Blind Spots Found

### 1. Production Deployment vs Local Manifest

**The production manifest at `https://group-resume.vercel.app/manifest.json` (fetched during this investigation) does NOT match the local manifest:**

| Field | Production (fetched) | Local (repo) |
|-------|---------------------|--------------|
| file accept | `["text/plain", ".txt"]` | `["text/plain", "text/*", ".txt"]` |
| audio accept | No `audio/*`, no `application/ogg` | Has both |
| scope | Absent | `"/"` |

If deployment is stale or CDN-cached, the *installed* PWA has the old manifest. The old manifest may not match MIME types sent by WhatsApp/Android (e.g. `application/octet-stream` for .txt).

### 2. WebAPK vs Shortcut — The Critical Distinction

**Share Target only works when the PWA is installed as a WebAPK**, not as a shortcut. Chrome creates WebAPKs when installability criteria are met. Shortcuts do NOT register with Android's share intent system.

**Installability requires:**
- 192px and 512px icons (must load, not 404)
- `display`: standalone/fullscreen/minimal-ui
- `start_url`, `name` or `short_name`
- HTTPS
- User engagement (30s + 1 click)

If any criterion fails, the user may get a "shortcut" install instead of WebAPK → no share target.

### 3. Service Worker Registration — Silent Failure

```javascript
navigator.serviceWorker.register('/sw.js').catch(() => {});
```

Any registration error is silently ignored. If the SW fails (e.g. scope, CORS, syntax), we never know. The spec recommends "Only register a web share target if it has a service worker" — Chrome may use this. If SW never registers, share target might not be registered.

### 4. Two Files Entries — Unexplored

Squoosh (working example) uses a single `files` entry with one wildcard: `"accept": ["image/*"]`. Our manifest has two entries (file + audio). The W3C spec allows this, but Chrome's implementation might have undocumented behavior with multiple entries.

### 5. `application/octet-stream` — Often Missing

When Android/WhatsApp exports a file, the share intent may send `application/octet-stream` if the system doesn't recognize the type. Our accept arrays do not include it. Per spec: *"If a file being shared is not accepted by any of a share target's files entries, the user MUST NOT be presented with that web share target."*

### 6. Action URL Format

Squoosh uses: `"action": "/?utm_medium=PWA&utm_source=share-target&share-target"` (root with query params). We use `"action": "/share"`. Both are valid. No evidence this matters, but worth noting.

### 7. Manifest `id` Field

Some implementations use `id` for PWA identity. Our manifest has no `id`. When absent, `start_url` is used. Unlikely to block share target, but could affect update behavior.

---

## Alternative Hypotheses

### Hypothesis 1: Production Manifest Is Stale (High Priority)

**Explanation**: The deployed manifest does not have `text/*`, `audio/*`, `application/ogg`, or `scope`. The user reinstalled with this stale manifest. WhatsApp/Android may send MIME types that don't match the production accept arrays.

**Evidence**: Direct fetch of production manifest showed older structure.

**Why it was missed**: Assumed "deployed" means "matches repo". CDN cache, build output, or deployment pipeline may serve old manifest.

**Quick test**: 
1. Fetch `https://group-resume.vercel.app/manifest.json` and verify it has `text/*`, `audio/*`, `scope`.
2. If stale: redeploy with cache bust, verify manifest, then uninstall + reinstall PWA.

---

### Hypothesis 2: PWA Installs as Shortcut, Not WebAPK (High Priority)

**Explanation**: Chrome did not create a WebAPK. The user has a shortcut, not a full PWA install. Shortcuts do not register share targets.

**Evidence**: Web.dev and Chrome docs state Share Target requires WebAPK. Installability failures (e.g. icon 404, missing fields) can result in shortcut-only install.

**Why it was missed**: "PWA is installed" was assumed sufficient. No verification that it's a WebAPK.

**Quick test**:
1. On Android: Settings > Apps > find "ResumoGrupo" or "Resumo de Grupo". If it appears as a Chrome/TWA app with full app entry (not just shortcut), it's likely WebAPK.
2. Chrome DevTools (remote debug): Application > Manifest — check for installability errors or warnings.
3. Try installing from Chrome's "Install app" / "Add to Home Screen" from the overflow menu (not bookmark). WebAPK is created from that flow.

---

### Hypothesis 3: Service Worker Fails to Register (Medium Priority)

**Explanation**: The SW fails during registration (e.g. path, scope, CORS). Chrome may require an active SW to register the share target. Silent catch hides the error.

**Evidence**: Empty catch block. Spec recommends SW for share target registration.

**Why it was missed**: No error logging; assumed SW works.

**Quick test**: Replace `catch(() => {})` with `catch(err => console.error('SW failed:', err))`. Open site on Android, check remote console. Or use Chrome DevTools Application > Service Workers.

---

### Hypothesis 4: `application/octet-stream` Not in Accept (Medium Priority)

**Explanation**: Android/WhatsApp sends exported files with `application/octet-stream`. Our accept arrays don't include it. Per spec, Chrome must NOT show the share target when the file doesn't match.

**Evidence**: Android commonly uses `application/octet-stream` for unknown types. Spec: "If a file being shared is not accepted by any of a share target's files entries, the user MUST NOT be presented with that web share target."

**Why it was missed**: Focus was on `text/plain`, `text/*`, `audio/*`. Generic binary type was not considered.

**Quick test**: Add `"application/octet-stream"` and optionally `"*/*"` to both file and audio accept arrays. Deploy, uninstall, reinstall, test.

---

### Hypothesis 5: Two Files Entries Cause Chrome Edge Case (Lower Priority)

**Explanation**: Chrome may mishandle manifests with multiple `files` entries. Squoosh uses one. Consolidating to a single entry with combined accept might resolve.

**Evidence**: Working example uses one entry. No spec violation with two, but implementation may differ.

**Why it was missed**: Spec allows multiple entries; no one compared with minimal working examples.

**Quick test**: Change to single entry:
```json
"files": [{
  "name": "file",
  "accept": ["text/plain", "text/*", ".txt", "application/octet-stream", "audio/*", "audio/ogg", "audio/opus", ".opus", ".ogg", ".mp3", ".m4a", ".wav", ".webm"]
}]
```
Update SW to use `formData.get('file')` only. Deploy, reinstall, test.

---

### Hypothesis 6: Vercel POST /share Behavior (Low Priority)

**Explanation**: When SW is not yet active, POST goes to network. Vercel route `/share` → `/share.html` might return 405 or wrong response for POST. Chrome could pre-validate the action URL.

**Evidence**: Unlikely to affect *visibility* (that's from manifest at install time). Would only affect *receiving* if SW isn't active.

**Why it was missed**: Focus was on manifest; server behavior for POST was not checked.

**Quick test**: `curl -X POST https://group-resume.vercel.app/share -F "file=@test.txt"` — check status and response.

---

## Recommended Next Steps

### 1. Verify Production Manifest (5 min)

```bash
curl -s https://group-resume.vercel.app/manifest.json | jq .
```

Confirm it includes `text/*`, `audio/*`, `application/ogg`, `scope`. If not, redeploy and bust cache.

### 2. Add Diagnostic Logging for SW (2 min)

In `app.js`, change:
```javascript
navigator.serviceWorker.register('/sw.js')
  .then(reg => console.log('SW registered:', reg.scope))
  .catch(err => console.error('SW registration failed:', err));
```

Test on Android with remote debugging. Confirm SW registers and activates.

### 3. Add `application/octet-stream` and `*/*` to Accept (2 min)

In manifest, add to both file and audio accept arrays. Covers Android's generic MIME for exported files.

### 4. Verify WebAPK Install (5 min)

On Android, install from Chrome menu "Install app" / "Add to Home Screen". Check Settings > Apps for a full app entry. Compare with a known-working PWA (e.g. Squoosh).

### 5. Try Single Files Entry (5 min)

Consolidate to one `files` entry with combined accept. Simpler structure matches Squoosh. Update SW to read only `formData.get('file')`.

### 6. Chrome DevTools Manifest Check (2 min)

Open site in Chrome (desktop or Android remote). Application > Manifest. Look for share_target or installability errors.

---

## Appendix

- **Related reports**: [2026-02-13-rethink-share-target-not-appearing.md](2026-02-13-rethink-share-target-not-appearing.md), [2026-02-14-share-target-not-appearing.md](2026-02-14-share-target-not-appearing.md)
- **Files explored**: `public/manifest.json`, `public/sw.js`, `public/app.js`, `vercel.json`, `public/share.html`, `public/index.html`
- **Spec**: [W3C Web Share Target Level 2](https://w3c.github.io/web-share-target/level-2/)
- **Working example**: [Squoosh manifest](https://squoosh.app/manifest.json) — single `files` entry, `accept: ["image/*"]`
- **WebAPK**: [web.dev WebAPKs](https://web.dev/articles/webapks) — Share Target requires WebAPK, not shortcut
- **Production manifest (fetched)**: Missing `text/*`, `audio/*`, `application/ogg`, `scope`
