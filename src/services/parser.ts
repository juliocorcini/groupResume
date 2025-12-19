import type { WhatsAppMessage } from '../types/index.js';

/**
 * Regex to match WhatsApp message format:
 * DD/MM/YYYY HH:MM - Sender: Message
 * 
 * Groups:
 * 1: Date (DD/MM/YYYY)
 * 2: Time (HH:MM)
 * 3: Sender name
 * 4: Message content (first line)
 */
const MESSAGE_REGEX = /^(\d{2}\/\d{2}\/\d{4}) (\d{2}:\d{2}) - ([^:]+): (.*)$/;

/**
 * System message regex (no sender, like "fulano entrou no grupo")
 */
const SYSTEM_MESSAGE_REGEX = /^(\d{2}\/\d{2}\/\d{4}) (\d{2}:\d{2}) - (.+)$/;

/**
 * Convert DD/MM/YYYY to YYYY-MM-DD format
 */
function convertDate(brDate: string): string {
  const [day, month, year] = brDate.split('/');
  return `${year}-${month}-${day}`;
}

/**
 * Check if content is a media placeholder
 */
function isMediaMessage(content: string): boolean {
  const mediaPatterns = [
    '<mídia oculta>',
    '<media omitted>',
    'imagem ocultada',
    'vídeo ocultado',
    'áudio ocultado',
    'figurinha omitida',
    'sticker omitted'
  ];
  const lowerContent = content.toLowerCase();
  return mediaPatterns.some(pattern => lowerContent.includes(pattern));
}

/**
 * Parse WhatsApp chat export file content
 * 
 * Handles:
 * - Multi-line messages
 * - System messages
 * - Media placeholders
 * - Different date formats
 */
export function parseWhatsAppChat(fileContent: string): WhatsAppMessage[] {
  const lines = fileContent.split('\n');
  const messages: WhatsAppMessage[] = [];
  let currentMessage: WhatsAppMessage | null = null;

  for (const line of lines) {
    // Skip empty lines at the start
    if (!line.trim() && !currentMessage) continue;

    // Try to match a new message
    const messageMatch = line.match(MESSAGE_REGEX);
    
    if (messageMatch) {
      // Save previous message if exists
      if (currentMessage) {
        messages.push(currentMessage);
      }

      const [, brDate, time, sender, content] = messageMatch;
      currentMessage = {
        date: convertDate(brDate),
        time,
        sender: sender.trim(),
        content: content,
        isMedia: isMediaMessage(content),
        rawLine: line
      };
    } else {
      // Check for system message (no sender)
      const systemMatch = line.match(SYSTEM_MESSAGE_REGEX);
      
      if (systemMatch && !currentMessage) {
        // System message like "Messages and calls are end-to-end encrypted"
        const [, brDate, time, content] = systemMatch;
        currentMessage = {
          date: convertDate(brDate),
          time,
          sender: '__system__',
          content: content,
          isMedia: false,
          rawLine: line
        };
      } else if (currentMessage && line.trim()) {
        // Multi-line message continuation
        currentMessage.content += '\n' + line;
        currentMessage.rawLine += '\n' + line;
      }
    }
  }

  // Don't forget the last message
  if (currentMessage) {
    messages.push(currentMessage);
  }

  return messages;
}

/**
 * Parse file content and build a date index for quick lookups
 * Returns messages sorted by date/time and an index mapping dates to message indices
 */
export function parseAndIndex(fileContent: string): {
  messages: WhatsAppMessage[];
  dateIndex: Map<string, number[]>;
} {
  const messages = parseWhatsAppChat(fileContent);
  const dateIndex = new Map<string, number[]>();

  // Build date index
  messages.forEach((msg, index) => {
    const indices = dateIndex.get(msg.date) || [];
    indices.push(index);
    dateIndex.set(msg.date, indices);
  });

  return { messages, dateIndex };
}

/**
 * Get messages for a specific date
 */
export function getMessagesForDate(
  messages: WhatsAppMessage[],
  dateIndex: Map<string, number[]>,
  date: string
): WhatsAppMessage[] {
  const indices = dateIndex.get(date);
  if (!indices) return [];
  return indices.map(i => messages[i]);
}

/**
 * Format messages for AI summarization
 */
export function formatMessagesForAI(
  messages: WhatsAppMessage[],
  includeNames: boolean = true
): string {
  return messages
    .filter(msg => msg.sender !== '__system__') // Exclude system messages
    .map(msg => {
      if (msg.isMedia) {
        return includeNames 
          ? `[${msg.time}] ${msg.sender}: [mídia]`
          : `[${msg.time}] [mídia]`;
      }
      return includeNames
        ? `[${msg.time}] ${msg.sender}: ${msg.content}`
        : `[${msg.time}] ${msg.content}`;
    })
    .join('\n');
}

