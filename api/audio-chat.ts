import type { VercelRequest, VercelResponse } from '@vercel/node';
import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const CHAT_MODEL = 'llama-3.1-8b-instant';
const MAX_RESPONSE_TOKENS = 1024;
const MAX_TRANSCRIPTION_CHARS = 100_000;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AudioChatRequestBody {
  transcription: string;
  messages: ChatMessage[];
}

function truncateTranscription(text: string): string {
  if (!text || text.length <= MAX_TRANSCRIPTION_CHARS) {
    return text || '';
  }
  const half = Math.floor(MAX_TRANSCRIPTION_CHARS / 2);
  const start = text.slice(0, half);
  const end = text.slice(-half);
  return `${start}\n\n[... transcrição truncada no meio ...]\n\n${end}`;
}

const SYSTEM_PROMPT_TEMPLATE = `Você é um assistente que responde perguntas sobre o conteúdo de um áudio transcrito.

O usuário fez perguntas sobre um áudio. Abaixo está a transcrição completa (ou uma parte dela):

---
TRANSCRIÇÃO DO ÁUDIO:
{transcription}
---

Instruções:
- Responda APENAS com base no conteúdo da transcrição acima.
- Se a pergunta não puder ser respondida com a transcrição, diga isso claramente.
- Use português brasileiro, a menos que o usuário peça em outro idioma.
- Seja conciso mas completo.
- Você pode: resumir trechos, explicar o que alguém quis dizer, sugerir respostas, traduzir, listar pontos principais, etc.`;

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
    const { transcription, messages } = req.body as AudioChatRequestBody;

    if (!transcription || typeof transcription !== 'string') {
      res.status(400).json({ error: 'Missing or invalid transcription' });
      return;
    }

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: 'Missing or invalid messages' });
      return;
    }

    const transcriptionText = truncateTranscription(transcription);
    const systemContent = SYSTEM_PROMPT_TEMPLATE.replace('{transcription}', transcriptionText);

    const maxHistory = 12;
    const recentMessages = messages.slice(-maxHistory);

    const apiMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemContent },
      ...recentMessages,
    ];

    const completion = await groq.chat.completions.create({
      model: CHAT_MODEL,
      messages: apiMessages,
      max_tokens: MAX_RESPONSE_TOKENS,
      temperature: 0.5,
    });

    const content = completion.choices[0]?.message?.content?.trim() || '';
    const tokensUsed = completion.usage?.total_tokens || 0;

    res.status(200).json({ content, tokensUsed });
  } catch (err: unknown) {
    console.error('Audio chat error:', err);
    const errorMessage = err instanceof Error ? err.message : String(err);

    if (
      errorMessage.includes('rate') ||
      errorMessage.includes('429') ||
      errorMessage.includes('Rate limit')
    ) {
      res.status(429).json({ error: errorMessage || 'Rate limit reached' });
      return;
    }

    res.status(500).json({ error: 'Failed to generate response', code: 'CHAT_ERROR' });
  }
}
