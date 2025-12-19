/**
 * Simple development server that mimics Vercel serverless functions
 * Run with: node dev-server.js
 */

import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import formidable from 'formidable';
import { readFile } from 'fs/promises';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3000;

// In-memory store for parsed chats
const STORE = new Map();
const CLEANUP_INTERVAL = 30 * 60 * 1000; // 30 minutes

// Serve static files
app.use(express.static(join(__dirname, 'public')));
app.use(express.json());

// ==============================================
// Parser functions (inline for dev server)
// ==============================================

const MESSAGE_REGEX = /^(\d{2}\/\d{2}\/\d{4}) (\d{2}:\d{2}) - ([^:]+): (.*)$/;

function convertDate(brDate) {
  const [day, month, year] = brDate.split('/');
  return `${year}-${month}-${day}`;
}

function isMediaMessage(content) {
  const mediaPatterns = ['<mídia oculta>', '<media omitted>', 'imagem ocultada'];
  const lowerContent = content.toLowerCase();
  return mediaPatterns.some(pattern => lowerContent.includes(pattern));
}

function parseWhatsAppChat(fileContent) {
  const lines = fileContent.split('\n');
  const messages = [];
  let currentMessage = null;

  for (const line of lines) {
    if (!line.trim() && !currentMessage) continue;

    const messageMatch = line.match(MESSAGE_REGEX);
    
    if (messageMatch) {
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
    } else if (currentMessage && line.trim()) {
      currentMessage.content += '\n' + line;
      currentMessage.rawLine += '\n' + line;
    }
  }

  if (currentMessage) {
    messages.push(currentMessage);
  }

  return messages;
}

function parseAndIndex(fileContent) {
  const messages = parseWhatsAppChat(fileContent);
  const dateIndex = new Map();

  messages.forEach((msg, index) => {
    const indices = dateIndex.get(msg.date) || [];
    indices.push(index);
    dateIndex.set(msg.date, indices);
  });

  return { messages, dateIndex };
}

