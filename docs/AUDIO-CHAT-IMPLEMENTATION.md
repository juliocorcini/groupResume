# Audio Chat & Summary Levels — Implementation Plan

## Overview

This document describes the complete implementation of the **Audio Resume** feature with:

1. **Summary level selection** — User chooses the type of summary after transcription (Flash, Tópicos, Detalhado, Transcrição Limpa)
2. **Separated API flow** — Transcribe (Whisper) and Summarize (Llama) are separate endpoints; transcription happens once, summaries can be regenerated with different levels
3. **Interactive chat** — User can ask questions about the audio content using the **transcription** as context (not the summary)

**User flow:** Upload audio → Transcribe (automatic) → Choose summary level → Generate summary → View result → Optionally re-summarize with different level or open chat.

---

## Table of Contents

1. [Architecture Summary](#1-architecture-summary)
2. [Summary Levels for Audio](#2-summary-levels-for-audio)
3. [API Endpoints](#3-api-endpoints)
4. [New Audio Flow](#4-new-audio-flow)
5. [Files to Create or Modify](#5-files-to-create-or-modify)
6. [Complete Implementation](#6-complete-implementation)
7. [Token & Context Management](#7-token--context-management)
8. [Edge Cases & UX Details](#8-edge-cases--ux-details)

---

## 1. Architecture Summary

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Client (app.js)                                                                  │
│                                                                                  │
│  1. handleAudioFile(file)                                                        │
│     → POST /api/transcribe (audio only)                                          │
│     → Receives: { transcription, stats } (NO summary)                            │
│     → Stores in state.audioResult, showStep('audio-choice')                       │
│                                                                                  │
│  2. step-audio-choice: User selects level (Flash, Tópicos, Detalhado, Limpa)      │
│     → generateAudioSummary(level)                                                │
│     → POST /api/summarize-audio { transcription, level }                         │
│     → Receives: { summary }                                                       │
│     → Stores summary in state.audioResult, showStep('audio-result')             │
│                                                                                  │
│  3. step-audio-result: Summary + transcription + actions                         │
│     → "Re-summarizar" → back to step-audio-choice (transcription already cached) │
│     → "Conversar sobre o áudio" → openAudioChat()                                │
│                                                                                  │
│  4. openAudioChat() / sendChatMessage()                                          │
│     → POST /api/audio-chat { transcription, messages }                            │
│     → Chat uses TRANSCRIPTION as context (not summary)                            │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  API Endpoints                                                                   │
│                                                                                  │
│  POST /api/transcribe        → Transcription ONLY (Whisper)                      │
│  POST /api/summarize-audio   → Summary from transcription + level (Llama)        │
│  POST /api/audio-chat        → Chat about transcription (Llama)                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Key decisions:**
- **Single transcription** — Whisper is expensive; we call it once and cache the result client-side
- **Multiple summaries** — User can re-summarize with different levels without re-transcribing (cheap Llama calls)
- **Chat uses transcription** — Full context for questions, not the condensed summary
- **No database** — All state in `state.audioResult` (transcription, summary, stats)

---

## 2. Summary Levels for Audio

| Level | ID | Name | Description | Use Case |
|-------|-----|------|-------------|----------|
| 1 | `flash` | Flash | 2-3 bullet points with main topics | Short audios (30s), just the gist |
| 2 | `topicos` | Tópicos | Organized by topic, 4-8 bullets with 1-2 sentences each | **DEFAULT** — Medium audios (2-5 min), captures all subjects |
| 3 | `detalhado` | Detalhado | Full detailed summary, organized by topic, context and nuances, quotes key phrases | Long audios (5+ min), preserve information |
| 4 | `limpa` | Transcrição Limpa | Not a summary — cleaned transcription: remove fillers ("né", "tipo", "aí"), fix grammar, add punctuation and paragraphs | User wants full content but readable |

---

## 3. API Endpoints

### 3.1 `POST /api/transcribe` (MODIFIED)

**Change:** Returns **transcription only**. No summary.

**Request:** `multipart/form-data` with `audio` or `file` field (audio file)

**Response (success):**
```json
{
  "transcription": "Full transcription text...",
  "stats": {
    "audioDuration": 312,
    "wordCount": 450,
    "fileSizeMB": 2.1,
    "transcribeTimeMs": 8500,
    "whisperModel": "whisper-large-v3-turbo"
  }
}
```

**Response (error):** Same as before (429, 400, 500)

---

### 3.2 `POST /api/summarize-audio` (NEW)

**Request body:**
```json
{
  "transcription": "Full transcription text...",
  "level": "topicos"
}
```

**Level values:** `flash` | `topicos` | `detalhado` | `limpa`

**Response (success):**
```json
{
  "summary": "Generated summary or cleaned transcription..."
}
```

**Response (rate limit):** 429 with `{ "error": "Rate limit exceeded..." }`

---

### 3.3 `POST /api/audio-chat` (UNCHANGED from previous plan)

**Request body:**
```json
{
  "transcription": "Full transcription text...",
  "messages": [
    { "role": "user", "content": "Quais foram os pontos principais?" },
    { "role": "assistant", "content": "Os pontos principais foram..." }
  ]
}
```

**Response:** `{ "content": "...", "tokensUsed": 450 }`

**Note:** Chat uses **transcription** as context, not the summary.

---

## 4. New Audio Flow

| Step | Screen | User Action |
|------|--------|-------------|
| 1 | `step-upload` | Upload/share audio file |
| 2 | (loading) | Transcribing... (automatic) |
| 3 | `step-audio-choice` | See transcription preview + choose summary level (Flash, Tópicos, Detalhado, Transcrição Limpa) |
| 4 | (loading) | Generating summary... |
| 5 | `step-audio-result` | See summary + transcription (collapsible) + actions |
| 6 | (optional) | "Re-summarizar" → back to step 3 (no re-transcription) |
| 7 | (optional) | "Conversar sobre o áudio" → `step-audio-chat` |

---

## 5. Files to Create or Modify

| File | Action |
|------|--------|
| `api/transcribe.ts` | **Modify** — Remove summary logic, return transcription + stats only |
| `api/summarize-audio.ts` | **Create** — New endpoint for summary by level |
| `api/audio-chat.ts` | **Create** — Chat endpoint (unchanged from previous plan) |
| `vercel.json` | **Modify** — Add `api/summarize-audio.ts`, `api/audio-chat.ts` config |
| `public/index.html` | **Modify** — Add `step-audio-choice`, `step-audio-chat`, update `step-audio-result` |
| `public/styles.css` | **Modify** — Add level selection + chat styles |
| `public/app.js` | **Modify** — New flow, `generateAudioSummary()`, `openAudioChat()`, etc. |
| `dev-server.js` | **Modify** — Add transcribe (modified), summarize-audio, audio-chat routes |

---

## 6. Complete Implementation

### 6.1 `api/transcribe.ts` — Transcription Only

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Groq from 'groq-sdk';
import formidable from 'formidable';
import { createReadStream } from 'fs';
import { rename, stat } from 'fs/promises';
import { extname } from 'path';

export const config = {
  api: { bodyParser: false },
};

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const WHISPER_MODEL = 'whisper-large-v3-turbo';
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

/**
 * POST /api/transcribe
 * Transcribes audio with Groq Whisper. Returns transcription + stats only.
 * Does NOT summarize — use /api/summarize-audio for that.
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const startTime = Date.now();

  try {
    const form = formidable({
      maxFileSize: MAX_FILE_SIZE,
      allowEmptyFiles: false,
    });

    const [, files] = await form.parse(req);
    const audioFile = files.audio?.[0] || files.file?.[0];

    if (!audioFile) {
      res.status(400).json({ error: 'No audio file provided', code: 'NO_FILE' });
      return;
    }

    const fileStats = await stat(audioFile.filepath);
    const fileSizeMB = fileStats.size / (1024 * 1024);

    const originalName = audioFile.originalFilename || 'audio.ogg';
    const ext = extname(originalName) || '.ogg';
    const renamedPath = audioFile.filepath + ext;
    await rename(audioFile.filepath, renamedPath);

    const transcriptionResult = await groq.audio.transcriptions.create({
      model: WHISPER_MODEL,
      file: createReadStream(renamedPath),
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
      ? (transcriptionResult as unknown as { duration?: number }).duration ?? null
      : null;

    const wordCount = transcriptionText.split(/\s+/).length;

    res.status(200).json({
      transcription: transcriptionText,
      stats: {
        audioDuration: audioDuration ? Math.round(audioDuration) : null,
        wordCount,
        fileSizeMB: parseFloat(fileSizeMB.toFixed(2)),
        transcribeTimeMs: Date.now() - startTime,
        whisperModel: WHISPER_MODEL,
      },
    });
  } catch (err: unknown) {
    console.error('Transcribe error:', err);
    const errorMessage = err instanceof Error ? err.message : String(err);

    if (
      errorMessage.includes('rate') ||
      errorMessage.includes('429') ||
      errorMessage.includes('Rate limit')
    ) {
      res.status(429).json({ error: errorMessage || 'Rate limit reached' });
      return;
    }

    if (errorMessage.includes('maxFileSize') || errorMessage.includes('too large')) {
      res.status(413).json({
        error: 'Audio file is too large. Max 25 MB.',
        code: 'FILE_TOO_LARGE',
      });
      return;
    }

    res.status(500).json({ error: 'Failed to process audio', code: 'PROCESSING_ERROR' });
  }
}
```

---

### 6.2 `api/summarize-audio.ts` — Summary by Level

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const SUMMARY_MODEL = 'llama-3.1-8b-instant';

type AudioSummaryLevel = 'flash' | 'topicos' | 'detalhado' | 'limpa';

interface SummarizeAudioRequestBody {
  transcription: string;
  level?: AudioSummaryLevel;
}

const LEVEL_CONFIGS: Record<AudioSummaryLevel, { maxTokens: number; systemPrompt: string }> = {
  flash: {
    maxTokens: 200,
    systemPrompt: `Você é um assistente que resume áudios transcritos em português brasileiro.

MODO FLASH: Produza um resumo ULTRA-CURTO em apenas 2-3 tópicos em formato de bullet points.
- Cada bullet = um assunto principal mencionado no áudio
- Máximo 2-3 bullets, cada um com 1 frase
- Ideal para áudios curtos (30s-1min) — o leitor quer só a essência
- Use markdown com "- " para os bullets
- Seja direto e objetivo`,

  topicos: {
    maxTokens: 600,
    systemPrompt: `Você é um assistente que resume áudios transcritos em português brasileiro.

MODO TÓPICOS: Organize o resumo por assunto/tema. Este é o modo PADRÃO e mais útil.
- Identifique TODOS os assuntos discutidos no áudio (geralmente 4-8 tópicos para um áudio de 2-5 min)
- Para cada tópico: 1 bullet com título + 1-2 frases explicando o que foi dito
- NÃO perca assuntos importantes — um áudio de 5 min deve ter vários tópicos
- Use markdown: ## para títulos de seção, - para bullets
- Seja completo mas conciso — capture cada assunto sem repetir
- Exemplo de estrutura:
  ## Assunto 1
  - Explicação breve do que foi dito
  ## Assunto 2
  - Explicação breve`,

  detalhado: {
    maxTokens: 1200,
    systemPrompt: `Você é um assistente que resume áudios transcritos em português brasileiro.

MODO DETALHADO: Produza um resumo COMPLETO preservando o máximo de informação possível.
- Organize por tópicos/assuntos
- Para cada tópico: explique com contexto, nuances e detalhes relevantes
- Quando apropriado, cite frases-chave entre aspas para preservar o que foi dito
- Inclua informações importantes que um resumo curto perderia
- Use markdown: ## para seções, - para bullets, "aspas" para citações
- Ideal para áudios longos (5+ min) onde o usuário quer entender tudo sem ouvir
- Mantenha a ordem lógica do áudio quando fizer sentido`,

  limpa: {
    maxTokens: 4000,
    systemPrompt: `Você é um assistente que transforma transcrições de áudio em texto limpo e legível.

MODO TRANSCRIÇÃO LIMPA: NÃO faça um resumo. Transforme a transcrição em texto bem formatado.
- Remova palavras de preenchimento: "né", "tipo", "aí", "então", "daí", "olha", "cara", "bom", etc.
- Corrija erros de gramática e concordância
- Adicione pontuação adequada (vírgulas, pontos, dois-pontos)
- Organize em parágrafos quando houver mudança de assunto
- Mantenha TODO o conteúdo — não resuma, não omita informações
- O resultado deve ser um texto que alguém possa ler como se fosse escrito, não falado
- Preserve a ordem e o sentido original
- Use parágrafos separados por linha em branco para clareza`,
  },
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { transcription, level = 'topicos' } = req.body as SummarizeAudioRequestBody;

    if (!transcription || typeof transcription !== 'string') {
      res.status(400).json({ error: 'Missing or invalid transcription' });
      return;
    }

    const validLevels: AudioSummaryLevel[] = ['flash', 'topicos', 'detalhado', 'limpa'];
    const summaryLevel: AudioSummaryLevel = validLevels.includes(level as AudioSummaryLevel)
      ? (level as AudioSummaryLevel)
      : 'topicos';

    const config = LEVEL_CONFIGS[summaryLevel];

    const userMessage = summaryLevel === 'limpa'
      ? `Transforme esta transcrição em texto limpo e legível:\n\n${transcription}`
      : `Resuma este áudio transcrito:\n\n${transcription}`;

    const completion = await groq.chat.completions.create({
      model: SUMMARY_MODEL,
      messages: [
        { role: 'system', content: config.systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: config.maxTokens,
      temperature: 0.3,
    });

    const summary = completion.choices[0]?.message?.content?.trim() || '';

    res.status(200).json({ summary });
  } catch (err: unknown) {
    console.error('Summarize audio error:', err);
    const errorMessage = err instanceof Error ? err.message : String(err);

    if (
      errorMessage.includes('rate') ||
      errorMessage.includes('429') ||
      errorMessage.includes('Rate limit')
    ) {
      res.status(429).json({ error: errorMessage || 'Rate limit reached' });
      return;
    }

    res.status(500).json({ error: 'Failed to generate summary', code: 'SUMMARIZE_ERROR' });
  }
}
```

---

### 6.3 `api/audio-chat.ts` — Chat Endpoint

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';
import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const CHAT_MODEL = 'llama-3.1-8b-instant';
const MAX_RESPONSE_TOKENS = 1024;
const MAX_TRANSCRIPTION_CHARS = 100_000;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AudioChatRequestBody {
  transcription: string;
  messages: ChatMessage[];
}

function truncateTranscription(text: string): string {
  if (!text || text.length <= MAX_TRANSCRIPTION_CHARS) {
    return text || '';
  }
  const half = Math.floor(MAX_TRANSCRIPTION_CHARS / 2);
  const start = text.slice(0, half);
  const end = text.slice(-half);
  return `${start}\n\n[... transcrição truncada no meio ...]\n\n${end}`;
}

const SYSTEM_PROMPT_TEMPLATE = `Você é um assistente que responde perguntas sobre o conteúdo de um áudio transcrito.

O usuário fez perguntas sobre um áudio. Abaixo está a transcrição completa (ou uma parte dela):

---
TRANSCRIÇÃO DO ÁUDIO:
{transcription}
---

Instruções:
- Responda APENAS com base no conteúdo da transcrição acima.
- Se a pergunta não puder ser respondida com a transcrição, diga isso claramente.
- Use português brasileiro, a menos que o usuário peça em outro idioma.
- Seja conciso mas completo.
- Você pode: resumir trechos, explicar o que alguém quis dizer, sugerir respostas, traduzir, listar pontos principais, etc.`;

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { transcription, messages } = req.body as AudioChatRequestBody;

    if (!transcription || typeof transcription !== 'string') {
      res.status(400).json({ error: 'Missing or invalid transcription' });
      return;
    }

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: 'Missing or invalid messages' });
      return;
    }

    const transcriptionText = truncateTranscription(transcription);
    const systemContent = SYSTEM_PROMPT_TEMPLATE.replace('{transcription}', transcriptionText);

    const maxHistory = 12;
    const recentMessages = messages.slice(-maxHistory);

    const apiMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemContent },
      ...recentMessages,
    ];

    const completion = await groq.chat.completions.create({
      model: CHAT_MODEL,
      messages: apiMessages,
      max_tokens: MAX_RESPONSE_TOKENS,
      temperature: 0.5,
    });

    const content = completion.choices[0]?.message?.content?.trim() || '';
    const tokensUsed = completion.usage?.total_tokens || 0;

    res.status(200).json({ content, tokensUsed });
  } catch (err: unknown) {
    console.error('Audio chat error:', err);
    const errorMessage = err instanceof Error ? err.message : String(err);

    if (
      errorMessage.includes('rate') ||
      errorMessage.includes('429') ||
      errorMessage.includes('Rate limit')
    ) {
      res.status(429).json({ error: errorMessage || 'Rate limit reached' });
      return;
    }

    res.status(500).json({ error: 'Failed to generate response', code: 'CHAT_ERROR' });
  }
}
```

---

### 6.4 `public/index.html` — New Steps and Updated Result

**Add `step-audio-choice`** (after `step-audio-result`, before loading overlay). This step shows the transcription preview and lets the user choose the summary level:

```html
      <!-- Step: Audio Summary Level Choice (after transcription, before result) -->
      <section id="step-audio-choice" class="step">
        <div class="result-header">
          <h2>📝 Transcrição pronta</h2>
          <p class="result-stats" id="audio-choice-stats"></p>
        </div>

        <p class="audio-choice-hint">Escolha o tipo de resumo que deseja:</p>

        <div class="option-group">
          <label>Nível do resumo</label>
          <div class="radio-cards" id="audio-level-options">
            <label class="radio-card">
              <input type="radio" name="audio-level" value="flash">
              <span class="card-content">
                <strong>⚡ Flash</strong>
                <small>2-3 tópicos principais — ideal para áudios curtos</small>
              </span>
            </label>
            <label class="radio-card selected">
              <input type="radio" name="audio-level" value="topicos" checked>
              <span class="card-content">
                <strong>📋 Tópicos</strong>
                <small>Organizado por assunto — captura todos os temas (padrão)</small>
              </span>
            </label>
            <label class="radio-card">
              <input type="radio" name="audio-level" value="detalhado">
              <span class="card-content">
                <strong>📖 Detalhado</strong>
                <small>Resumo completo com contexto e citações</small>
              </span>
            </label>
            <label class="radio-card">
              <input type="radio" name="audio-level" value="limpa">
              <span class="card-content">
                <strong>✨ Transcrição Limpa</strong>
                <small>Texto formatado sem resumir — remove "né", "tipo", etc.</small>
              </span>
            </label>
          </div>
        </div>

        <details class="transcription-details">
          <summary>📝 Ver transcrição antes de resumir</summary>
          <div id="audio-choice-transcription" class="transcription-text"></div>
        </details>

        <div class="options-actions">
          <button id="btn-generate-summary" class="btn-primary">Gerar Resumo ✨</button>
        </div>
      </section>
```

**Add `step-audio-chat`** (after `step-audio-choice`):

```html
      <!-- Step: Audio Chat -->
      <section id="step-audio-chat" class="step">
        <div class="chat-header">
          <button id="btn-back-from-chat" class="btn-back-inline" aria-label="Voltar">←</button>
          <h2>💬 Conversar sobre o áudio</h2>
          <p class="chat-subtitle">Pergunte qualquer coisa sobre o que foi dito</p>
        </div>

        <div class="chat-container">
          <div id="chat-messages" class="chat-messages"></div>
          <div id="chat-typing" class="chat-typing" hidden>
            <div class="chat-typing-indicator">
              <span></span><span></span><span></span>
            </div>
            <span class="typing-text">Pensando...</span>
          </div>
          <div class="chat-input-area">
            <textarea
              id="chat-input"
              class="chat-input"
              placeholder="Ex: Quais foram os pontos principais? Me sugira uma resposta..."
              rows="2"
              maxlength="2000"
            ></textarea>
            <button id="btn-send-chat" class="btn-send-chat" aria-label="Enviar">Enviar</button>
          </div>
        </div>

        <div class="chat-actions">
          <button id="btn-copy-chat" class="btn-secondary">📋 Copiar conversa</button>
          <button id="btn-back-to-audio-result" class="btn-link">← Voltar ao resumo</button>
        </div>
      </section>
```

**Update `step-audio-result`** — Add "Conversar" and "Re-summarizar" buttons:

```html
      <!-- Step: Audio Result -->
      <section id="step-audio-result" class="step">
        <div class="result-header">
          <h2>🎤 Resumo do Áudio</h2>
          <p class="result-stats" id="audio-stats"></p>
        </div>

        <div class="result-content">
          <div id="audio-summary" class="summary-text"></div>
        </div>

        <details class="transcription-details">
          <summary>📝 Ver transcrição completa</summary>
          <div id="audio-transcription" class="transcription-text"></div>
        </details>

        <div class="result-actions">
          <button id="btn-chat-audio" class="btn-primary">💬 Conversar sobre o áudio</button>
          <button id="btn-resummarize" class="btn-secondary">🔄 Re-summarizar com outro nível</button>
          <button id="btn-copy-audio" class="btn-secondary">📋 Copiar resumo</button>
          <button id="btn-copy-transcription" class="btn-secondary">📝 Copiar transcrição</button>
          <button id="btn-share-audio" class="btn-secondary" hidden>📤 Compartilhar</button>
          <button id="btn-new-audio" class="btn-primary">← Novo arquivo</button>
        </div>
      </section>
```

---

### 6.5 `public/styles.css` — Additional Styles

Append to the end of `styles.css`:

```css
/* ==============================================
   Audio Choice Step
   ============================================== */
.audio-choice-hint {
  color: var(--text-secondary);
  font-size: 0.9rem;
  margin-bottom: var(--spacing-lg);
}

/* ==============================================
   Audio Chat
   ============================================== */
.chat-header {
  margin-bottom: var(--spacing-lg);
  position: relative;
}

.btn-back-inline {
  position: absolute;
  left: 0;
  top: 0;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 1.2rem;
  cursor: pointer;
  padding: var(--spacing-xs);
  margin: calc(-1 * var(--spacing-xs)) 0 0 calc(-1 * var(--spacing-xs));
  border-radius: var(--border-radius-sm);
  transition: color var(--transition-fast);
}

.btn-back-inline:hover {
  color: var(--accent-secondary);
}

.chat-header h2 {
  font-size: 1.3rem;
  margin-bottom: var(--spacing-xs);
  padding-left: 2rem;
}

.chat-subtitle {
  color: var(--text-secondary);
  font-size: 0.9rem;
  padding-left: 2rem;
}

.chat-container {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-lg);
}

.chat-messages {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  max-height: 50vh;
  min-height: 200px;
  overflow-y: auto;
  padding: var(--spacing-md);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
}

.chat-messages::-webkit-scrollbar {
  width: 6px;
}

.chat-messages::-webkit-scrollbar-track {
  background: transparent;
}

.chat-messages::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 3px;
}

.chat-message {
  display: flex;
  flex-direction: column;
  max-width: 90%;
  animation: chatMessageIn 0.25s ease;
}

@keyframes chatMessageIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.chat-message.user { align-self: flex-end; }
.chat-message.assistant { align-self: flex-start; }

.chat-message-bubble {
  padding: var(--spacing-md);
  border-radius: var(--border-radius-sm);
  font-size: 0.95rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.chat-message.user .chat-message-bubble {
  background: var(--accent-primary);
  color: white;
  border-bottom-right-radius: 4px;
}

.chat-message.assistant .chat-message-bubble {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-bottom-left-radius: 4px;
}

.chat-message-bubble h2,
.chat-message-bubble strong {
  color: inherit;
}

.chat-message-actions {
  display: flex;
  gap: var(--spacing-xs);
  margin-top: var(--spacing-xs);
  opacity: 0.7;
}

.chat-message-actions button {
  background: transparent;
  border: none;
  color: inherit;
  font-size: 0.75rem;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: background var(--transition-fast);
}

.chat-message.user .chat-message-actions button:hover {
  background: rgba(255, 255, 255, 0.2);
}

.chat-message.assistant .chat-message-actions button:hover {
  background: var(--bg-hover);
}

.chat-typing {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius-sm);
  width: fit-content;
}

.chat-typing-indicator {
  display: flex;
  gap: 4px;
  align-items: center;
}

.chat-typing-indicator span {
  width: 6px;
  height: 6px;
  background: var(--accent-primary);
  border-radius: 50%;
  animation: typingBounce 1.4s ease-in-out infinite;
}

.chat-typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
.chat-typing-indicator span:nth-child(3) { animation-delay: 0.4s; }

@keyframes typingBounce {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-4px); }
}

.typing-text {
  font-size: 0.85rem;
  color: var(--text-muted);
}

.chat-input-area {
  display: flex;
  gap: var(--spacing-sm);
  align-items: flex-end;
}

.chat-input {
  flex: 1;
  padding: var(--spacing-md);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius-sm);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 0.95rem;
  resize: none;
  min-height: 48px;
  max-height: 120px;
  transition: border-color var(--transition-fast);
}

.chat-input:focus {
  outline: none;
  border-color: var(--accent-primary);
}

.chat-input::placeholder {
  color: var(--text-muted);
}

.btn-send-chat {
  padding: var(--spacing-md) var(--spacing-lg);
  background: var(--accent-primary);
  color: white;
  border: none;
  border-radius: var(--border-radius-sm);
  font-weight: 600;
  cursor: pointer;
  transition: background var(--transition-fast);
  white-space: nowrap;
}

.btn-send-chat:hover:not(:disabled) {
  background: var(--accent-secondary);
}

.btn-send-chat:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.chat-actions {
  display: flex;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-md);
}
```

---

### 6.6 `public/app.js` — Complete Audio Flow Logic

#### 6.6.1 Update `showStep()` and `elements`

In `showStep()`:
```javascript
['upload', 'dates', 'options', 'result', 'group-analysis', 'group-result', 'audio-choice', 'audio-result', 'audio-chat'].forEach(s => {
  $(`step-${s}`)?.classList.toggle('active', s === name);
});
```

In `elements`:
```javascript
  // Audio choice elements
  stepAudioChoice: $('step-audio-choice'),
  audioChoiceStats: $('audio-choice-stats'),
  audioChoiceTranscription: $('audio-choice-transcription'),
  audioLevelOptions: $('audio-level-options'),
  btnGenerateSummary: $('btn-generate-summary'),
  // Audio result (existing + new)
  btnResummarize: $('btn-resummarize'),
  btnChatAudio: $('btn-chat-audio'),
  // Audio Chat elements
  stepAudioChat: $('step-audio-chat'),
  chatMessages: $('chat-messages'),
  chatTyping: $('chat-typing'),
  chatInput: $('chat-input'),
  btnSendChat: $('btn-send-chat'),
  btnBackFromChat: $('btn-back-from-chat'),
  btnBackToAudioResult: $('btn-back-to-audio-result'),
  btnCopyChat: $('btn-copy-chat'),
```

#### 6.6.2 Update State

```javascript
// In state object:
audioResult: null,  // { transcription, summary, stats, level }
audioChatMessages: [],
```

#### 6.6.3 Replace `handleAudioFile` and Add New Flow

```javascript
async function handleAudioFile(file) {
  if (!file) return;

  if (file.size > MAX_AUDIO_SIZE) {
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
      const errorMsg = data.error || 'Rate limit reached';
      const waitSeconds = parseWaitTime(errorMsg);
      const limitType = detectLimitType(errorMsg);
      startRateLimitCountdown(waitSeconds + 2, limitType);
      hideLoading();
      showToast('Limite de API atingido. Aguarde e tente novamente.', 'error');
      return;
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Erro ao processar áudio');
    }

    const result = await response.json();
    hideLoading();

    // Store transcription + stats (NO summary yet)
    state.audioResult = {
      transcription: result.transcription,
      summary: null,
      stats: result.stats,
      level: null,
    };

    // Show level choice step
    displayAudioChoiceStep(result.transcription, result.stats);
    showStep('audio-choice');
  } catch (err) {
    hideLoading();
    showToast(err.message, 'error');
  }
}

function displayAudioChoiceStep(transcription, stats) {
  if (elements.audioChoiceStats) {
    const parts = [];
    if (stats.audioDuration) {
      const min = Math.floor(stats.audioDuration / 60);
      const sec = stats.audioDuration % 60;
      parts.push(`${min}:${String(sec).padStart(2, '0')} de áudio`);
    }
    parts.push(`${stats.wordCount} palavras`);
    if (stats.fileSizeMB) {
      parts.push(`${stats.fileSizeMB.toFixed(1)} MB`);
    }
    elements.audioChoiceStats.textContent = parts.join(' · ');
  }

  if (elements.audioChoiceTranscription) {
    elements.audioChoiceTranscription.textContent = transcription;
  }

  // Reset level selection to default (topicos)
  const topicosRadio = document.querySelector('input[name="audio-level"][value="topicos"]');
  if (topicosRadio) {
    topicosRadio.checked = true;
    document.querySelectorAll('#audio-level-options .radio-card').forEach(c => {
      c.classList.toggle('selected', c.querySelector('input').value === 'topicos');
    });
  }
}

async function generateAudioSummary() {
  const levelRadio = document.querySelector('input[name="audio-level"]:checked');
  const level = levelRadio?.value || 'topicos';

  if (!state.audioResult?.transcription) {
    showToast('Nenhuma transcrição disponível', 'error');
    return;
  }

  if (isRateLimitActive()) {
    showToast('Aguarde o limite de API para continuar.', 'error');
    return;
  }

  try {
    showLoading('Gerando resumo...');

    const res = await fetch('/api/summarize-audio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcription: state.audioResult.transcription,
        level,
      }),
    });

    if (res.status === 429) {
      const data = await res.json();
      const errorMsg = data.error || 'Rate limit reached';
      const waitSeconds = parseWaitTime(errorMsg);
      const limitType = detectLimitType(errorMsg);
      startRateLimitCountdown(waitSeconds + 2, limitType);
      hideLoading();
      showToast('Limite de API atingido. Aguarde e tente novamente.', 'error');
      return;
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Erro ao gerar resumo');
    }

    const data = await res.json();
    state.audioResult.summary = data.summary;
    state.audioResult.level = level;

    hideLoading();
    displayAudioResult(state.audioResult);
    showStep('audio-result');
  } catch (err) {
    hideLoading();
    showToast(err.message, 'error');
  }
}

