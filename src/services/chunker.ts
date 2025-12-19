import type { WhatsAppMessage } from '../types/index.js';

/**
 * Estimate token count for a string
 * Rough approximation: ~4 characters per token for Portuguese
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Maximum tokens per chunk
 * Groq Llama 3.1 8B has 32k context, we use 8k per chunk to be safe
 */
const MAX_TOKENS_PER_CHUNK = 8000;

/**
 * Chunk messages into groups that fit within token limits
 * Tries to keep temporal coherence (doesn't split mid-conversation)
 */
export function chunkMessages(
  messages: WhatsAppMessage[],
  maxTokens: number = MAX_TOKENS_PER_CHUNK
): WhatsAppMessage[][] {
  if (messages.length === 0) return [];

  const chunks: WhatsAppMessage[][] = [];
  let currentChunk: WhatsAppMessage[] = [];
  let currentTokens = 0;

  for (const msg of messages) {
    // Estimate tokens for this message
    const msgText = `[${msg.time}] ${msg.sender}: ${msg.content}`;
    const msgTokens = estimateTokens(msgText);

    // If adding this message would exceed limit, start new chunk
    if (currentTokens + msgTokens > maxTokens && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentTokens = 0;
    }

    currentChunk.push(msg);
    currentTokens += msgTokens;
  }

  // Don't forget the last chunk
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Format a chunk for the AI with metadata
 */
export function formatChunkForAI(
  chunk: WhatsAppMessage[],
  chunkIndex: number,
  totalChunks: number,
  includeNames: boolean
): string {
  const header = totalChunks > 1 
    ? `[Parte ${chunkIndex + 1} de ${totalChunks}]\n\n`
    : '';

  const messages = chunk
    .filter(msg => msg.sender !== '__system__')
    .map(msg => {
      if (msg.isMedia) {
        return includeNames 
          ? `[${msg.time}] ${msg.sender}: [mídia compartilhada]`
          : `[${msg.time}] [mídia compartilhada]`;
      }
      return includeNames
        ? `[${msg.time}] ${msg.sender}: ${msg.content}`
        : `[${msg.time}] ${msg.content}`;
    })
    .join('\n');

  return header + messages;
}

/**
 * Check if messages need chunking
 */
export function needsChunking(messages: WhatsAppMessage[]): boolean {
  let totalTokens = 0;
  for (const msg of messages) {
    const msgText = `[${msg.time}] ${msg.sender}: ${msg.content}`;
    totalTokens += estimateTokens(msgText);
    if (totalTokens > MAX_TOKENS_PER_CHUNK) {
      return true;
    }
  }
  return false;
}

/**
 * Get statistics about chunks
 */
export function getChunkStats(chunks: WhatsAppMessage[][]): {
  totalChunks: number;
  totalMessages: number;
  estimatedTokens: number;
} {
  let totalMessages = 0;
  let estimatedTokens = 0;

  for (const chunk of chunks) {
    totalMessages += chunk.length;
    for (const msg of chunk) {
      const msgText = `[${msg.time}] ${msg.sender}: ${msg.content}`;
      estimatedTokens += estimateTokens(msgText);
    }
  }

  return {
    totalChunks: chunks.length,
    totalMessages,
    estimatedTokens
  };
}

