import type { VercelRequest, VercelResponse } from '@vercel/node';
import Groq from 'groq-sdk';
import type { SummaryLevel, PrivacyMode } from '../src/types/index.js';

interface MergeRequestBody {
  summaries: string[];
  level: SummaryLevel;
  privacy: PrivacyMode;
}

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = 'llama-3.3-70b-versatile'; // Best performance from tests

const LEVEL_CONFIGS: Record<SummaryLevel, { maxTokens: number; prompt: string }> = {
  1: { maxTokens: 200, prompt: 'Crie um resumo ULTRA-CURTO em 2-3 frases.' },
  2: { maxTokens: 500, prompt: 'Crie um resumo CURTO com parágrafos breves.' },
  3: { maxTokens: 800, prompt: 'Crie um resumo DETALHADO cobrindo todos os assuntos.' },
  4: { maxTokens: 1200, prompt: 'Crie um resumo COMPLETO com todos os detalhes.' }
};

const PRIVACY_INSTRUCTIONS: Record<PrivacyMode, string> = {
  'anonymous': 'NÃO mencione nomes. Use termos genéricos.',
  'with-names': 'Mencione nomes quando relevante.',
  'smart': 'Mencione nomes apenas para contribuições importantes.'
};

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  try {
    const { summaries, level = 3, privacy = 'smart' } = req.body as MergeRequestBody;

    if (!summaries || !Array.isArray(summaries) || summaries.length === 0) {
      res.status(400).json({ error: 'No summaries provided' });
      return;
    }

    const config = LEVEL_CONFIGS[level as SummaryLevel] || LEVEL_CONFIGS[3];
    const privacyNote = PRIVACY_INSTRUCTIONS[privacy as PrivacyMode] || PRIVACY_INSTRUCTIONS['smart'];

    const systemPrompt = `Você é um assistente que consolida múltiplos resumos de conversa em português brasileiro.
${config.prompt}
${privacyNote}
Combine os resumos parciais em um único resumo coeso, removendo redundâncias.
Organize por temas/assuntos. Use markdown para formatação.`;

    const combined = summaries.map((s, i) => `### Parte ${i + 1}\n${s}`).join('\n\n');

    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Combine estes ${summaries.length} resumos parciais em um resumo final unificado:\n\n${combined}` }
      ],
      max_tokens: config.maxTokens,
      temperature: 0.3,
    });

    res.status(200).json({
      summary: completion.choices[0]?.message?.content || '',
      stats: { tokensUsed: completion.usage?.total_tokens || 0 }
    });

  } catch (err) {
    console.error('Merge error:', err);
    if (err instanceof Error && err.message.includes('rate')) {
      res.status(429).json({ error: 'Limite de tokens excedido. Aguarde um momento.' });
      return;
    }
    res.status(500).json({ error: 'Falha ao combinar resumos' });
  }
}

