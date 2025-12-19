import type { WhatsAppMessage, DateInfo } from '../types/index.js';

/**
 * Extract date information from parsed messages
 * Optimized to get recent dates first
 */
export function extractDateInfo(
  messages: WhatsAppMessage[],
  dateIndex: Map<string, number[]>
): DateInfo[] {
  const dateInfos: DateInfo[] = [];

  for (const [date, indices] of dateIndex.entries()) {
    // Get unique senders for this date
    const senders = new Set<string>();
    let preview = '';

    for (const idx of indices) {
      const msg = messages[idx];
      if (msg.sender !== '__system__') {
        senders.add(msg.sender);
        if (!preview && !msg.isMedia) {
          preview = msg.content.substring(0, 50);
          if (msg.content.length > 50) preview += '...';
        }
      }
    }

    dateInfos.push({
      date,
      messageCount: indices.length,
      participants: senders.size,
      preview
    });
  }

  // Sort by date descending (most recent first)
  dateInfos.sort((a, b) => b.date.localeCompare(a.date));

  return dateInfos;
}

/**
 * Get only the most recent N days from date info
 */
export function getRecentDates(dateInfos: DateInfo[], count: number = 3): DateInfo[] {
  return dateInfos.slice(0, count);
}

/**
 * Get date statistics
 */
export function getDateStats(dateInfos: DateInfo[]): {
  totalDays: number;
  oldestDate: string;
  newestDate: string;
  totalMessages: number;
} {
  if (dateInfos.length === 0) {
    return {
      totalDays: 0,
      oldestDate: '',
      newestDate: '',
      totalMessages: 0
    };
  }

  const totalMessages = dateInfos.reduce((sum, d) => sum + d.messageCount, 0);
  
  // dateInfos is already sorted descending
  return {
    totalDays: dateInfos.length,
    oldestDate: dateInfos[dateInfos.length - 1].date,
    newestDate: dateInfos[0].date,
    totalMessages
  };
}

/**
 * Quick scan of file to extract just dates (for very large files)
 * This is faster than full parsing when you only need dates
 */
export function quickDateScan(fileContent: string): string[] {
  const dateRegex = /^(\d{2}\/\d{2}\/\d{4})/gm;
  const dates = new Set<string>();
  
  let match;
  while ((match = dateRegex.exec(fileContent)) !== null) {
    const [day, month, year] = match[1].split('/');
    dates.add(`${year}-${month}-${day}`);
  }

  return Array.from(dates).sort((a, b) => b.localeCompare(a));
}

/**
 * Scan file from the end to get recent dates quickly
 * Useful for very large files where we want to show recent dates first
 */
export function scanRecentDates(
  fileContent: string, 
  maxDays: number = 3
): string[] {
  const lines = fileContent.split('\n');
  const dates = new Set<string>();
  const dateRegex = /^(\d{2}\/\d{2}\/\d{4})/;

  // Scan from the end
  for (let i = lines.length - 1; i >= 0 && dates.size < maxDays; i--) {
    const match = lines[i].match(dateRegex);
    if (match) {
      const [day, month, year] = match[1].split('/');
      dates.add(`${year}-${month}-${day}`);
    }
  }

  return Array.from(dates).sort((a, b) => b.localeCompare(a));
}

