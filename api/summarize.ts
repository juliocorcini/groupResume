import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getChat } from '../src/services/store.js';
import { getMessagesForDate } from '../src/services/parser.js';
import { chunkMessages, formatChunkForAI, getChunkStats } from '../src/services/chunker.js';
import { generateSummary, mergeSummaries } from '../src/services/groq.js';
import type { SummarizeRequest, SummarizeResponse, ErrorResponse, SummaryLevel, PrivacyMode } from '../src/types/index.js';

/**
 * POST /api/summarize
 * 
 * Generates a summary for a specific date
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

  const startTime = Date.now();

  try {
    const body = req.body as SummarizeRequest;
    const { id, date, level, privacy } = body;

    // Validate request
    if (!id || !date) {
      const error: ErrorResponse = { 
        error: 'Missing required fields: id and date', 
        code: 'MISSING_FIELDS' 
      };
      res.status(400).json(error);
      return;
    }

    // Validate level
    const summaryLevel: SummaryLevel = ([1, 2, 3, 4].includes(level) ? level : 3) as SummaryLevel;
    
    // Validate privacy
    const privacyMode: PrivacyMode = ['anonymous', 'with-names', 'smart'].includes(privacy) 
      ? privacy 
      : 'smart';

    // Get chat from store
    const chat = getChat(id);
    
    if (!chat) {
      const error: ErrorResponse = { 
        error: 'Chat not found. It may have expired. Please upload the file again.', 
        code: 'NOT_FOUND' 
      };
      res.status(404).json(error);
      return;
    }

    // Get messages for the selected date
    const messages = getMessagesForDate(chat.messages, chat.dateIndex, date);

    if (messages.length === 0) {
      const error: ErrorResponse = { 
        error: 'No messages found for this date', 
        code: 'NO_MESSAGES_FOR_DATE' 
      };
      res.status(404).json(error);
      return;
    }

    // Get unique participants
    const participants = new Set(messages.map(m => m.sender).filter(s => s !== '__system__'));

    // Determine if names should be included based on privacy mode
    const includeNames = privacyMode !== 'anonymous';

    // Chunk messages if necessary
    const chunks = chunkMessages(messages);
    const chunkStats = getChunkStats(chunks);

    let finalSummary: string;
    let totalTokens = 0;

    if (chunks.length === 1) {
      // Single chunk - direct summarization
      const text = formatChunkForAI(chunks[0], 0, 1, includeNames);
      const result = await generateSummary(text, summaryLevel, privacyMode);
      finalSummary = result.summary;
      totalTokens = result.tokensUsed;
    } else {
      // Multiple chunks - summarize each, then merge
      const partialSummaries: string[] = [];

      for (let i = 0; i < chunks.length; i++) {
        const text = formatChunkForAI(chunks[i], i, chunks.length, includeNames);
        const result = await generateSummary(text, summaryLevel, privacyMode, true);
        partialSummaries.push(result.summary);
        totalTokens += result.tokensUsed;
      }

      // Merge all partial summaries
      const mergeResult = await mergeSummaries(partialSummaries, summaryLevel, privacyMode);
      finalSummary = mergeResult.summary;
      totalTokens += mergeResult.tokensUsed;
    }

    const processingTime = Date.now() - startTime;

    const response: SummarizeResponse = {
      summary: finalSummary,
      stats: {
        totalMessages: messages.length,
        participants: participants.size,
        tokensUsed: totalTokens,
        chunks: chunks.length,
        processingTime
      }
    };

    res.status(200).json(response);

  } catch (err) {
    console.error('Summarize error:', err);
    
    // Check for rate limit error
    if (err instanceof Error && err.message.includes('rate')) {
      const error: ErrorResponse = { 
        error: 'Rate limit exceeded. Please wait a moment and try again.', 
        code: 'RATE_LIMITED' 
      };
      res.status(429).json(error);
      return;
    }

    const error: ErrorResponse = { 
      error: 'Failed to generate summary', 
      code: 'SUMMARIZE_ERROR' 
    };
    res.status(500).json(error);
  }
}

