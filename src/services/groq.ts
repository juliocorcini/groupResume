import Groq from 'groq-sdk';
import type { SummaryLevel, PrivacyMode, SummaryLevelConfig } from '../types/index.js';

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// Model to use - Llama 3.1 8B is fast and free
const MODEL = 'llama-3.1-8b-instant';

/**
 * Summary level configurations with Portuguese prompts
 */
const SUMMARY_CONFIGS: Record<SummaryLevel, SummaryLevelConfig> = {
  1: {
    name: 'Flash',
    description: 'Resumo ultra-curto em 1-2 frases',
    maxTokens: 100,
    systemPrompt: `Você é um assistente que resume conversas de grupo do WhatsApp.
Faça um resumo ULTRA-CURTO em apenas 1-2 frases.
Mencione apenas os 2-3 tópicos principais discutidos.
Seja direto e conciso. Não use listas ou formatação especial.`
  },
  2: {
    name: 'Resumido',
    description: 'Parágrafos curtos por assunto',
    maxTokens: 300,
    systemPrompt: `Você é um assistente que resume conversas de grupo do WhatsApp.
Faça um resumo CURTO com parágrafos breves para cada assunto principal.
Agrupe os tópicos relacionados.
Use linguagem natural e fluida. Máximo 3-4 parágrafos curtos.`
  },
  3: {
    name: 'Padrão',
    description: 'Resumo completo com contexto',
    maxTokens: 500,
    systemPrompt: `Você é um assistente que resume conversas de grupo do WhatsApp.
Faça um resumo DETALHADO cobrindo todos os assuntos importantes.
Inclua contexto relevante para cada discussão.
Organize por tópicos quando apropriado.
Use formatação markdown com ## para títulos de seção se necessário.`
  },
  4: {
    name: 'Completo',
    description: 'Resumo detalhado com participantes',
    maxTokens: 800,
    systemPrompt: `Você é um assistente que resume conversas de grupo do WhatsApp.
Faça um resumo COMPLETO e DETALHADO de toda a conversa.
Inclua quem disse o quê quando for relevante.
Destaque decisões tomadas, eventos importantes, e discussões significativas.
Use formatação markdown com ## para seções e ** para destaques.
Mencione os participantes mais ativos e suas contribuições principais.`
  }
};

/**
 * Privacy mode instructions
 */
const PRIVACY_INSTRUCTIONS: Record<PrivacyMode, string> = {
  'anonymous': `
IMPORTANTE: NÃO mencione nomes de pessoas ou números de telefone no resumo.
Foque apenas nos ASSUNTOS discutidos, não em quem falou.
Use termos genéricos como "o grupo discutiu", "foi mencionado", "alguém perguntou".`,
  
  'with-names': `
Você pode mencionar os nomes das pessoas quando relevante para o contexto.
Inclua quem disse ou fez o quê quando for importante para o entendimento.`,
  
  'smart': `
Mencione nomes APENAS quando a pessoa fez uma contribuição muito importante ou tomou uma decisão.
Para conversas casuais, não mencione nomes.
Evite mencionar números de telefone diretamente - se necessário, diga apenas "um participante".`
};

/**
 * Generate a summary for a chunk of messages
 */
export async function generateSummary(
  messagesText: string,
  level: SummaryLevel,
  privacy: PrivacyMode,
  isPartialChunk: boolean = false
): Promise<{ summary: string; tokensUsed: number }> {
  const config = SUMMARY_CONFIGS[level];
  const privacyInstruction = PRIVACY_INSTRUCTIONS[privacy];

  const systemPrompt = config.systemPrompt + '\n' + privacyInstruction;
  
  const userPrompt = isPartialChunk
    ? `Resuma esta PARTE da conversa do grupo:\n\n${messagesText}`
    : `Resuma esta conversa do grupo:\n\n${messagesText}`;

  const completion = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    max_tokens: config.maxTokens,
    temperature: 0.3, // Lower temperature for more consistent summaries
  });

  const summary = completion.choices[0]?.message?.content || '';
  const tokensUsed = completion.usage?.total_tokens || 0;

  return { summary, tokensUsed };
}

/**
 * Merge multiple chunk summaries into a final summary
 */
export async function mergeSummaries(
  partialSummaries: string[],
  level: SummaryLevel,
  privacy: PrivacyMode
): Promise<{ summary: string; tokensUsed: number }> {
  const config = SUMMARY_CONFIGS[level];
  const privacyInstruction = PRIVACY_INSTRUCTIONS[privacy];

  const systemPrompt = `Você é um assistente que consolida resumos parciais em um resumo final.
${config.systemPrompt}
${privacyInstruction}

Você receberá vários resumos parciais de diferentes partes de uma conversa.
Combine-os em um único resumo coeso, removendo redundâncias e organizando por temas.`;

  const userPrompt = `Combine estes resumos parciais em um resumo final:\n\n${partialSummaries.map((s, i) => `--- Parte ${i + 1} ---\n${s}`).join('\n\n')}`;

  const completion = await groq.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    max_tokens: config.maxTokens * 1.5, // Allow more tokens for merged summary
    temperature: 0.3,
  });

  const summary = completion.choices[0]?.message?.content || '';
  const tokensUsed = completion.usage?.total_tokens || 0;

  return { summary, tokensUsed };
}

/**
 * Get summary level configuration
 */
export function getSummaryConfig(level: SummaryLevel): SummaryLevelConfig {
  return SUMMARY_CONFIGS[level];
}

/**
 * Get all summary level options (for UI)
 */
export function getSummaryOptions(): Array<{ level: SummaryLevel; name: string; description: string }> {
  return [
    { level: 1, ...SUMMARY_CONFIGS[1] },
    { level: 2, ...SUMMARY_CONFIGS[2] },
    { level: 3, ...SUMMARY_CONFIGS[3] },
    { level: 4, ...SUMMARY_CONFIGS[4] }
  ];
}

