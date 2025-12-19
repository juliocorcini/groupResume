import type { VercelRequest, VercelResponse } from '@vercel/node';
import Groq from 'groq-sdk';
import type { SummaryLevel, PrivacyMode } from '../src/types/index.js';

interface ParsedMessage {
  date: string;
  time: string;
  sender: string;
  content: string;
  isMedia: boolean;
}

type ModelType = 'fast' | 'balanced' | 'powerful';

interface SummarizeRequestBody {
  messages: ParsedMessage[];
  level: SummaryLevel;
  privacy: PrivacyMode;
  model?: ModelType;
  isPartial?: boolean;
}

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Models - tested for Vercel 10s timeout
// llama-3.3-70b-versatile is the BEST: fast (<1s) and handles 150 msgs
const MODELS = {
  fast: 'llama-3.1-8b-instant',        // 6K TPM, <1s, max 100 msgs
  balanced: 'llama-3.3-70b-versatile', // 12K TPM, <1s, max 150 msgs - BEST!
  powerful: 'llama-3.3-70b-versatile'  // Same - compound-beta was too slow
};

// Max messages per request (tested limits for <10s response)
const MAX_MESSAGES = {
  fast: 100,      // Safe limit from tests
  balanced: 150,  // Best performance!
  powerful: 150   // Same as balanced now
};

const LEVEL_CONFIGS: Record<SummaryLevel, { maxTokens: number; prompt: string }> = {
  1: { maxTokens: 150, prompt: 'Faça um resumo ULTRA-CURTO em 2-3 frases.' },
  2: { maxTokens: 300, prompt: 'Faça um resumo CURTO com parágrafos breves.' },
  3: { maxTokens: 500, prompt: 'Faça um resumo DETALHADO dos assuntos.' },
  4: { maxTokens: 700, prompt: 'Faça um resumo COMPLETO incluindo quem disse o quê.' }
};

const PRIVACY_INSTRUCTIONS: Record<PrivacyMode, string> = {
  'anonymous': 'NÃO mencione nomes. Use termos genéricos.',
  'with-names': 'Mencione os nomes das pessoas quando relevante.',
  'smart': 'Mencione nomes APENAS para contribuições importantes.'
};

function formatMessages(messages: ParsedMessage[], includeNames: boolean): string {
  return messages
    .filter(msg => msg.sender !== '__system__')
    .map(msg => {
      if (msg.isMedia) {
        return includeNames ? `[${msg.time}] ${msg.sender}: [mídia]` : `[${msg.time}] [mídia]`;
      }
      return includeNames ? `[${msg.time}] ${msg.sender}: ${msg.content}` : `[${msg.time}] ${msg.content}`;
    })
    .join('\n');
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const startTime = Date.now();

  try {
    const { messages, level = 3, privacy = 'smart', model = 'powerful', isPartial = false } = req.body as SummarizeRequestBody;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'No messages provided' });
      return;
    }

    const summaryLevel: SummaryLevel = ([1, 2, 3, 4].includes(level) ? level : 3) as SummaryLevel;
    const privacyMode: PrivacyMode = ['anonymous', 'with-names', 'smart'].includes(privacy) ? privacy : 'smart';
    const includeNames = privacyMode !== 'anonymous';
    const modelType: ModelType = ['fast', 'balanced', 'powerful'].includes(model) ? model : 'powerful';
    
    const selectedModel = MODELS[modelType];
    const maxMessages = MAX_MESSAGES[modelType];

    // Limit messages based on model capacity
    const messagesToProcess = messages.slice(0, maxMessages);
    const wasLimited = messages.length > maxMessages;

    const config = LEVEL_CONFIGS[summaryLevel];
    const privacyNote = PRIVACY_INSTRUCTIONS[privacyMode];
    const messagesText = formatMessages(messagesToProcess, includeNames);
    const participants = new Set(messagesToProcess.map(m => m.sender).filter(s => s !== '__system__'));

    const systemPrompt = `Você é um assistente que resume conversas de grupo do WhatsApp em português brasileiro.
${config.prompt}
${privacyNote}
${isPartial ? 'Este é uma PARTE da conversa. Resuma esta parte.' : ''}
Organize por temas. Use markdown.`;

    const completion = await groq.chat.completions.create({
      model: selectedModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Resuma:\n\n${messagesText}` }
      ],
      max_tokens: config.maxTokens,
      temperature: 0.3,
    });

    res.status(200).json({
      summary: completion.choices[0]?.message?.content || '',
      stats: {
        totalMessages: messagesToProcess.length,
        originalCount: messages.length,
        participants: participants.size,
        tokensUsed: completion.usage?.total_tokens || 0,
        processingTime: Date.now() - startTime,
        wasLimited,
        maxMessages,
        model: modelType
      }
    });

  } catch (err) {
    console.error('Summarize error:', err);
    
    if (err instanceof Error && (err.message.includes('rate') || err.message.includes('429') || err.message.includes('413'))) {
      res.status(429).json({ error: 'Limite de tokens. Aguarde um momento.' });
      return;
    }

    res.status(500).json({ error: 'Falha ao gerar resumo' });
  }
}
