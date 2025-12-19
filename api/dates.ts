import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getChat } from '../src/services/store.js';
import type { DatesResponse, ErrorResponse } from '../src/types/index.js';

/**
 * GET /api/dates?id=xxx&all=true
 * 
 * Returns dates with messages for a previously uploaded chat
 * - Without all=true: returns only recent dates (default 3)
 * - With all=true: returns all dates
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    const error: ErrorResponse = { 
      error: 'Method not allowed', 
      code: 'METHOD_NOT_ALLOWED' 
    };
    res.status(405).json(error);
    return;
  }

  try {
    const { id, all } = req.query;

    if (!id || typeof id !== 'string') {
      const error: ErrorResponse = { 
        error: 'Missing chat ID', 
        code: 'MISSING_ID' 
      };
      res.status(400).json(error);
      return;
    }

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

    // Return dates based on 'all' parameter
    const dates = all === 'true' 
      ? chat.dates 
      : chat.dates.slice(0, 3);

    const response: DatesResponse = { dates };
    res.status(200).json(response);

  } catch (err) {
    console.error('Dates error:', err);
    const error: ErrorResponse = { 
      error: 'Failed to retrieve dates', 
      code: 'PROCESSING_ERROR' 
    };
    res.status(500).json(error);
  }
}

