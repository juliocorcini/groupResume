# Audio Resume — Implementation Plan

> Add audio transcription and summarization to the GroupResume PWA.
> Users share a WhatsApp audio via the Android share sheet → the app transcribes it with Groq Whisper → summarizes it with Groq Llama → displays the result.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites — Fix Share Target First](#2-prerequisites--fix-share-target-first)
3. [Architecture](#3-architecture)
4. [Technical Feasibility](#4-technical-feasibility)
5. [Files to Modify](#5-files-to-modify)
6. [Files to Create](#6-files-to-create)
7. [Detailed Changes — Step by Step](#7-detailed-changes--step-by-step)
8. [What Does NOT Change](#8-what-does-not-change)
9. [Testing Plan](#9-testing-plan)
10. [Costs](#10-costs)
11. [Risks and Mitigations](#11-risks-and-mitigations)
12. [iOS Considerations](#12-ios-considerations)

---

## 1. Overview

### Current State

GroupResume is a PWA that receives WhatsApp chat exports (`.txt` files), parses them, and generates AI summaries using Groq's Llama models. It's hosted on Vercel with serverless functions.

### Goal

Add a new mode: **Audio Resume**. The user shares an audio message from WhatsApp (via Android share sheet), and the app:

1. Receives the audio file (`.opus`/`.ogg`)
2. Sends it to the server for transcription (Groq Whisper)
3. Summarizes the transcription (Groq Llama)
4. Displays both the summary and the full transcription

### Why This Works

- **Same stack**: TypeScript + Vercel + Groq SDK (already in the project)
- **Same pattern**: Share Target API (already configured, needs bugfix)
- **Same hosting**: Vercel free tier (audio files are small enough)
- **Zero new dependencies**: `groq-sdk` already supports `audio.transcriptions.create()`

---

## 2. Prerequisites — Fix Share Target First

> **The current Share Target is broken.** It must be fixed before adding audio support.
> See: [docs/reports/2026-02-14-share-target-not-appearing.md](reports/2026-02-14-share-target-not-appearing.md)

### Summary of Issues

| # | Issue | Impact | Fix |
|---|-------|--------|-----|
| 1 | PWA not installed by user | **BLOCKER** | User must install PWA via "Add to Home Screen" — Share Target only works after installation |
| 2 | Service Worker skips POST requests | **BLOCKER** | Intercept POST to `/share`, cache individual file (web.dev pattern), redirect |
| 3 | `share.html` reads from unwritten cache | **BUG** | Fixed by SW writing to the correct cache key |
| 4 | SVG-only icons (no PNG) | **RECOMMENDED** | Add PNG icons for wider compatibility (SVG IS valid but PNG is safer) |
| 5 | `share.html` not in SW precache | **MINOR** | Add to `STATIC_ASSETS` |
| 6 | `index.html` references non-existent PNG | **MINOR** | Fixed by adding PNG icons |

**These must be fixed BEFORE the audio feature, as audio sharing depends on the same Share Target mechanism.**

---

## 3. Architecture

### Flow Diagram

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  WhatsApp    │     │  Android Share    │     │  GroupResume     │
│  (audio msg) │────▶│  Sheet           │────▶│  PWA             │
└─────────────┘     └──────────────────┘     └────────┬────────┘
  User holds &                                         │
  taps "Share"                                         │
                                                       ▼
                                              ┌─────────────────┐
                                              │  Service Worker  │
                                              │  intercepts POST │
                                              │  caches audio    │
                                              │  redirects to /  │
                                              └────────┬────────┘
                                                       │
                                                       ▼
                                              ┌─────────────────┐
                                              │  app.js detects  │
                                              │  ?share-target   │
                                              │  reads from cache│
                                              │  detects audio   │
                                              └────────┬────────┘
                                                       │
                                                       ▼
                                              ┌─────────────────┐
                                              │  POST /api/      │
                                              │  transcribe      │
                                              │  (FormData with  │
                                              │   audio file)    │
                                              └────────┬────────┘
                                                       │
                                          ┌────────────┴────────────┐
                                          ▼                         ▼
                                  ┌──────────────┐        ┌──────────────┐
                                  │ Groq Whisper │        │ Groq Llama   │
                                  │ Transcription│───────▶│ Summarization│
                                  └──────────────┘  text  └──────┬───────┘
                                                                  │
                                                                  ▼
                                                        ┌──────────────┐
                                                        │ Response:    │
                                                        │ transcription│
                                                        │ + summary    │
                                                        └──────┬───────┘
                                                                │
                                                                ▼
                                                      ┌──────────────────┐
                                                      │ Display result:  │
                                                      │ summary (main)   │
                                                      │ transcription    │
                                                      │ (expandable)     │
                                                      │ copy / share     │
                                                      └──────────────────┘
```

### Alternative Input (Manual Upload)

Users can also open the app directly and tap an upload button to select an audio file. This is the fallback for iOS (where Share Target API is not supported) and for desktop use.

---

## 4. Technical Feasibility

### 4.1 Audio File Sizes

WhatsApp uses Opus codec (very efficient compression).

| Duration | Typical Size | Vercel Limit | Groq Limit |
|----------|-------------|--------------|------------|
| 1 min    | ~100 KB     | 4.5 MB       | 25 MB      |
| 4 min    | ~400 KB     | 4.5 MB       | 25 MB      |
| 10 min   | ~1 MB       | 4.5 MB       | 25 MB      |
| 30 min   | ~3 MB       | 4.5 MB       | 25 MB      |

**Verdict**: All common WhatsApp audio durations fit within both Vercel and Groq limits.

### 4.2 Processing Time vs. Vercel Timeout

| Step | Estimated Time |
|------|---------------|
| Upload audio (400 KB) | ~200 ms |
| Groq Whisper transcription (4 min audio) | ~1-2 s (216x real-time) |
| Groq Llama summarization | ~1-2 s |
| **Total** | **~3-5 s** |
| Vercel timeout (with increase) | **30 s** |

**Verdict**: Fits comfortably. Even 30-minute audios process in ~5-8 seconds.

### 4.3 Audio Format Compatibility

- WhatsApp sends audio as **Ogg Opus** (`.opus` extension)
- Groq Whisper API accepts: `flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm`
- **OGG is natively supported — no format conversion (ffmpeg) needed**

### 4.4 Groq Free Tier Limits (Daily)

| Resource | Daily Limit | Enough For |
|----------|-------------|------------|
| Whisper: audio seconds | 28,800 (8 hours) | ~120 four-minute audios |
| Whisper: requests/min | 20 | Fine for personal use |
| Llama 8B: requests/day | 14,400 | More than enough |
| Max file size | 25 MB | Covers all WhatsApp audios |

### 4.5 Share Target API Compatibility

| Platform | Supported | Notes |
|----------|-----------|-------|
| Android (Chrome 76+) | Yes | PWA must be installed |
| Android (Samsung Browser) | Yes | Chromium-based |
| iOS (Safari) | **No** | Manual upload as fallback |
| Desktop (Chrome 89+) | Yes | Less useful but works |

---

## 5. Files to Modify

| # | File | What Changes | Why |
|---|------|-------------|-----|
| 1 | `public/manifest.json` | Add audio MIME types to `share_target.params.files` | Accept audio files from share sheet |
| 2 | `public/sw.js` | Intercept POST to `/share`; handle both text and audio files | Share Target requires SW to process the POST |
| 3 | `public/index.html` | Add audio upload area, audio result section, audio-specific UI | New UI for audio mode |
| 4 | `public/app.js` | Add `handleAudioFile()`, update `init()` for share-target detection, audio upload events | Frontend logic for audio flow |
| 5 | `public/styles.css` | Add styles for audio result, transcription details, audio upload area | Visual styling for new sections |
| 6 | `vercel.json` | Add `api/transcribe.ts` with `maxDuration: 30` | Audio processing needs more time than text |
| 7 | `public/manifest.json` | Add PNG icons (part of Share Target bugfix) | Fix PWA installability |
| 8 | `public/share.html` | Simplify to be a fallback page (SW handles the main flow) | Cleanup |

---

## 6. Files to Create

| # | File | Purpose |
|---|------|---------|
| 1 | `api/transcribe.ts` | **Main new endpoint** — receives audio, transcribes (Whisper), summarizes (Llama), returns both |
| 2 | `public/icons/icon-192.png` | PNG icon for PWA installability |
| 3 | `public/icons/icon-512.png` | PNG icon for PWA installability |

**No new npm dependencies.** The existing `groq-sdk` handles both Whisper and Llama.

---

## 7. Detailed Changes — Step by Step

### Step 1: Fix Share Target (prerequisite)

See [docs/reports/2026-02-14-share-target-not-appearing.md](reports/2026-02-14-share-target-not-appearing.md) for the full fix plan. Summary:

1. Generate PNG icons from existing SVGs
2. Update `manifest.json` icons array with PNG entries
3. Update `sw.js` to intercept POST to `/share`
4. Add `share.html` to SW precache
5. Update `app.js` init to read from `?share-target` cache

### Step 2: Update manifest.json — Accept Audio Files

**Current** `share_target.params.files`:
```json
"files": [
  { "name": "file", "accept": ["text/plain", ".txt"] }
]
```

**New**:
```json
"files": [
  { "name": "file", "accept": ["text/plain", ".txt"] },
  { "name": "audio", "accept": [
    "audio/ogg", "audio/opus", "audio/mpeg", "audio/mp4",
    "audio/wav", "audio/webm", "audio/x-m4a",
    ".opus", ".ogg", ".mp3", ".m4a", ".wav", ".webm"
  ]}
]
```

**Important**: Include both MIME types AND file extensions — Chrome Android requires both for reliable matching.

### Step 3: Create `api/transcribe.ts`

This is the **only new backend file**. It:

1. Receives audio via `formidable` (same as `api/upload.ts`)
2. Calls `groq.audio.transcriptions.create()` with `whisper-large-v3-turbo`
3. Calls `groq.chat.completions.create()` with `llama-3.1-8b-instant`
4. Returns `{ transcription, summary, stats }`

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Groq from 'groq-sdk';
import formidable from 'formidable';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';

export const config = {
  api: { bodyParser: false },
};

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const WHISPER_MODEL = 'whisper-large-v3-turbo';
const SUMMARY_MODEL = 'llama-3.1-8b-instant';

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB (Groq free tier limit)

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const startTime = Date.now();

  try {
    // 1. Parse audio file
    const form = formidable({
      maxFileSize: MAX_FILE_SIZE,
      allowEmptyFiles: false,
      filter: ({ mimetype }) => mimetype?.startsWith('audio/') ?? true,
    });

    const [, files] = await form.parse(req);
    const audioFile = files.audio?.[0] || files.file?.[0];

    if (!audioFile) {
      res.status(400).json({ error: 'No audio file provided', code: 'NO_FILE' });
      return;
    }

    // Get file size for stats
    const fileStats = await stat(audioFile.filepath);
    const fileSizeMB = (fileStats.size / (1024 * 1024)).toFixed(2);

    // 2. Transcribe with Groq Whisper
    const transcriptionResult = await groq.audio.transcriptions.create({
      model: WHISPER_MODEL,
      file: createReadStream(audioFile.filepath),
      language: 'pt',
      response_format: 'verbose_json',
    });

    const transcriptionText = typeof transcriptionResult === 'string'
      ? transcriptionResult
      : transcriptionResult.text;

    if (!transcriptionText || transcriptionText.trim().length === 0) {
      res.status(400).json({
        error: 'Could not transcribe the audio. It may be empty or inaudible.',
        code: 'EMPTY_TRANSCRIPTION',
      });
      return;
    }

    const audioDuration = typeof transcriptionResult !== 'string'
      ? transcriptionResult.duration ?? null
      : null;

    const transcribeTime = Date.now() - startTime;

    // 3. Summarize with Groq Llama
    const summaryStart = Date.now();

    const wordCount = transcriptionText.split(/\s+/).length;
    const isShortAudio = wordCount < 100;

    const systemPrompt = isShortAudio
      ? `Você é um assistente que resume áudios transcritos em português brasileiro.
Este áudio é curto. Resuma em 1-2 frases objetivas capturando a mensagem principal.
Use markdown.`
      : `Você é um assistente que resume áudios transcritos em português brasileiro.
Faça um resumo claro e conciso capturando os pontos principais.
Organize por temas se houver múltiplos assuntos. Use markdown.
Seja direto — o objetivo é que o leitor entenda o conteúdo sem ouvir o áudio.`;

    const completion = await groq.chat.completions.create({
      model: SUMMARY_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Resuma este áudio transcrito:\n\n${transcriptionText}` },
      ],
      max_tokens: isShortAudio ? 150 : 500,
      temperature: 0.3,
    });

    const summary = completion.choices[0]?.message?.content || '';
    const summarizeTime = Date.now() - summaryStart;

    // 4. Return result
    res.status(200).json({
      transcription: transcriptionText,
      summary,
      stats: {
        audioDuration: audioDuration ? Math.round(audioDuration) : null,
        wordCount,
        fileSizeMB: parseFloat(fileSizeMB),
        transcribeTimeMs: transcribeTime,
        summarizeTimeMs: summarizeTime,
        totalTimeMs: Date.now() - startTime,
        whisperModel: WHISPER_MODEL,
        summaryModel: SUMMARY_MODEL,
        tokensUsed: completion.usage?.total_tokens || 0,
      },
    });

  } catch (err: unknown) {
    console.error('Transcribe error:', err);

    const errorMessage = err instanceof Error ? err.message : String(err);

    // Rate limit handling
    if (errorMessage.includes('rate') || errorMessage.includes('429') || errorMessage.includes('Rate limit')) {
      res.status(429).json({ error: errorMessage || 'Rate limit reached' });
      return;
    }

    // File too large
    if (errorMessage.includes('maxFileSize') || errorMessage.includes('too large')) {
      res.status(413).json({ error: 'Audio file is too large. Max 25 MB.', code: 'FILE_TOO_LARGE' });
      return;
    }

    res.status(500).json({ error: 'Failed to process audio', code: 'PROCESSING_ERROR' });
  }
}
```

### Step 4: Update `vercel.json`

Add specific config for the transcription endpoint with longer timeout:

```json
{
  "version": 2,
  "buildCommand": "npm run build",
  "outputDirectory": "public",
  "functions": {
    "api/transcribe.ts": {
      "memory": 1024,
      "maxDuration": 30
    },
    "api/**/*.ts": {
      "memory": 1024,
      "maxDuration": 10
    }
  },
  "routes": [
    { "src": "/api/(.*)", "dest": "/api/$1" },
    { "src": "/share", "dest": "/share.html" },
    { "src": "/(.*)", "dest": "/$1" }
  ]
}
```

### Step 5: Update `sw.js` — Handle Share Target POST + Audio

The Service Worker must intercept the POST from the share target, cache the individual file (following the [official web.dev pattern](https://web.dev/patterns/files/receive-shared-files)), and redirect to the main app.

**Important**: Cache the file blob directly (`new Response(file)`), NOT the entire FormData (`new Response(formData)`). The FormData round-trip through the Cache API is unreliable with binary files like audio.

```javascript
const CACHE_NAME = 'resumo-grupo-v2'; // Increment to force update
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

  // Handle Share Target POST (text or audio files)
  // Pattern: cache individual file + metadata, NOT the entire FormData
  if (url.pathname === '/share' && event.request.method === 'POST') {
    event.respondWith((async () => {
      const formData = await event.request.formData();
      const cache = await caches.open('share-target-cache');

      // Check all possible field names from manifest share_target
      const file = formData.get('file') || formData.get('audio');

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

### Step 6: Update `app.js` — Audio Handling Logic

Add the following to `app.js`:

#### 6a. New function: `handleAudioFile(file)`

```javascript
async function handleAudioFile(file) {
  if (!file) return;

  // Validate file type
  const validTypes = ['audio/ogg', 'audio/opus', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm', 'audio/x-m4a'];
  const validExts = ['.opus', '.ogg', '.mp3', '.m4a', '.wav', '.webm'];
  const isValid = validTypes.some(t => file.type.startsWith(t.split('/')[0])) ||
                  validExts.some(ext => file.name.toLowerCase().endsWith(ext));

  if (!isValid) {
    showToast('Formato de áudio não suportado', 'error');
    return;
  }

  // Check file size (25 MB limit)
  if (file.size > 25 * 1024 * 1024) {
    showToast('Áudio muito grande. Máximo 25 MB.', 'error');
    return;
  }

  try {
    showLoading('Transcrevendo áudio...');

    const formData = new FormData();
    formData.append('audio', file);

    const response = await fetch('/api/transcribe', {
      method: 'POST',
      body: formData,
    });

    if (response.status === 429) {
      const data = await response.json();
      handleRateLimit(data.error);
      hideLoading();
      return;
    }

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Erro ao processar áudio');
    }

    const result = await response.json();
    hideLoading();
    displayAudioResult(result);
    showStep('audio-result');

  } catch (err) {
    hideLoading();
    showToast(err.message, 'error');
  }
}
```

#### 6b. New function: `displayAudioResult(result)`

```javascript
function displayAudioResult(result) {
  const { transcription, summary, stats } = result;

  // Summary
  elements.audioSummary.innerHTML = formatMarkdown(summary);

  // Transcription
  elements.audioTranscription.textContent = transcription;

  // Stats
  const parts = [];
  if (stats.audioDuration) {
    const min = Math.floor(stats.audioDuration / 60);
    const sec = stats.audioDuration % 60;
    parts.push(`${min}:${String(sec).padStart(2, '0')} de áudio`);
  }
  parts.push(`${stats.wordCount} palavras`);
  parts.push(`processado em ${(stats.totalTimeMs / 1000).toFixed(1)}s`);
  elements.audioStats.textContent = parts.join(' · ');
}
```

#### 6c. Update `init()` for share-target detection

```javascript
(async function init() {
  if (isRateLimitActive()) {
    console.log('Rate limit active from previous session');
  }

  // Handle Share Target (both text and audio)
  // Uses individual file caching pattern (web.dev official approach)
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

        // Route to correct handler based on file type
        const isAudio = meta.type?.startsWith('audio/') ||
          ['.opus', '.ogg', '.mp3', '.m4a', '.wav', '.webm'].some(ext =>
            meta.name.toLowerCase().endsWith(ext)
          );

        if (isAudio) {
          await handleAudioFile(file);
        } else {
          await handleFile(file);
        }
      }
    } catch (err) {
      console.error('Error handling share target:', err);
    }
    history.replaceState(null, '', '/');
    return;
  }

  // Legacy: handle sessionStorage share (existing flow, fallback)
  const content = sessionStorage.getItem('sharedFileContent');
  const name = sessionStorage.getItem('sharedFileName');
  if (content && name) {
    sessionStorage.removeItem('sharedFileContent');
    sessionStorage.removeItem('sharedFileName');
    await handleFile(new File([content], name, { type: 'text/plain' }));
  }

  console.log('App initialized');
})();
```

#### 6d. Update `handleFile()` to detect audio

```javascript
async function handleFile(file) {
  if (!file) return;

  // Detect audio files
  const isAudio = file.type?.startsWith('audio/') ||
    ['.opus', '.ogg', '.mp3', '.m4a', '.wav', '.webm'].some(ext =>
      file.name.toLowerCase().endsWith(ext)
    );

  if (isAudio) {
    return handleAudioFile(file);
  }

  // ... existing text handling logic (unchanged)
}
```

### Step 7: Update `index.html` — Audio UI Sections

Add these new sections to the HTML:

#### 7a. Update the upload area to accept audio

Update the file input to accept both text and audio:

```html
<input type="file" id="file-input" accept=".txt,.zip,text/plain,application/zip,audio/*,.opus,.ogg,.mp3,.m4a,.wav" hidden>
```

Update the upload hint text:

```html
<p class="upload-hint">Arquivo .txt/.zip do WhatsApp ou áudio (.opus, .ogg, .mp3)</p>
```

#### 7b. Add audio result section

```html
<!-- Step: Audio Result -->
<section id="step-audio-result" class="step">
  <div class="result-header">
    <h2>🎤 Resumo do Áudio</h2>
    <p class="result-stats" id="audio-stats"></p>
  </div>

  <div class="result-box">
    <div id="audio-summary" class="summary-text"></div>
  </div>

  <details class="transcription-details">
    <summary>📝 Ver transcrição completa</summary>
    <div id="audio-transcription" class="transcription-text"></div>
  </details>

  <div class="result-actions">
    <button class="btn btn-primary" id="btn-copy-audio">📋 Copiar resumo</button>
    <button class="btn btn-secondary" id="btn-copy-transcription">📝 Copiar transcrição</button>
    <button class="btn btn-secondary" id="btn-share-audio">📤 Compartilhar</button>
    <button class="btn btn-ghost" id="btn-new-audio">← Novo áudio</button>
  </div>
</section>
```

### Step 8: Update `styles.css` — Audio Styles

```css
/* Audio Result */
.transcription-details {
  margin-top: var(--spacing-md);
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  overflow: hidden;
}

.transcription-details summary {
  padding: var(--spacing-md);
  cursor: pointer;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-weight: 500;
  user-select: none;
  transition: background var(--transition-fast);
}

.transcription-details summary:hover {
  background: var(--bg-hover);
}

.transcription-details[open] summary {
  border-bottom: 1px solid var(--border-color);
}

.transcription-text {
  padding: var(--spacing-md);
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-size: 0.9rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 400px;
  overflow-y: auto;
}
```

### Step 9: Update `manifest.json` — Final Version

```json
{
  "name": "Resumo de Grupo WhatsApp",
  "short_name": "ResumoGrupo",
  "description": "Resuma conversas e áudios do WhatsApp usando IA",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0a0a0f",
  "theme_color": "#6366f1",
  "orientation": "portrait-primary",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "maskable"
    },
    {
      "src": "/icons/icon-192.svg",
      "sizes": "192x192",
      "type": "image/svg+xml"
    },
    {
      "src": "/icons/icon-512.svg",
      "sizes": "512x512",
      "type": "image/svg+xml"
    }
  ],
  "share_target": {
    "action": "/share",
    "method": "POST",
    "enctype": "multipart/form-data",
    "params": {
      "files": [
        {
          "name": "file",
          "accept": ["text/plain", ".txt"]
        },
        {
          "name": "audio",
          "accept": [
            "audio/ogg", "audio/opus", "audio/mpeg", "audio/mp4",
            "audio/wav", "audio/webm", "audio/x-m4a",
            ".opus", ".ogg", ".mp3", ".m4a", ".wav", ".webm"
          ]
        }
      ]
    }
  },
  "categories": ["productivity", "utilities"],
  "lang": "pt-BR"
}
```

---

## 8. What Does NOT Change

| File | Reason |
|------|--------|
| `api/upload.ts` | Only for WhatsApp `.txt` exports |
| `api/summarize.ts` | Only for text message chunks |
| `api/merge.ts` | Only for merging partial summaries |
| `api/analyze-group.ts` | Only for group personality analysis |
| `src/services/parser.ts` | WhatsApp text parser |
| `src/services/chunker.ts` | Message chunking logic |
| `src/services/dateExtractor.ts` | Date extraction |
| `src/types/index.ts` | Existing types stay (can add new ones) |
| `tsconfig.json` | No changes needed |
| `package.json` | **No new dependencies** |

---

## 9. Testing Plan

### 9.1 Local Testing

```bash
# Start dev server
cd groupResume
npm run dev

# Test audio upload manually via the web UI
# (Share Target requires installed PWA, can't test locally)
```

### 9.2 API Testing

```bash
# Test transcription endpoint directly
curl -X POST http://localhost:3000/api/transcribe \
  -F "audio=@test-audio.opus"
```

### 9.3 Android Testing (Share Target)

1. Deploy to Vercel (`vercel --prod`)
2. Open the app in Chrome Android
3. Verify the "Install app" banner/prompt appears (PNG icons fix)
4. Install the PWA
5. Open WhatsApp → long-press an audio message → Share
6. Verify "Resumo de Grupo" appears in the share sheet
7. Tap it → verify the audio is processed and summary appears
8. Also test sharing a `.txt` file to verify existing flow still works

### 9.4 Edge Cases to Test

- [ ] Very short audio (< 5 seconds)
- [ ] Long audio (> 10 minutes)
- [ ] Audio with silence / background noise
- [ ] Audio in languages other than Portuguese
- [ ] Corrupted or empty audio file
- [ ] File exceeding 25 MB
- [ ] Rate limit hit (send many requests quickly)

---

## 10. Costs

| Item | Cost |
|------|------|
| Groq Whisper (free tier) | **R$ 0** |
| Groq Llama (free tier) | **R$ 0** |
| Vercel Hobby (free tier) | **R$ 0** |
| New npm dependencies | **None** |
| Custom domain (optional) | ~R$ 40/year |
| **Total monthly** | **R$ 0** |

---

## 11. Risks and Mitigations

| Risk | Probability | Mitigation |
|------|------------|------------|
| `.opus` extension not recognized by Groq | Low (OGG is supported) | Rename to `.ogg` before sending; or use `toFile()` helper from groq-sdk |
| Vercel timeout on very long audios (30+ min) | Low | maxDuration: 30s; Groq processes 30 min in ~8s |
| Groq free tier rate limit | Low (personal use) | Show countdown message (existing rate limit UI) |
| Share Target not appearing | Medium | Requires PNG icons + installed PWA; clear instructions in UI |
| iOS doesn't support Share Target | Certain | Manual upload button as fallback |
| Audio with no speech (music, silence) | Medium | Handle empty transcription gracefully |
| WhatsApp changes audio format | Very low | Groq supports all common audio formats |

---

## 12. iOS Considerations

The Web Share Target API is **not supported on Safari/iOS**. For iOS users:

- The app still works — users open it directly and use the upload button
- The upload input accepts `audio/*` so they can select files from the Files app
- They can save WhatsApp audios to Files first, then upload

This is a known limitation of the Web platform on iOS and cannot be worked around with a PWA.

---

## Implementation Order Summary

| Phase | Tasks | Estimated Time |
|-------|-------|---------------|
| **Phase 1: Fix Share Target** | PNG icons, SW fix, cache fix, app.js init | ~2 hours |
| **Phase 2: Audio Backend** | Create `api/transcribe.ts`, update `vercel.json` | ~1 hour |
| **Phase 3: Audio Frontend** | Update HTML, app.js, styles.css | ~2 hours |
| **Phase 4: Testing** | Local + Android + edge cases | ~1 hour |
| **Total** | | **~6 hours** |
