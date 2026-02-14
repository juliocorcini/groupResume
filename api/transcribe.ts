import type { VercelRequest, VercelResponse } from '@vercel/node';
import Groq from 'groq-sdk';
import formidable from 'formidable';
import { createReadStream } from 'fs';
import { rename, stat } from 'fs/promises';
import { extname } from 'path';

// Disable body parsing — we handle it with formidable
export const config = {
  api: {
    bodyParser: false,
  },
};

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Whisper: fast + cheap, good for Portuguese
const WHISPER_MODEL = 'whisper-large-v3-turbo';
// Llama: fast model for summarization
const SUMMARY_MODEL = 'llama-3.1-8b-instant';

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB (Groq free tier limit)

/**
 * POST /api/transcribe
 *
 * Receives an audio file, transcribes it with Groq Whisper,
 * summarizes the transcription with Groq Llama, and returns both.
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // CORS headers
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
    // 1. Parse audio file with formidable
    const form = formidable({
      maxFileSize: MAX_FILE_SIZE,
      allowEmptyFiles: false,
    });

    const [, files] = await form.parse(req);

    // Accept file from either 'audio' or 'file' field name
    const audioFile = files.audio?.[0] || files.file?.[0];

    if (!audioFile) {
      res.status(400).json({ error: 'No audio file provided', code: 'NO_FILE' });
      return;
    }

    // Get file size for stats
    const fileStats = await stat(audioFile.filepath);
    const fileSizeMB = fileStats.size / (1024 * 1024);

    // Formidable saves files without extension — Groq API requires a valid
    // audio extension to detect file type. Rename temp file with the original extension.
    const originalName = audioFile.originalFilename || 'audio.ogg';
    const ext = extname(originalName) || '.ogg';
    const renamedPath = audioFile.filepath + ext;
    await rename(audioFile.filepath, renamedPath);

    // 2. Transcribe with Groq Whisper
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

    // Groq verbose_json returns duration but the SDK type doesn't expose it
    const audioDuration = typeof transcriptionResult !== 'string'
      ? (transcriptionResult as unknown as { duration?: number }).duration ?? null
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
        fileSizeMB: parseFloat(fileSizeMB.toFixed(2)),
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

    // Rate limit handling — pass full message so frontend can extract wait time
    if (
      errorMessage.includes('rate') ||
      errorMessage.includes('429') ||
      errorMessage.includes('Rate limit')
    ) {
      res.status(429).json({ error: errorMessage || 'Rate limit reached' });
      return;
    }

    // File too large
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
