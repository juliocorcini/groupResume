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

interface SummarizeRequestBody {
  messages: ParsedMessage[];
  level: SummaryLevel;
  privacy: PrivacyMode;
  isPartial?: boolean;
}

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Models with different TPM limits - choose based on message count
const MODELS = {
  small: 'llama-3.1-8b-instant',      // Fast, 6K TPM - for small conversations
  medium: 'llama-3.3-70b-versatile',  // Better quality, 6K TPM
  large: 'meta-llama/llama-4-scout-17b-16e-instruct', // 30K TPM - for large conversations
};

function selectModel(messageCount: number): string {
  if (messageCount > 500) return MODELS.large;  // 30K TPM allows big batches
  if (messageCount > 100) return MODELS.medium; // Better quality for medium
  return MODELS.small; // Fast for small conversations
}

const LEVEL_CONFIGS: Record<SummaryLevel, { maxTokens: number; prompt: string }> = {
  1: { maxTokens: 150, prompt: 'Faça um resumo ULTRA-CURTO em 2-3 frases dos principais tópicos.' },
  2: { maxTokens: 400, prompt: 'Faça um resumo CURTO com parágrafos breves por assunto.' },
  3: { maxTokens: 600, prompt: 'Faça um resumo DETALHADO cobrindo todos os assuntos importantes.' },
  4: { maxTokens: 1000, prompt: 'Faça um resumo COMPLETO incluindo quem disse o quê.' }
};

const PRIVACY_INSTRUCTIONS: Record<PrivacyMode, string> = {
  'anonymous': 'NÃO mencione nomes de pessoas ou números. Use termos genéricos.',
  'with-names': 'Mencione os nomes das pessoas quando relevante.',
  'smart': 'Mencione nomes APENAS para contribuições muito importantes.'
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
    const { messages, level = 3, privacy = 'smart', isPartial = false } = req.body as SummarizeRequestBody;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'No messages provided' });
      return;
    }

    const summaryLevel: SummaryLevel = ([1, 2, 3, 4].includes(level) ? level : 3) as SummaryLevel;
    const privacyMode: PrivacyMode = ['anonymous', 'with-names', 'smart'].includes(privacy) ? privacy : 'smart';
    const includeNames = privacyMode !== 'anonymous';

    const config = LEVEL_CONFIGS[summaryLevel];
    const privacyNote = PRIVACY_INSTRUCTIONS[privacyMode];

    const messagesText = formatMessages(messages, includeNames);
    const participants = new Set(messages.map(m => m.sender).filter(s => s !== '__system__'));

    const systemPrompt = `Você é um assistente que resume conversas de grupo do WhatsApp em português brasileiro.
${config.prompt}
${privacyNote}
${isPartial ? 'Este é apenas uma PARTE da conversa. Faça um resumo desta parte.' : ''}
Organize por temas/assuntos quando apropriado. Use markdown para formatação.`;

    const model = selectModel(messages.length);
    
    const completion = await groq.chat.completions.create({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Resuma esta conversa:\n\n${messagesText}` }
      ],
      max_tokens: config.maxTokens,
      temperature: 0.3,
    });

    res.status(200).json({
      summary: completion.choices[0]?.message?.content || '',
      stats: {
        totalMessages: messages.length,
        participants: participants.size,
        tokensUsed: completion.usage?.total_tokens || 0,
        chunks: 1,
        processingTime: Date.now() - startTime
      }
    });

  } catch (err) {
    console.error('Summarize error:', err);
    
    if (err instanceof Error && (err.message.includes('rate') || err.message.includes('429') || err.message.includes('413'))) {
      res.status(429).json({ error: 'Limite de tokens excedido. Aguarde um momento e tente novamente.' });
      return;
    }

    res.status(500).json({ error: 'Falha ao gerar resumo' });
  }
}
