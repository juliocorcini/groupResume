import type { ParsedChat } from '../types/index.js';

/**
 * In-memory store for parsed chats
 * Chats are automatically cleaned up after 30 minutes
 */

const STORE = new Map<string, ParsedChat>();
const CLEANUP_INTERVAL = 30 * 60 * 1000; // 30 minutes

/**
 * Generate a random ID for the chat
 */
export function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
}

/**
 * Store a parsed chat
 */
export function storeChat(chat: ParsedChat): void {
  STORE.set(chat.id, chat);
}

/**
 * Get a parsed chat by ID
 */
export function getChat(id: string): ParsedChat | undefined {
  return STORE.get(id);
}

/**
 * Delete a chat
 */
export function deleteChat(id: string): boolean {
  return STORE.delete(id);
}

/**
 * Check if a chat exists
 */
export function hasChat(id: string): boolean {
  return STORE.has(id);
}

/**
 * Clean up old chats (called periodically)
 */
export function cleanupOldChats(): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [id, chat] of STORE.entries()) {
    if (now - chat.uploadedAt > CLEANUP_INTERVAL) {
      STORE.delete(id);
      cleaned++;
    }
  }

  return cleaned;
}

/**
 * Get store statistics
 */
export function getStoreStats(): { count: number; oldestAge: number | null } {
  if (STORE.size === 0) {
    return { count: 0, oldestAge: null };
  }

  const now = Date.now();
  let oldestAge = 0;

  for (const chat of STORE.values()) {
    const age = now - chat.uploadedAt;
    if (age > oldestAge) {
      oldestAge = age;
    }
  }

  return {
    count: STORE.size,
    oldestAge
  };
}

// Note: In serverless environment (Vercel), each function invocation
// may have a fresh store. This is fine for our use case since:
// 1. Users typically upload, select date, and summarize within minutes
// 2. If the store is empty, user just uploads again
// 3. For production, could use Redis or similar for persistence

