# Rethink: Share Target Not Appearing in Android Share Sheet

## What Was Previously Concluded

The [2026-02-14-share-target-not-appearing.md](2026-02-14-share-target-not-appearing.md) report identified:

1. **SW skips POST** — Fixed: Service Worker now intercepts POST to `/share`, caches file, redirects to `/?share-target`
2. **SVG icons** — Initially thought blocker; corrected: SVG is valid; PNG icons added for compatibility
3. **Cache mismatch** — Fixed: SW writes to `/shared-file` and `/shared-meta`; app.js reads from same keys
4. **PWA not installed** — User confirmed: PWA **IS** installed on Android

**Current state**: All fixes deployed. Manifest, sw.js, PNG icons verified at production. **Yet the app still does NOT appear in the share sheet.**

The previous investigation focused on *what happens when the user taps the app* (SW, cache). The real problem is **Chrome never shows the app as an option** — so the POST never happens. The SW fix was necessary but not sufficient.

---

## Assumptions Challenged

| # | Assumption | Evidence Strength | Challenge | Test to Confirm |
|---|-----------|-------------------|-----------|-----------------|
| 1 | "SW fix would make share target work" | Weak | SW fix only matters *after* user taps the app. If the app never appears, SW is irrelevant. | N/A — symptom is "doesn't appear" |
| 2 | "Manifest format is correct" | Circumstantial | No validation against spec or working examples. Squoosh uses `image/*` wildcard; we use specific types. | Compare with Squoosh/Fugu Journal manifests |
| 3 | "Installed PWA has current manifest" | Weak | Stack Overflow: manifest is cached at install; updates don't propagate. User may have old manifest. | Uninstall PWA, reinstall from fresh URL |
| 4 | "text/plain and .txt are sufficient for WhatsApp .txt" | Weak | WhatsApp/Android may send `application/octet-stream`, `text/*`, or wrong MIME. Spec: "If file not accepted, user MUST NOT be presented with that share target." | Add `text/*` wildcard; test with Files app share |
| 5 | "audio/opus, audio/ogg cover opus files" | Weak | Opus in Ogg uses `audio/ogg` or `audio/ogg;codecs=opus`. Parameters may affect matching. Squoosh uses `image/*` for simplicity. | Add `audio/*` wildcard |
| 6 | "Vercel handles POST to /share" | Irrelevant | When share target is invoked, Chrome sends POST to PWA origin. SW intercepts before network. Vercel never sees the POST. | N/A |
| 7 | "No scope needed" | Unverified | Action must be within scope. Default scope from start_url "/" is "/". /share should be in scope. | Add explicit `"scope": "/"` to rule out edge cases |

---

## Blind Spots Found

1. **Manifest caching at install** — Not investigated. Chrome/Android caches the manifest when the PWA is installed. If the user installed before share_target was added or before fixes, the cached manifest has no/wrong share_target. **Uninstall + reinstall** is the standard fix (Stack Overflow, Chrome docs).

2. **MIME type matching** — Previous report assumed `text/plain` and `.txt` are sufficient. The Level 2 spec states: *"If a file being shared is not accepted by any of a share target's files entries, the user MUST NOT be presented with that web share target as an option."* WhatsApp and Android may send:
   - `application/octet-stream` for unknown types
   - `text/*` variants
   - Wrong or missing MIME for .opus (e.g. `audio/ogg;codecs=opus`)

3. **Wildcard accept** — Working examples (Squoosh, Paul Kinlan) use `image/*` for images. We use specific MIME types. Adding `text/*` and `audio/*` would match more variants.

4. **Chrome DevTools validation** — No report of checking Application > Manifest for share_target errors. Chrome may show "property 'action' ignored, should be within scope" or other validation failures.

5. **Service Worker scope vs. share target** — SW is registered at `/sw.js` (scope `/`). Action is `/share`. Both are same-origin. But: when the PWA is launched from the share sheet, does the SW control the page immediately? The SW must be active *before* the POST. If the user hasn't opened the PWA recently, the SW might be terminated. However, this would affect *receiving* the share, not *appearing* in the sheet.

6. **Single share_target** — Spec allows only one share_target per manifest. We have one. Correct.

---

## Alternative Hypotheses

### Hypothesis 1: Manifest Cached at Install (Most Likely)

**Explanation**: Chrome/Android caches the manifest when the PWA is installed. The user installed the PWA when share_target was broken or missing. The cached manifest has no valid share_target, so the app never registers as a share target.