function extractDateInfo(messages, dateIndex) {
  const dateInfos = [];

  for (const [date, indices] of dateIndex.entries()) {
    const senders = new Set();
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

  dateInfos.sort((a, b) => b.date.localeCompare(a.date));
  return dateInfos;
}

// ==============================================
// Groq integration
// ==============================================

async function generateSummaryWithGroq(messagesText, level, privacy) {
  const Groq = (await import('groq-sdk')).default;
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const levelConfigs = {
    1: { name: 'Flash', maxTokens: 100, prompt: 'Faça um resumo ULTRA-CURTO em apenas 1-2 frases.' },
    2: { name: 'Resumido', maxTokens: 300, prompt: 'Faça um resumo CURTO com parágrafos breves.' },
    3: { name: 'Padrão', maxTokens: 500, prompt: 'Faça um resumo DETALHADO cobrindo todos os assuntos.' },
    4: { name: 'Completo', maxTokens: 800, prompt: 'Faça um resumo COMPLETO incluindo quem disse o quê.' }
  };

  const privacyInstructions = {
    'anonymous': 'NÃO mencione nomes. Use termos como "o grupo discutiu".',
    'with-names': 'Mencione os nomes das pessoas quando relevante.',
    'smart': 'Mencione nomes APENAS para contribuições muito importantes.'
  };

  const config = levelConfigs[level] || levelConfigs[3];
  const privacyNote = privacyInstructions[privacy] || privacyInstructions['smart'];

  const systemPrompt = `Você é um assistente que resume conversas de grupo do WhatsApp.
${config.prompt}
${privacyNote}
Responda em português brasileiro.`;

  const completion = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Resuma esta conversa:\n\n${messagesText}` }
    ],
    max_tokens: config.maxTokens,
    temperature: 0.3,
  });

  return {
    summary: completion.choices[0]?.message?.content || '',
    tokensUsed: completion.usage?.total_tokens || 0
  };
}

// ==============================================
// API Routes
// ==============================================

// Upload endpoint
app.post('/api/upload', async (req, res) => {
  try {
    const form = formidable({ maxFileSize: 10 * 1024 * 1024 });
    const [, files] = await form.parse(req);
    
    const uploadedFile = files.file?.[0];
    if (!uploadedFile) {
      return res.status(400).json({ error: 'No file uploaded', code: 'NO_FILE' });
    }

    const fileContent = await readFile(uploadedFile.filepath, 'utf-8');
    
    if (!fileContent.trim()) {
      return res.status(400).json({ error: 'File is empty', code: 'EMPTY_FILE' });
    }

    const { messages, dateIndex } = parseAndIndex(fileContent);

    if (messages.length === 0) {
      return res.status(400).json({ error: 'No messages found', code: 'NO_MESSAGES' });
    }

    const allDates = extractDateInfo(messages, dateIndex);
    const recentDates = allDates.slice(0, 3);
    
    const id = Math.random().toString(36).substring(2, 15);
    STORE.set(id, { id, messages, dateIndex, dates: allDates, uploadedAt: Date.now() });

    // Cleanup old entries
    setTimeout(() => STORE.delete(id), CLEANUP_INTERVAL);

    res.json({
      id,
      recentDates,
      totalDays: allDates.length,
      oldestDate: allDates[allDates.length - 1]?.date || '',
      newestDate: allDates[0]?.date || '',
      totalMessages: messages.length
    });

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Failed to process file', code: 'PROCESSING_ERROR' });
  }
});

// Dates endpoint
app.get('/api/dates', (req, res) => {
  const { id, all } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Missing chat ID', code: 'MISSING_ID' });
  }

  const chat = STORE.get(id);
  
  if (!chat) {
    return res.status(404).json({ error: 'Chat not found', code: 'NOT_FOUND' });
  }

  const dates = all === 'true' ? chat.dates : chat.dates.slice(0, 3);
  res.json({ dates });
});

// Summarize endpoint
app.post('/api/summarize', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { id, date, level = 3, privacy = 'smart' } = req.body;

    if (!id || !date) {
      return res.status(400).json({ error: 'Missing fields', code: 'MISSING_FIELDS' });
    }

    const chat = STORE.get(id);
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found', code: 'NOT_FOUND' });
    }

    const indices = chat.dateIndex.get(date);
    if (!indices || indices.length === 0) {
      return res.status(404).json({ error: 'No messages for date', code: 'NO_MESSAGES' });
    }

    const messages = indices.map(i => chat.messages[i]);
    const participants = new Set(messages.map(m => m.sender).filter(s => s !== '__system__'));
    
    const includeNames = privacy !== 'anonymous';
    const messagesText = messages
      .filter(msg => msg.sender !== '__system__')
      .map(msg => {
        if (msg.isMedia) {
          return includeNames ? `[${msg.time}] ${msg.sender}: [mídia]` : `[${msg.time}] [mídia]`;
        }
        return includeNames ? `[${msg.time}] ${msg.sender}: ${msg.content}` : `[${msg.time}] ${msg.content}`;
      })
      .join('\n');

    const result = await generateSummaryWithGroq(messagesText, level, privacy);

    res.json({
      summary: result.summary,
      stats: {
        totalMessages: messages.length,
        participants: participants.size,
        tokensUsed: result.tokensUsed,
        chunks: 1,
        processingTime: Date.now() - startTime
      }
    });

  } catch (err) {
    console.error('Summarize error:', err);
    
    if (err.message?.includes('rate')) {
      return res.status(429).json({ error: 'Rate limited', code: 'RATE_LIMITED' });
    }
    
    res.status(500).json({ error: 'Failed to generate summary', code: 'SUMMARIZE_ERROR' });
  }
});

// Share target handler
app.get('/share', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'share.html'));
});

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// Start server
const server = createServer(app);
server.listen(PORT, () => {
  console.log(`
🚀 Development server running!

   Local:   http://localhost:${PORT}

   Upload a WhatsApp export file to get started.
  `);
});

