import type { VercelRequest, VercelResponse } from '@vercel/node';
import Groq from 'groq-sdk';
import type { ErrorResponse, SummaryLevel, PrivacyMode } from '../src/types/index.js';

interface ParsedMessage {
  date: string;
  time: string;
  sender: string;
  content: string;
  isMedia: boolean;
}

interface SummarizeRequestBody {
  messages: ParsedMessage[];
  level: SummaryLevel;
  privacy: PrivacyMode;
  date: string;
}

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const MODEL = 'llama-3.1-8b-instant';

const LEVEL_CONFIGS: Record<SummaryLevel, { name: string; maxTokens: number; prompt: string }> = {
  1: { name: 'Flash', maxTokens: 100, prompt: 'Faça um resumo ULTRA-CURTO em apenas 1-2 frases.' },
  2: { name: 'Resumido', maxTokens: 300, prompt: 'Faça um resumo CURTO com parágrafos breves.' },
  3: { name: 'Padrão', maxTokens: 500, prompt: 'Faça um resumo DETALHADO cobrindo todos os assuntos.' },
  4: { name: 'Completo', maxTokens: 800, prompt: 'Faça um resumo COMPLETO incluindo quem disse o quê.' }
};

const PRIVACY_INSTRUCTIONS: Record<PrivacyMode, string> = {
  'anonymous': 'NÃO mencione nomes de pessoas ou números de telefone. Use termos como "o grupo discutiu", "alguém mencionou".',
  'with-names': 'Mencione os nomes das pessoas quando relevante para o contexto.',
  'smart': 'Mencione nomes APENAS para contribuições muito importantes. Evite números de telefone.'
};

/**
 * POST /api/summarize
 * 
 * Receives messages directly from client and generates summary
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
    const body = req.body as SummarizeRequestBody;
    const { messages, level = 3, privacy = 'smart', date } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const error: ErrorResponse = { 
        error: 'No messages provided', 
        code: 'NO_MESSAGES' 
      };
      res.status(400).json(error);
      return;
    }

    // Validate level and privacy
    const summaryLevel: SummaryLevel = ([1, 2, 3, 4].includes(level) ? level : 3) as SummaryLevel;
    const privacyMode: PrivacyMode = ['anonymous', 'with-names', 'smart'].includes(privacy) ? privacy : 'smart';

    // Get unique participants
    const participants = new Set(messages.map(m => m.sender).filter(s => s !== '__system__'));

    // Format messages for AI
    const includeNames = privacyMode !== 'anonymous';
    const messagesText = messages
      .filter(msg => msg.sender !== '__system__')
      .map(msg => {
        if (msg.isMedia) {
          return includeNames ? `[${msg.time}] ${msg.sender}: [mídia]` : `[${msg.time}] [mídia]`;
        }
        return includeNames ? `[${msg.time}] ${msg.sender}: ${msg.content}` : `[${msg.time}] ${msg.content}`;
      })
      .join('\n');

    // Build prompt
    const config = LEVEL_CONFIGS[summaryLevel];
    const privacyNote = PRIVACY_INSTRUCTIONS[privacyMode];

    const systemPrompt = `Você é um assistente que resume conversas de grupo do WhatsApp em português brasileiro.
${config.prompt}
${privacyNote}
Organize o resumo por temas/assuntos quando apropriado.`;

    // Call Groq API
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Resuma esta conversa do grupo:\n\n${messagesText}` }
      ],
      max_tokens: config.maxTokens,
      temperature: 0.3,
    });

    const summary = completion.choices[0]?.message?.content || '';
    const tokensUsed = completion.usage?.total_tokens || 0;
    const processingTime = Date.now() - startTime;

    res.status(200).json({
      summary,
      stats: {
        totalMessages: messages.length,
        participants: participants.size,
        tokensUsed,
        chunks: 1,
        processingTime
      }
    });

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
