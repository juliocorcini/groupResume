import type { VercelRequest, VercelResponse } from '@vercel/node';
import formidable from 'formidable';
import { readFile } from 'fs/promises';
import { parseAndIndex } from '../src/services/parser.js';
import { extractDateInfo, getRecentDates, getDateStats } from '../src/services/dateExtractor.js';
import { generateId, storeChat } from '../src/services/store.js';
import type { UploadResponse, ErrorResponse } from '../src/types/index.js';

// Disable body parsing - we handle it with formidable
export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * POST /api/upload
 * 
 * Receives a WhatsApp export file and returns available dates
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    const error: ErrorResponse = { 
      error: 'Method not allowed', 
      code: 'METHOD_NOT_ALLOWED' 
    };
    res.status(405).json(error);
    return;
  }

  try {
    // Parse multipart form data
    const form = formidable({
      maxFileSize: 10 * 1024 * 1024, // 10MB max
      allowEmptyFiles: false,
    });

    const [, files] = await form.parse(req);
    
    const uploadedFile = files.file?.[0];
    if (!uploadedFile) {
      const error: ErrorResponse = { 
        error: 'No file uploaded', 
        code: 'NO_FILE' 
      };
      res.status(400).json(error);
      return;
    }

    // Read file content
    const fileContent = await readFile(uploadedFile.filepath, 'utf-8');

    if (!fileContent.trim()) {
      const error: ErrorResponse = { 
        error: 'File is empty', 
        code: 'EMPTY_FILE' 
      };
      res.status(400).json(error);
      return;
    }

    // Parse WhatsApp chat
    const { messages, dateIndex } = parseAndIndex(fileContent);

    if (messages.length === 0) {
      const error: ErrorResponse = { 
        error: 'No messages found. Make sure this is a WhatsApp export file.', 
        code: 'NO_MESSAGES' 
      };
      res.status(400).json(error);
      return;
    }

    // Extract date information
    const allDates = extractDateInfo(messages, dateIndex);
    const recentDates = getRecentDates(allDates, 3);
    const stats = getDateStats(allDates);

    // Generate ID and store
    const id = generateId();
    storeChat({
      id,
      messages,
      dateIndex,
      dates: allDates,
      uploadedAt: Date.now()
    });

    // Build response
    const response: UploadResponse = {
      id,
      recentDates,
      totalDays: stats.totalDays,
      oldestDate: stats.oldestDate,
      newestDate: stats.newestDate,
      totalMessages: stats.totalMessages
    };

    res.status(200).json(response);

  } catch (err) {
    console.error('Upload error:', err);
    const error: ErrorResponse = { 
      error: 'Failed to process file', 
      code: 'PROCESSING_ERROR' 
    };
    res.status(500).json(error);
  }
}