**Evidence**: Stack Overflow [PWA share target - manifest is not refreshing](https://stackoverflow.com/questions/60281451/pwa-share-target-manifest-is-not-refreshing): "Manifest updates don't automatically propagate to installed PWAs. The share target registration is cached by the system when the app is installed."

**Why it was missed**: Previous report focused on code fixes. The "PWA is installed" was treated as sufficient. No one verified that the *installed* manifest includes share_target.

**Quick test**: Uninstall the PWA completely (Android: long-press icon → App info → Uninstall, or remove from home screen and clear site data). Reinstall from `https://group-resume.vercel.app` in Chrome. Test share again.

---

### Hypothesis 2: MIME Type / Accept Mismatch

**Explanation**: WhatsApp or the Android share intent sends files with MIME types or names that don't match our `accept` arrays. Per spec, Chrome must NOT show the share target when the file doesn't match.

**Evidence**: 
- Level 2 spec: "If a file being shared is not accepted by any of a share target's files entries, the user MUST NOT be presented with that web share target."
- Android may use `application/octet-stream` for unknown types
- Opus files: `audio/ogg` or `audio/ogg;codecs=opus` — we have `audio/ogg` but parameter matching is implementation-dependent

**Why it was missed**: Previous report said "MIME type mismatch for .txt files: unlikely." No testing with actual WhatsApp/Android share intents.

**Quick test**: Add `text/*` and `audio/*` to accept arrays (like Squoosh uses `image/*`). Broader matching. If the app then appears, MIME was the issue.

---

### Hypothesis 3: Chrome DevTools Shows Validation Error

**Explanation**: The manifest has a validation error (e.g. action outside scope, malformed params) that causes Chrome to silently ignore share_target. DevTools would show it.

**Evidence**: Stack Overflow [PWA - Web Share Target "property 'action' ignored, should be within scope"](https://stackoverflow.com/questions/73266777/pwa-web-share-target-property-action-ignored-should-be-within-scope-of-man).

**Why it was missed**: No one checked Chrome DevTools > Application > Manifest for errors.

**Quick test**: Open `https://group-resume.vercel.app` in Chrome (desktop or Android with remote debugging). Application tab > Manifest. Look for errors or warnings on share_target.

---

### Hypothesis 4: Files Array Structure

**Explanation**: The `params.files` structure might be wrong. MDN says "files" can be "an object or an array of objects." We use an array. Level 2 spec uses array. But: each entry needs `name` and `accept`. Our structure matches. Low probability.

**Evidence**: Our manifest matches MDN and Level 2 examples.

**Quick test**: Compare character-by-character with Squoosh manifest. Squoosh: `"files":[{"name":"file","accept":["image/*"]}]` — single entry, wildcard. We have two entries. Valid per spec.

---

### Hypothesis 5: Scope Edge Case

**Explanation**: Default scope might not include `/share` in some Chrome/Android versions. Explicit `"scope": "/"` could resolve.

**Evidence**: Paul Kinlan's example uses explicit `"scope": "/share/"` for action `/share/image/`. Our default scope from start_url "/" should be "/", so /share is in scope. Weak.

**Quick test**: Add `"scope": "/"` to manifest. Uninstall, reinstall, test.

---

## Recommended Next Steps

1. **Uninstall and reinstall PWA** (5 min)  
   - Uninstall completely. Clear site data for group-resume.vercel.app if needed.  
   - Open https://group-resume.vercel.app in Chrome.  
   - Install via "Add to Home Screen" or install prompt.  
   - Share a .txt file from Files app (not WhatsApp first — simpler).  
   - If app appears → Hypothesis 1 (manifest cache) confirmed.

2. **Add MIME wildcards to manifest** (2 min)  
   - Change `"accept": ["text/plain", ".txt"]` to `"accept": ["text/*", "text/plain", ".txt"]`  
   - Change audio accept to include `"audio/*"` at the start  
   - Deploy. Uninstall, reinstall, test.  
   - If app appears → Hypothesis 2 (MIME mismatch) confirmed.

3. **Check Chrome DevTools Manifest** (2 min)  
   - Open site in Chrome. Application > Manifest.  
   - Look for share_target errors or warnings.  
   - Screenshot and document any issues.

4. **Add explicit scope** (1 min)  
   - Add `"scope": "/"` to manifest.  
   - Low cost, rules out scope edge cases.

5. **Test with Files app first** (diagnostic)  
   - Share a .txt from the Files app (or Downloads) instead of WhatsApp.  
   - If app appears for Files but not WhatsApp → WhatsApp sends different MIME/type.  
   - If app doesn't appear for either → manifest cache or validation issue more likely.

---

## Appendix

- **Related reports**: [2026-02-14-share-target-not-appearing.md](2026-02-14-share-target-not-appearing.md)
- **Files explored**: `public/manifest.json`, `public/sw.js`, `public/app.js`, `vercel.json`, `public/share.html`
- **Spec references**: [W3C Web Share Target Level 2](https://w3c.github.io/web-share-target/level-2/), [MDN share_target](https://developer.mozilla.org/en-US/docs/Web/Manifest/Reference/share_target)
- **Working examples**: [Squoosh manifest](https://squoosh.app/manifest.json) — `"accept": ["image/*"]`; [Paul Kinlan file share target](https://paul.kinlan.me/file-web-share-target)
- **Key spec quote**: "If a file being shared is not accepted by any of a share target's files entries, the user MUST NOT be presented with that web share target as an option."
