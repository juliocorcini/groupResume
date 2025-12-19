import type { VercelRequest, VercelResponse } from '@vercel/node';
import Groq from 'groq-sdk';
import type { SummaryLevel, PrivacyMode } from '../src/types/index.js';

interface MergeRequestBody {
  summaries: string[];
  level: SummaryLevel;
  privacy: PrivacyMode;
}

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Use FAST model for merge to avoid timeout
const MODEL = 'llama-3.1-8b-instant';

// Max chars to send (reduced to stay well under 10s timeout)
const MAX_INPUT_CHARS = 4000;

const LEVEL_CONFIGS: Record<SummaryLevel, { maxTokens: number; prompt: string }> = {
  1: { maxTokens: 150, prompt: 'Crie um resumo ULTRA-CURTO em 2-3 frases.' },
  2: { maxTokens: 300, prompt: 'Crie um resumo CURTO com parágrafos breves.' },
  3: { maxTokens: 500, prompt: 'Crie um resumo DETALHADO.' },
  4: { maxTokens: 700, prompt: 'Crie um resumo COMPLETO.' }
};

const PRIVACY_INSTRUCTIONS: Record<PrivacyMode, string> = {
  'anonymous': 'NÃO mencione nomes.',
  'with-names': 'Mencione nomes quando relevante.',
  'smart': 'Mencione nomes apenas quando importante.'
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

    // Truncate summaries if too long
    let combined = '';
    for (let i = 0; i < summaries.length; i++) {
      const part = `Parte ${i + 1}: ${summaries[i]}\n\n`;
      if (combined.length + part.length > MAX_INPUT_CHARS) {
        // Truncate this part to fit
        const remaining = MAX_INPUT_CHARS - combined.length - 50;
        if (remaining > 100) {
          combined += `Parte ${i + 1}: ${summaries[i].slice(0, remaining)}...\n\n`;
        }
        break;
      }
      combined += part;
    }

    const systemPrompt = `Você consolida resumos em português brasileiro.
${config.prompt}
${privacyNote}
Combine em um resumo único e coeso. Use markdown.`;

    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Combine estes resumos:\n\n${combined}` }
      ],
      max_tokens: config.maxTokens,
      temperature: 0.3,
    });

    res.status(200).json({
      summary: completion.choices[0]?.message?.content || '',
      stats: { tokensUsed: completion.usage?.total_tokens || 0 }
    });

  } catch (err: any) {
    console.error('Merge error:', err);
    
    // Pass through full error message for rate limit (frontend needs wait time)
    const errorMessage = err?.message || err?.toString() || '';
    const isRateLimit = errorMessage.includes('rate') || 
                        errorMessage.includes('429') || 
                        errorMessage.includes('Rate limit') ||
                        err?.status === 429;
    
    if (isRateLimit) {
      res.status(429).json({ error: errorMessage || 'Rate limit reached' });
      return;
    }
    
    res.status(500).json({ error: 'Falha ao combinar' });
  }
}
