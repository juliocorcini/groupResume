import type { VercelRequest, VercelResponse } from '@vercel/node';
import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const SUMMARY_MODEL = 'llama-3.1-8b-instant';

type AudioSummaryLevel = 'flash' | 'topicos' | 'detalhado' | 'limpa';

interface SummarizeAudioRequestBody {
  transcription: string;
  level?: AudioSummaryLevel;
}

const LEVEL_CONFIGS: Record<AudioSummaryLevel, { maxTokens: number; systemPrompt: string }> = {
  flash: {
    maxTokens: 200,
    systemPrompt: `Você é um assistente que resume áudios transcritos em português brasileiro.

MODO FLASH: Produza um resumo ULTRA-CURTO em apenas 2-3 tópicos em formato de bullet points.
- Cada bullet = um assunto principal mencionado no áudio
- Máximo 2-3 bullets, cada um com 1 frase
- Ideal para áudios curtos (30s-1min) — o leitor quer só a essência
- Use markdown com "- " para os bullets
- Seja direto e objetivo`,
  },
  topicos: {
    maxTokens: 600,
    systemPrompt: `Você é um assistente que resume áudios transcritos em português brasileiro.

MODO TÓPICOS: Organize o resumo por assunto/tema. Este é o modo PADRÃO e mais útil.
- Identifique TODOS os assuntos discutidos no áudio (geralmente 4-8 tópicos para um áudio de 2-5 min)
- Para cada tópico: 1 bullet com título + 1-2 frases explicando o que foi dito
- NÃO perca assuntos importantes — um áudio de 5 min deve ter vários tópicos
- Use markdown: ## para títulos de seção, - para bullets
- Seja completo mas conciso — capture cada assunto sem repetir
- Exemplo de estrutura:
  ## Assunto 1
  - Explicação breve do que foi dito
  ## Assunto 2
  - Explicação breve`,
  },
  detalhado: {
    maxTokens: 1200,
    systemPrompt: `Você é um assistente que resume áudios transcritos em português brasileiro.

MODO DETALHADO: Produza um resumo COMPLETO preservando o máximo de informação possível.
- Organize por tópicos/assuntos
- Para cada tópico: explique com contexto, nuances e detalhes relevantes
- Quando apropriado, cite frases-chave entre aspas para preservar o que foi dito
- Inclua informações importantes que um resumo curto perderia
- Use markdown: ## para seções, - para bullets, "aspas" para citações
- Ideal para áudios longos (5+ min) onde o usuário quer entender tudo sem ouvir
- Mantenha a ordem lógica do áudio quando fizer sentido`,
  },
  limpa: {
    maxTokens: 4000,
    systemPrompt: `Você é um assistente que transforma transcrições de áudio em texto limpo e legível.

MODO TRANSCRIÇÃO LIMPA: NÃO faça um resumo. Transforme a transcrição em texto bem formatado.
- Remova palavras de preenchimento: "né", "tipo", "aí", "então", "daí", "olha", "cara", "bom", etc.
- Corrija erros de gramática e concordância
- Adicione pontuação adequada (vírgulas, pontos, dois-pontos)
- Organize em parágrafos quando houver mudança de assunto
- Mantenha TODO o conteúdo — não resuma, não omita informações
- O resultado deve ser um texto que alguém possa ler como se fosse escrito, não falado
- Preserve a ordem e o sentido original
- Use parágrafos separados por linha em branco para clareza`,
  },
};

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
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { transcription, level = 'topicos' } = req.body as SummarizeAudioRequestBody;

    if (!transcription || typeof transcription !== 'string') {
      res.status(400).json({ error: 'Missing or invalid transcription' });
      return;
    }

    const validLevels: AudioSummaryLevel[] = ['flash', 'topicos', 'detalhado', 'limpa'];
    const summaryLevel: AudioSummaryLevel = validLevels.includes(level as AudioSummaryLevel)
      ? (level as AudioSummaryLevel)
      : 'topicos';

    const config = LEVEL_CONFIGS[summaryLevel];

    const userMessage = summaryLevel === 'limpa'
      ? `Transforme esta transcrição em texto limpo e legível:\n\n${transcription}`
      : `Resuma este áudio transcrito:\n\n${transcription}`;

    const completion = await groq.chat.completions.create({
      model: SUMMARY_MODEL,
      messages: [
        { role: 'system', content: config.systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: config.maxTokens,
      temperature: 0.3,
    });

    const summary = completion.choices[0]?.message?.content?.trim() || '';

    res.status(200).json({ summary });
  } catch (err: unknown) {
    console.error('Summarize audio error:', err);
    const errorMessage = err instanceof Error ? err.message : String(err);

    if (
      errorMessage.includes('rate') ||
      errorMessage.includes('429') ||
      errorMessage.includes('Rate limit')
    ) {
      res.status(429).json({ error: errorMessage || 'Rate limit reached' });
      return;
    }

    res.status(500).json({ error: 'Failed to generate summary', code: 'SUMMARIZE_ERROR' });
  }
}
