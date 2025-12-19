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
import Groq from 'groq-sdk';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3000;

// Initialize Groq
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Serve static files
app.use(express.static(join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));

// ==============================================
// Parser functions
// ==============================================

const MESSAGE_REGEX = /^(\d{2}\/\d{2}\/\d{4}) (\d{2}:\d{2}) - ([^:]+): (.*)$/;

function convertDate(brDate) {
  const [day, month, year] = brDate.split('/');
  return `${year}-${month}-${day}`;
}

function isMediaMessage(content) {
  const mediaPatterns = ['<mídia oculta>', '<media omitted>', 'imagem ocultada'];
  return mediaPatterns.some(pattern => content.toLowerCase().includes(pattern));
}

// ==============================================
// API Routes
// ==============================================

// Upload endpoint - returns all data to client
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

    // Parse messages
    const lines = fileContent.split('\n');
    const messagesByDate = {};
    let currentMessage = null;

    for (const line of lines) {
      if (!line.trim() && !currentMessage) continue;

      const messageMatch = line.match(MESSAGE_REGEX);
      
      if (messageMatch) {
        if (currentMessage) {
          if (!messagesByDate[currentMessage.date]) {
            messagesByDate[currentMessage.date] = [];
          }
          messagesByDate[currentMessage.date].push(currentMessage);
        }

        const [, brDate, time, sender, content] = messageMatch;
        currentMessage = {
          date: convertDate(brDate),
          time,
          sender: sender.trim(),
          content: content,
          isMedia: isMediaMessage(content)
        };
      } else if (currentMessage && line.trim()) {
        currentMessage.content += '\n' + line;
      }
    }

    if (currentMessage) {
      if (!messagesByDate[currentMessage.date]) {
        messagesByDate[currentMessage.date] = [];
      }
      messagesByDate[currentMessage.date].push(currentMessage);
    }

    const totalMessages = Object.values(messagesByDate).reduce((sum, msgs) => sum + msgs.length, 0);
    
    if (totalMessages === 0) {
      return res.status(400).json({ error: 'No messages found', code: 'NO_MESSAGES' });
    }

    // Build date info
    const dates = Object.entries(messagesByDate)
      .map(([date, messages]) => {
        const participants = new Set(messages.map(m => m.sender).filter(s => s !== '__system__'));
        const firstMsg = messages.find(m => !m.isMedia && m.sender !== '__system__');
        const preview = firstMsg ? firstMsg.content.substring(0, 50) + (firstMsg.content.length > 50 ? '...' : '') : '';
        
        return { date, messageCount: messages.length, participants: participants.size, preview };
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    res.json({
      messagesByDate,
      dates,
      totalMessages,
      totalDays: dates.length,
      oldestDate: dates[dates.length - 1]?.date || '',
      newestDate: dates[0]?.date || ''
    });

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Failed to process file', code: 'PROCESSING_ERROR' });
  }
});

// Summarize endpoint - receives messages directly
app.post('/api/summarize', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { messages, level = 3, privacy = 'smart', date } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'No messages provided', code: 'NO_MESSAGES' });
    }

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

    const levelConfigs = {
      1: { maxTokens: 100, prompt: 'Faça um resumo ULTRA-CURTO em apenas 1-2 frases.' },
      2: { maxTokens: 300, prompt: 'Faça um resumo CURTO com parágrafos breves.' },
      3: { maxTokens: 500, prompt: 'Faça um resumo DETALHADO cobrindo todos os assuntos.' },
      4: { maxTokens: 800, prompt: 'Faça um resumo COMPLETO incluindo quem disse o quê.' }
    };

    const privacyInstructions = {
      'anonymous': 'NÃO mencione nomes. Use termos como "o grupo discutiu".',
      'with-names': 'Mencione os nomes das pessoas quando relevante.',
      'smart': 'Mencione nomes APENAS para contribuições muito importantes.'
    };

    const config = levelConfigs[level] || levelConfigs[3];
    const privacyNote = privacyInstructions[privacy] || privacyInstructions['smart'];

    const systemPrompt = `Você é um assistente que resume conversas de grupo do WhatsApp em português brasileiro.
${config.prompt}
${privacyNote}
Organize o resumo por temas/assuntos quando apropriado.`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Resuma esta conversa:\n\n${messagesText}` }
      ],
      max_tokens: config.maxTokens,
      temperature: 0.3,
    });

    res.json({
      summary: completion.choices[0]?.message?.content || '',
      stats: {
        totalMessages: messages.length,
        participants: participants.size,
        tokensUsed: completion.usage?.total_tokens || 0,
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
