import type { VercelRequest, VercelResponse } from '@vercel/node';
import formidable from 'formidable';
import { readFile } from 'fs/promises';
import type { ErrorResponse } from '../src/types/index.js';

// Disable body parsing - we handle it with formidable
export const config = {
  api: {
    bodyParser: false,
  },
};

// Regex to match WhatsApp message format
const MESSAGE_REGEX = /^(\d{2}\/\d{2}\/\d{4}) (\d{2}:\d{2}) - ([^:]+): (.*)$/;

function convertDate(brDate: string): string {
  const [day, month, year] = brDate.split('/');
  return `${year}-${month}-${day}`;
}

function isMediaMessage(content: string): boolean {
  const mediaPatterns = ['<mídia oculta>', '<media omitted>', 'imagem ocultada'];
  return mediaPatterns.some(pattern => content.toLowerCase().includes(pattern));
}

interface ParsedMessage {
  date: string;
  time: string;
  sender: string;
  content: string;
  isMedia: boolean;
}

interface DateInfo {
  date: string;
  messageCount: number;
  participants: number;
  preview: string;
}

interface MessagesByDate {
  [date: string]: ParsedMessage[];
}

/**
 * POST /api/upload
 * 
 * Receives a WhatsApp export file and returns all parsed data
 * Client stores this data and sends it back for summarization
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

    // Parse messages
    const lines = fileContent.split('\n');
    const messagesByDate: MessagesByDate = {};
    let currentMessage: ParsedMessage | null = null;

    for (const line of lines) {
      if (!line.trim() && !currentMessage) continue;

      const messageMatch = line.match(MESSAGE_REGEX);
      
      if (messageMatch) {
        if (currentMessage) {
          // Save previous message
          if (!messagesByDate[currentMessage.date]) {
            messagesByDate[currentMessage.date] = [];
          }
          messagesByDate[currentMessage.date].push(currentMessage);
        }

        const [, brDate, time, sender, content] = messageMatch;
        currentMessage = {
          date: convertDate(brDate),
          time,
          sender: sender.trim(),
          content: content,
          isMedia: isMediaMessage(content)
        };
      } else if (currentMessage && line.trim()) {
        // Multi-line message continuation
        currentMessage.content += '\n' + line;
      }
    }

    // Don't forget the last message
    if (currentMessage) {
      if (!messagesByDate[currentMessage.date]) {
        messagesByDate[currentMessage.date] = [];
      }
      messagesByDate[currentMessage.date].push(currentMessage);
    }

    // Check if we got any messages
    const totalMessages = Object.values(messagesByDate).reduce((sum, msgs) => sum + msgs.length, 0);
    
    if (totalMessages === 0) {
      const error: ErrorResponse = { 
        error: 'No messages found. Make sure this is a WhatsApp export file.', 
        code: 'NO_MESSAGES' 
      };
      res.status(400).json(error);
      return;
    }

    // Build date info
    const dates: DateInfo[] = Object.entries(messagesByDate)
      .map(([date, messages]) => {
        const participants = new Set(messages.map(m => m.sender).filter(s => s !== '__system__'));
        const firstMsg = messages.find(m => !m.isMedia && m.sender !== '__system__');
        const preview = firstMsg ? firstMsg.content.substring(0, 50) + (firstMsg.content.length > 50 ? '...' : '') : '';
        
        return {
          date,
          messageCount: messages.length,
          participants: participants.size,
          preview
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date)); // Most recent first

    // Return all data to client
    res.status(200).json({
      messagesByDate,
      dates,
      totalMessages,
      totalDays: dates.length,
      oldestDate: dates[dates.length - 1]?.date || '',
      newestDate: dates[0]?.date || ''
    });

  } catch (err) {
    console.error('Upload error:', err);
    const error: ErrorResponse = { 
      error: 'Failed to process file', 
      code: 'PROCESSING_ERROR' 
    };
    res.status(500).json(error);
  }
}
