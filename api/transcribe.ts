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
