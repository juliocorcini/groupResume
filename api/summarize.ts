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
}

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// Using mixtral for better quality and larger context
const MODEL = 'mixtral-8x7b-32768';
// Keep chunks small to stay under 6k TPM limit per request
const MAX_TOKENS_PER_CHUNK = 4000;

const LEVEL_CONFIGS: Record<SummaryLevel, { name: string; maxTokens: number; prompt: string }> = {
  1: { name: 'Flash', maxTokens: 150, prompt: 'Faça um resumo ULTRA-CURTO em apenas 2-3 frases dos principais tópicos.' },
  2: { name: 'Resumido', maxTokens: 400, prompt: 'Faça um resumo CURTO com parágrafos breves por assunto.' },
  3: { name: 'Padrão', maxTokens: 600, prompt: 'Faça um resumo DETALHADO cobrindo todos os assuntos importantes.' },
  4: { name: 'Completo', maxTokens: 1000, prompt: 'Faça um resumo COMPLETO e detalhado incluindo quem disse o quê.' }
};

const PRIVACY_INSTRUCTIONS: Record<PrivacyMode, string> = {
  'anonymous': 'NÃO mencione nomes de pessoas ou números de telefone. Use termos como "o grupo discutiu", "alguém mencionou".',
  'with-names': 'Mencione os nomes das pessoas quando relevante para o contexto.',
  'smart': 'Mencione nomes APENAS para contribuições muito importantes. Evite números de telefone.'
};

// Estimate tokens (roughly 4 chars per token for Portuguese)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Format messages for AI
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

// Chunk messages into groups that fit token limits
function chunkMessages(messages: ParsedMessage[], includeNames: boolean): string[] {
  const chunks: string[] = [];
  let currentChunk: ParsedMessage[] = [];
  let currentTokens = 0;

  for (const msg of messages) {
    const msgText = includeNames 
      ? `[${msg.time}] ${msg.sender}: ${msg.content}`
      : `[${msg.time}] ${msg.content}`;
    const msgTokens = estimateTokens(msgText);

    if (currentTokens + msgTokens > MAX_TOKENS_PER_CHUNK && currentChunk.length > 0) {
      chunks.push(formatMessages(currentChunk, includeNames));
      currentChunk = [];
      currentTokens = 0;
    }

    currentChunk.push(msg);
    currentTokens += msgTokens;
  }

  if (currentChunk.length > 0) {
    chunks.push(formatMessages(currentChunk, includeNames));
  }

  return chunks;
}

// Generate summary for a single chunk
async function summarizeChunk(
  text: string, 
  config: typeof LEVEL_CONFIGS[1], 
  privacyNote: string,
  isPartial: boolean
): Promise<{ summary: string; tokens: number }> {
  const systemPrompt = `Você é um assistente que resume conversas de grupo do WhatsApp em português brasileiro.
${config.prompt}
${privacyNote}
${isPartial ? 'Este é apenas uma PARTE da conversa. Faça um resumo desta parte.' : ''}
Organize por temas/assuntos quando apropriado. Use markdown para formatação.`;

  const completion = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Resuma esta conversa:\n\n${text}` }
    ],
    max_tokens: config.maxTokens,
    temperature: 0.3,
  });

  return {
    summary: completion.choices[0]?.message?.content || '',
    tokens: completion.usage?.total_tokens || 0
  };
}

// Merge multiple summaries into one
async function mergeSummaries(
  summaries: string[], 
  config: typeof LEVEL_CONFIGS[1],
  privacyNote: string
): Promise<{ summary: string; tokens: number }> {
  const systemPrompt = `Você é um assistente que consolida resumos de conversa em português brasileiro.
${config.prompt}
${privacyNote}
Você receberá vários resumos parciais. Combine-os em um único resumo coeso, removendo redundâncias.
Use markdown para formatação.`;

  const combined = summaries.map((s, i) => `### Parte ${i + 1}\n${s}`).join('\n\n');

  const completion = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Combine estes resumos em um único resumo final:\n\n${combined}` }
    ],
    max_tokens: Math.floor(config.maxTokens * 1.5),
    temperature: 0.3,
  });

  return {
    summary: completion.choices[0]?.message?.content || '',
    tokens: completion.usage?.total_tokens || 0
  };
}

/**
 * POST /api/summarize
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
    res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
    return;
  }

  const startTime = Date.now();

  try {
    const body = req.body as SummarizeRequestBody;
    const { messages, level = 3, privacy = 'smart' } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'No messages provided', code: 'NO_MESSAGES' });
      return;
    }

    const summaryLevel: SummaryLevel = ([1, 2, 3, 4].includes(level) ? level : 3) as SummaryLevel;
    const privacyMode: PrivacyMode = ['anonymous', 'with-names', 'smart'].includes(privacy) ? privacy : 'smart';

    const participants = new Set(messages.map(m => m.sender).filter(s => s !== '__system__'));
    const includeNames = privacyMode !== 'anonymous';

    const config = LEVEL_CONFIGS[summaryLevel];
    const privacyNote = PRIVACY_INSTRUCTIONS[privacyMode];

    // Chunk messages if needed
    const chunks = chunkMessages(messages, includeNames);
    let totalTokens = 0;
    let finalSummary: string;

    // For large conversations, only process first chunk to avoid timeout and rate limits
    // Client can request more chunks separately if needed
    const maxChunksPerRequest = 1; // Process only 1 chunk per request to stay under limits
    
    if (chunks.length === 1) {
      // Single chunk - direct summarization
      const result = await summarizeChunk(chunks[0], config, privacyNote, false);
      finalSummary = result.summary;
      totalTokens = result.tokens;
    } else if (chunks.length <= maxChunksPerRequest) {
      // Few chunks - can process all
      const partialSummaries: string[] = [];
      
      for (const chunk of chunks) {
        const result = await summarizeChunk(chunk, config, privacyNote, true);
        partialSummaries.push(result.summary);
        totalTokens += result.tokens;
      }

      const mergeResult = await mergeSummaries(partialSummaries, config, privacyNote);
      finalSummary = mergeResult.summary;
      totalTokens += mergeResult.tokens;
    } else {
      // Too many chunks - summarize what we can in one request
      // Take messages from different parts of the day for a representative sample
      const sampleSize = Math.min(messages.length, 200); // Max 200 messages
      const step = Math.floor(messages.length / sampleSize);
      const sampledMessages = messages.filter((_, i) => i % step === 0).slice(0, sampleSize);
      
      const sampleText = formatMessages(sampledMessages, includeNames);
      const result = await summarizeChunk(sampleText, config, privacyNote, false);
      finalSummary = result.summary + `\n\n_Nota: Este resumo foi baseado em uma amostra de ${sampleSize} de ${messages.length} mensagens devido a limitações de processamento._`;
      totalTokens = result.tokens;
    }

    res.status(200).json({
      summary: finalSummary,
      stats: {
        totalMessages: messages.length,
        participants: participants.size,
        tokensUsed: totalTokens,
        chunks: chunks.length,
        processingTime: Date.now() - startTime
      }
    });

  } catch (err) {
    console.error('Summarize error:', err);
    
    if (err instanceof Error && (err.message.includes('rate') || err.message.includes('429'))) {
      res.status(429).json({ 
        error: 'Limite de requisições excedido. Aguarde um momento e tente novamente.', 
        code: 'RATE_LIMITED' 
      });
      return;
    }

    res.status(500).json({ error: 'Falha ao gerar resumo', code: 'SUMMARIZE_ERROR' });
  }
}
