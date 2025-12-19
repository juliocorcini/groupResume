import type { VercelRequest, VercelResponse } from '@vercel/node';
import Groq from 'groq-sdk';
import type { PrivacyMode } from '../src/types/index.js';

interface ParsedMessage {
  date: string;
  time: string;
  sender: string;
  content: string;
  isMedia: boolean;
}

type AnalysisStyle = 'roast' | 'personality' | 'report';

interface AnalyzeRequestBody {
  messages: ParsedMessage[];
  style: AnalysisStyle;
  privacy: PrivacyMode;
}

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Use FAST model to avoid Vercel 10s timeout
const MODEL = 'llama-3.1-8b-instant';
const MAX_MESSAGES = 150; // Smaller chunks for faster response

const PRIVACY_INSTRUCTIONS: Record<PrivacyMode, string> = {
  'anonymous': 'NÃO mencione nomes de pessoas. Use termos como "os participantes", "alguém", etc.',
  'with-names': 'Mencione os nomes das pessoas naturalmente.',
  'smart': 'Mencione nomes apenas quando for relevante para a análise.'
};

const STYLE_PROMPTS: Record<AnalysisStyle, { system: string; maxTokens: number }> = {
  roast: {
    system: `Você é um comediante brasileiro fazendo um "roast" amigável de um grupo de WhatsApp.
Crie uma análise ENGRAÇADA e IRÔNICA incluindo:
- Título criativo para o grupo
- Descrição irônica do que o grupo representa
- Os "tipos" de pessoas (o que manda áudio, o sumido, etc)
- Assuntos mais bizarros

Use humor brasileiro e gírias. Seja engraçado mas não ofensivo. Markdown.`,
    maxTokens: 400
  },
  
  personality: {
    system: `Você analisa a "personalidade" de um grupo de WhatsApp como se fosse uma pessoa.
Inclua:
- Nome e "signo" criativo do grupo
- Traços de personalidade
- O que deixa o grupo feliz/irritado
- Uma frase que define o grupo

Seja criativo! Use markdown.`,
    maxTokens: 400
  },
  
  report: {
    system: `Você cria um "relatório" divertido de um grupo de WhatsApp.
Inclua:
- Estatísticas engraçadas inventadas
- Prêmios irônicos para participantes
- Palavras/emojis que definem o grupo
- Previsões cômicas

Seja ENGRAÇADO! Use markdown.`,
    maxTokens: 400
  }
};

function formatMessages(messages: ParsedMessage[], includeNames: boolean): string {
  return messages
    .filter(msg => msg.sender !== '__system__')
    .map(msg => {
      if (msg.isMedia) {
        return includeNames ? `${msg.sender}: [mídia]` : '[mídia]';
      }
      return includeNames ? `${msg.sender}: ${msg.content}` : msg.content;
    })
    .join('\n');
}

function calculateVibeScore(messages: ParsedMessage[]): number {
  // Simple heuristic based on message characteristics
  let score = 5; // Base score
  
  const totalMsgs = messages.length;
  const uniqueSenders = new Set(messages.map(m => m.sender)).size;
  
  // More participants = more active
  if (uniqueSenders > 10) score += 1;
  if (uniqueSenders > 20) score += 1;
  
  // Check for engagement indicators
  const msgTexts = messages.map(m => m.content?.toLowerCase() || '').join(' ');
  
  // Laughter indicators
  const laughCount = (msgTexts.match(/k{3,}|haha|rs{2,}|😂|🤣/gi) || []).length;
  if (laughCount > totalMsgs * 0.1) score += 1;
  if (laughCount > totalMsgs * 0.2) score += 1;
  
  // Emoji usage
  const emojiCount = (msgTexts.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
  if (emojiCount > totalMsgs * 0.3) score += 1;
  
  // Cap at 10
  return Math.min(Math.max(score, 1), 10);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const { messages, style = 'roast', privacy = 'smart' } = req.body as AnalyzeRequestBody;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'No messages provided' });
      return;
    }

    const analysisStyle: AnalysisStyle = ['roast', 'personality', 'report'].includes(style) ? style : 'roast';
    const privacyMode: PrivacyMode = ['anonymous', 'with-names', 'smart'].includes(privacy) ? privacy : 'smart';
    const includeNames = privacyMode !== 'anonymous';

    // Limit messages
    const messagesToProcess = messages.slice(0, MAX_MESSAGES);
    const styleConfig = STYLE_PROMPTS[analysisStyle];
    const privacyNote = PRIVACY_INSTRUCTIONS[privacyMode];
    const messagesText = formatMessages(messagesToProcess, includeNames);

    const systemPrompt = `${styleConfig.system}

${privacyNote}

Responda em português brasileiro.`;

    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Analise este grupo de WhatsApp:\n\n${messagesText}` }
      ],
      max_tokens: styleConfig.maxTokens,
      temperature: 0.8, // Higher temperature for more creative responses
    });

    const analysis = completion.choices[0]?.message?.content || '';
    const vibeScore = calculateVibeScore(messagesToProcess);

    res.status(200).json({
      analysis,
      vibeScore,
      stats: {
        messagesAnalyzed: messagesToProcess.length,
        tokensUsed: completion.usage?.total_tokens || 0
      }
    });

  } catch (err) {
    console.error('Analyze error:', err);
    
    if (err instanceof Error && (err.message.includes('rate') || err.message.includes('429') || err.message.includes('413'))) {
      res.status(429).json({ error: 'Limite de tokens. Aguarde um momento.' });
      return;
    }

    res.status(500).json({ error: 'Falha ao analisar grupo' });
  }
}

