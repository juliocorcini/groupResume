/**
 * Represents a single WhatsApp message
 */
export interface WhatsAppMessage {
  date: string;        // Format: YYYY-MM-DD
  time: string;        // Format: HH:MM
  sender: string;      // Contact name or phone number
  content: string;     // Message content
  isMedia: boolean;    // True if message is "<Mídia oculta>"
  rawLine: string;     // Original line from file
}

/**
 * Information about messages for a specific date
 */
export interface DateInfo {
  date: string;          // Format: YYYY-MM-DD
  messageCount: number;
  participants: number;
  preview: string;       // First message preview
}

/**
 * Parsed file stored temporarily in memory
 */
export interface ParsedChat {
  id: string;
  messages: WhatsAppMessage[];
  dateIndex: Map<string, number[]>; // date -> array of message indices
  dates: DateInfo[];
  uploadedAt: number;    // Timestamp for cleanup
}

/**
 * Upload API response
 */
export interface UploadResponse {
  id: string;
  recentDates: DateInfo[];
  totalDays: number;
  oldestDate: string;
  newestDate: string;
  totalMessages: number;
}

/**
 * Dates API response
 */
export interface DatesResponse {
  dates: DateInfo[];
}

/**
 * Summary request body
 */
export interface SummarizeRequest {
  id: string;
  date: string;
  level: SummaryLevel;
  privacy: PrivacyMode;
}

/**
 * Summary levels
 * 1 = Flash (1-2 sentences)
 * 2 = Resumido (short paragraphs)
 * 3 = Padrão (with context)
 * 4 = Completo (who said what)
 */
export type SummaryLevel = 1 | 2 | 3 | 4;

/**
 * Privacy modes for summary
 */
export type PrivacyMode = 'anonymous' | 'with-names' | 'smart';

/**
 * Summary API response
 */
export interface SummarizeResponse {
  summary: string;
  stats: {
    totalMessages: number;
    participants: number;
    tokensUsed: number;
    chunks: number;
    processingTime: number;
  };
}

/**
 * Summary level configuration
 */
export interface SummaryLevelConfig {
  name: string;
  description: string;
  maxTokens: number;
  systemPrompt: string;
}

/**
 * Error response
 */
export interface ErrorResponse {
  error: string;
  code: string;
}

