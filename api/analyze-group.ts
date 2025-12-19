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

// Using the best model for analysis
const MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const MAX_MESSAGES = 250;

const PRIVACY_INSTRUCTIONS: Record<PrivacyMode, string> = {
  'anonymous': 'NÃO mencione nomes de pessoas. Use termos como "os participantes", "alguém", etc.',
  'with-names': 'Mencione os nomes das pessoas naturalmente.',
  'smart': 'Mencione nomes apenas quando for relevante para a análise.'
};

const STYLE_PROMPTS: Record<AnalysisStyle, { system: string; maxTokens: number }> = {
  roast: {
    system: `Você é um comediante brasileiro fazendo um "roast" amigável de um grupo de WhatsApp.
Analise as mensagens e crie uma análise ENGRAÇADA e IRÔNICA sobre o grupo.

Sua análise deve incluir:
1. Um título criativo e engraçado para o grupo
2. Uma descrição irônica do que o grupo representa
3. Os "tipos" de pessoas no grupo (o que sempre manda áudio, o sumido, etc)
4. Os assuntos mais bizarros/engraçados que aparecem
5. Uma "previsão" cômica do futuro do grupo

Use humor brasileiro, gírias, e seja criativo! Não seja ofensivo, apenas engraçado.
Use markdown para formatar. Seja MUITO engraçado!`,
    maxTokens: 800
  },
  
  personality: {
    system: `Você é um psicólogo/astrólogo analisando a "personalidade" de um grupo de WhatsApp como se fosse uma pessoa.
Analise as mensagens e descreva o grupo como se fosse um ser humano com personalidade própria.

Sua análise deve incluir:
1. Nome e "signo" do grupo (invente um signo criativo)
2. Traços de personalidade dominantes
3. Como o "grupo-pessoa" se comporta em diferentes situações
4. Pontos fortes e "áreas de crescimento"
5. O que deixa o grupo feliz/irritado
6. Compatibilidade com outros tipos de grupos
7. Uma frase que define o grupo

Seja criativo e use analogias interessantes! Use markdown para formatar.`,
    maxTokens: 800
  },
  
  report: {
    system: `Você é um analista de dados com senso de humor criando um "relatório anual" de um grupo de WhatsApp.
Analise as mensagens e crie um relatório divertido com estatísticas (inventadas com base no conteúdo).

Sua análise deve incluir:
1. "Estatísticas" engraçadas (ex: "127 vezes alguém mandou 'kkk'")
2. Prêmios irônicos para os participantes
3. Os "maiores hits" de conversas do grupo
4. Palavras/emojis que definem o grupo
5. Momentos marcantes (baseado nas conversas)
6. "Tendências" observadas
7. Previsões para o próximo ano

Use formato de relatório com seções, mas seja ENGRAÇADO! Use markdown.`,
    maxTokens: 800
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