function displayAudioResult(result) {
  const { transcription, summary, stats } = result;

  // Summary
  if (elements.audioSummary) {
    elements.audioSummary.innerHTML = (summary || '')
      .replace(/##\s*(.+)/g, '<h2>$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/^/, '<p>').replace(/$/, '</p>');
  }

  // Transcription
  if (elements.audioTranscription) {
    elements.audioTranscription.textContent = transcription;
  }

  // Stats
  if (elements.audioStats && stats) {
    const parts = [];
    if (stats.audioDuration) {
      const min = Math.floor(stats.audioDuration / 60);
      const sec = stats.audioDuration % 60;
      parts.push(`${min}:${String(sec).padStart(2, '0')} de áudio`);
    }
    parts.push(`${stats.wordCount} palavras`);
    if (stats.fileSizeMB) {
      parts.push(`${stats.fileSizeMB.toFixed(1)} MB`);
    }
    elements.audioStats.textContent = parts.join(' · ');
  }

  if (elements.btnShareAudio) {
    elements.btnShareAudio.hidden = !navigator.share;
  }
}

function openAudioChat() {
  if (!state.audioResult?.transcription) {
    showToast('Nenhuma transcrição disponível', 'error');
    return;
  }
  state.audioChatMessages = [];
  renderChatMessages();
  elements.chatInput.value = '';
  elements.chatInput.disabled = false;
  elements.btnSendChat.disabled = false;
  showStep('audio-chat');
  elements.chatInput.focus();
}

function renderChatMessages() {
  if (!elements.chatMessages) return;
  elements.chatMessages.innerHTML = '';

  if (state.audioChatMessages.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'chat-empty';
    empty.textContent = 'Faça sua primeira pergunta sobre o áudio.';
    empty.style.cssText = 'color: var(--text-muted); font-size: 0.9rem; text-align: center; padding: var(--spacing-lg);';
    elements.chatMessages.appendChild(empty);
    return;
  }

  state.audioChatMessages.forEach((msg) => {
    if (msg.role === 'system') return;

    const div = document.createElement('div');
    div.className = `chat-message ${msg.role}`;

    const bubble = document.createElement('div');
    bubble.className = 'chat-message-bubble';
    const escaped = msg.content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    bubble.innerHTML = escaped
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/##\s*(.+)/g, '<h2>$1</h2>')
      .replace(/\n/g, '<br>');

    const actions = document.createElement('div');
    actions.className = 'chat-message-actions';
    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copiar';
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(msg.content).then(() => showToast('Copiado!', 'success'));
    };
    actions.appendChild(copyBtn);
    div.appendChild(bubble);
    div.appendChild(actions);
    elements.chatMessages.appendChild(div);
  });

  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

async function sendChatMessage() {
  const input = elements.chatInput;
  const text = input?.value?.trim();
  if (!text || !state.audioResult?.transcription) return;

  if (isRateLimitActive()) {
    showToast('Aguarde o limite de API para enviar.', 'error');
    return;
  }

  const userMessage = { role: 'user', content: text };
  state.audioChatMessages.push(userMessage);
  input.value = '';
  input.disabled = true;
  elements.btnSendChat.disabled = true;

  renderChatMessages();
  elements.chatTyping.hidden = false;
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;

  const messagesForApi = state.audioChatMessages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role, content: m.content }));

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const res = await fetch('/api/audio-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcription: state.audioResult.transcription,
        messages: messagesForApi,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      const errorMsg = data.error || 'Rate limit reached';
      const waitSeconds = parseWaitTime(errorMsg);
      const limitType = detectLimitType(errorMsg);
      startRateLimitCountdown(waitSeconds + 2, limitType);
      state.audioChatMessages.pop();
      renderChatMessages();
      showToast('Limite de API atingido. Aguarde e tente novamente.', 'error');
      return;
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Erro ${res.status}`);
    }

    const data = await res.json();
    const assistantMessage = { role: 'assistant', content: data.content || '' };
    state.audioChatMessages.push(assistantMessage);
    renderChatMessages();
  } catch (err) {
    if (err.name === 'AbortError') {
      showToast('Tempo esgotado. Tente uma pergunta mais curta.', 'error');
    } else {
      showToast(err.message || 'Erro ao enviar', 'error');
    }
    state.audioChatMessages.pop();
    renderChatMessages();
  } finally {
    elements.chatTyping.hidden = true;
    input.disabled = false;
    elements.btnSendChat.disabled = false;
    input.focus();
  }
}
```

#### 6.6.4 Event Listeners

Add/update:

```javascript
// Audio level selection
elements.audioLevelOptions?.addEventListener('change', (e) => {
  if (e.target.name === 'audio-level') {
    document.querySelectorAll('#audio-level-options .radio-card').forEach(c => {
      c.classList.toggle('selected', c.querySelector('input').checked);
    });
  }
});

elements.btnGenerateSummary?.addEventListener('click', generateAudioSummary);

// Re-summarize: go back to choice step (transcription already in state)
elements.btnResummarize?.addEventListener('click', () => {
  displayAudioChoiceStep(state.audioResult.transcription, state.audioResult.stats);
  showStep('audio-choice');
});

// Audio Chat
elements.btnChatAudio?.addEventListener('click', openAudioChat);
elements.btnBackFromChat?.addEventListener('click', () => showStep('audio-result'));
elements.btnBackToAudioResult?.addEventListener('click', () => showStep('audio-result'));
elements.btnSendChat?.addEventListener('click', sendChatMessage);

elements.chatInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});

elements.btnCopyChat?.addEventListener('click', async () => {
  const text = state.audioChatMessages
    .filter(m => m.role !== 'system')
    .map(m => `${m.role === 'user' ? 'Você' : 'Assistente'}: ${m.content}`)
    .join('\n\n');
  try {
    await navigator.clipboard.writeText(text);
    showToast('Conversa copiada!', 'success');
  } catch {
    showToast('Erro ao copiar', 'error');
  }
});
```

---

### 6.7 `vercel.json` — Function Config

```json
{
  "version": 2,
  "buildCommand": "npm run build",
  "outputDirectory": "public",
  "functions": {
    "api/transcribe.ts": { "memory": 1024, "maxDuration": 30 },
    "api/summarize-audio.ts": { "memory": 512, "maxDuration": 10 },
    "api/audio-chat.ts": { "memory": 512, "maxDuration": 10 },
    "api/**/*.ts": { "memory": 1024, "maxDuration": 10 }
  },
  "routes": [
    { "src": "/api/(.*)", "dest": "/api/$1" },
    { "src": "/share", "dest": "/share.html" },
    { "src": "/(.*)", "dest": "/$1" }
  ]
}
```

---

### 6.8 `dev-server.js` — Add Routes

Add these routes (the dev-server may need to proxy to Vercel for transcribe, or you can add a local implementation). For full local dev, add:

**Transcribe** (simplified — calls Groq Whisper; requires `formidable` for multipart):
```javascript
// Add after express.json() - transcribe needs raw body
app.post('/api/transcribe', async (req, res) => {
  try {
    const form = formidable({ maxFileSize: 25 * 1024 * 1024 });
    const [, files] = await form.parse(req);
    const audioFile = files.audio?.[0] || files.file?.[0];
    if (!audioFile) {
      return res.status(400).json({ error: 'No audio file provided' });
    }
    const transcriptionResult = await groq.audio.transcriptions.create({
      model: 'whisper-large-v3-turbo',
      file: createReadStream(audioFile.filepath),
      language: 'pt',
      response_format: 'verbose_json',
    });
    const text = typeof transcriptionResult === 'string' ? transcriptionResult : transcriptionResult.text;
    const duration = typeof transcriptionResult !== 'string' ? (transcriptionResult.duration ?? null) : null;
    const wordCount = text.split(/\s+/).length;
    res.json({
      transcription: text,
      stats: {
        audioDuration: duration ? Math.round(duration) : null,
        wordCount,
        fileSizeMB: (audioFile.size / (1024 * 1024)).toFixed(2),
        transcribeTimeMs: 0,
        whisperModel: 'whisper-large-v3-turbo',
      },
    });
  } catch (err) {
    console.error('Transcribe error:', err);
    if (err.message?.includes('rate') || err.message?.includes('429')) {
      return res.status(429).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to process audio' });
  }
});
```

**Summarize-audio:**
```javascript
app.post('/api/summarize-audio', async (req, res) => {
  try {
    const { transcription, level = 'topicos' } = req.body || {};
    if (!transcription) {
      return res.status(400).json({ error: 'Missing transcription' });
    }
    // Use same logic as api/summarize-audio.ts - import LEVEL_CONFIGS or inline
    const LEVEL_CONFIGS = { /* copy from 6.2 */ };
    const config = LEVEL_CONFIGS[level] || LEVEL_CONFIGS.topicos;
    const userMessage = level === 'limpa'
      ? `Transforme esta transcrição em texto limpo:\n\n${transcription}`
      : `Resuma este áudio:\n\n${transcription}`;
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: config.systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: config.maxTokens,
      temperature: 0.3,
    });
    res.json({ summary: completion.choices[0]?.message?.content?.trim() || '' });
  } catch (err) {
    console.error('Summarize audio error:', err);
    if (err.message?.includes('rate') || err.message?.includes('429')) {
      return res.status(429).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});
```

**Audio-chat:** Same as section 6.3, add as Express route.

**Note:** The dev-server uses `express.json()` which parses JSON. For `/api/transcribe`, you need to skip body parsing — define the transcribe route **before** `app.use(express.json())`. Add `import { createReadStream } from 'fs'` at the top. Alternatively, use `vercel dev` for local development to run the actual serverless functions.

---

## 7. Token & Context Management

### Summarize-Audio
- **Flash:** ~200 tokens max
- **Tópicos:** ~600 tokens max
- **Detalhado:** ~1200 tokens max
- **Limpa:** ~4000 tokens max (transcription can be long)

For very long transcriptions (>100K chars), consider truncating before sending to summarize-audio. The Llama context is 128K, so most 5–10 min audios (~2.5K–5K words) fit easily.

### Audio Chat
- Transcription truncated at 100K chars (~25K tokens) if needed
- Last 12 messages sent
- Max response 1024 tokens

---

## 8. Edge Cases & UX Details

### 8.1 Re-summarize Flow
- User clicks "Re-summarizar" → returns to `step-audio-choice` with transcription already displayed
- Level selection shows current level as selected (optional enhancement)
- No API call until "Gerar Resumo" is clicked

### 8.2 Chat Uses Transcription
- The chat endpoint receives **transcription** only (summary is not sent)
- This gives the AI full context for answering questions

### 8.3 Share Target
- When user shares an audio from another app, the flow is: handleFile → handleAudioFile → transcribe → audio-choice → generate → audio-result
- No changes needed to share target handling

### 8.4 Mobile
- Level selection uses same `radio-cards` as group chat options
- Chat: `max-height: 50vh` for messages, input stays visible

### 8.5 Rate Limits
- All three endpoints (transcribe, summarize-audio, audio-chat) use the same Groq rate limits
- Reuse `isRateLimitActive()`, `startRateLimitCountdown()`, etc.

---

## Summary Checklist

| Task | Status |
|------|--------|
| Modify `api/transcribe.ts` — transcription only | Pending |
| Create `api/summarize-audio.ts` | Pending |
| Create `api/audio-chat.ts` | Pending |
| Add `step-audio-choice` to index.html | Pending |
| Add `step-audio-chat` to index.html | Pending |
| Update `step-audio-result` with new buttons | Pending |
| Add styles for choice + chat | Pending |
| Update app.js — new flow, generateAudioSummary, chat | Pending |
| Add event listeners | Pending |
| Update vercel.json | Pending |
| Add routes to dev-server.js | Pending |

---

## Estimated Effort

| Phase | Time |
|-------|------|
| API: transcribe + summarize-audio + audio-chat | ~1 h |
| HTML: audio-choice + audio-chat + result update | ~30 min |
| CSS: level selection + chat styles | ~30 min |
| JS: flow, generateAudioSummary, chat logic | ~1 h |
| Dev-server + testing | ~30 min |
| **Total** | **~3.5 h** |
