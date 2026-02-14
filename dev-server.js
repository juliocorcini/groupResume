/**
 * Simple development server that mimics Vercel serverless functions
 * Run with: node dev-server.js
 */

import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import formidable from 'formidable';
import { readFile, stat, rename } from 'fs/promises';
import { createReadStream } from 'fs';
import { extname } from 'path';
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

// Transcribe endpoint - transcription only (no summary)
app.post('/api/transcribe', async (req, res) => {
  try {
    const form = formidable({ maxFileSize: 25 * 1024 * 1024, allowEmptyFiles: false });
    const [, files] = await form.parse(req);
    const audioFile = files.audio?.[0] || files.file?.[0];
    if (!audioFile) {
      return res.status(400).json({ error: 'No audio file provided', code: 'NO_FILE' });
    }
    const fileStats = await stat(audioFile.filepath);
    const fileSizeMB = fileStats.size / (1024 * 1024);
    const originalName = audioFile.originalFilename || 'audio.ogg';
    const ext = extname(originalName) || '.ogg';
    const renamedPath = audioFile.filepath + ext;
    await rename(audioFile.filepath, renamedPath);
    const transcriptionResult = await groq.audio.transcriptions.create({
      model: 'whisper-large-v3-turbo',
      file: createReadStream(renamedPath),
      language: 'pt',
      response_format: 'verbose_json',
    });
    const text = typeof transcriptionResult === 'string' ? transcriptionResult : transcriptionResult.text;
    const duration = typeof transcriptionResult !== 'string' ? (transcriptionResult.duration ?? null) : null;
    const wordCount = text.split(/\s+/).length;
    res.json({
      transcription: text,
      stats: {
        audioDuration: duration ? Math.round(duration) : null,
        wordCount,
        fileSizeMB: parseFloat(fileSizeMB.toFixed(2)),
        transcribeTimeMs: 0,
        whisperModel: 'whisper-large-v3-turbo',
      },
    });
  } catch (err) {
    console.error('Transcribe error:', err);
    if (err.message?.includes('rate') || err.message?.includes('429')) {
      return res.status(429).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to process audio' });
  }
});

// Summarize-audio endpoint
const AUDIO_LEVEL_CONFIGS = {
  flash: { maxTokens: 200, systemPrompt: 'Você é um assistente que resume áudios transcritos em português brasileiro.\n\nMODO FLASH: Produza um resumo ULTRA-CURTO em apenas 2-3 tópicos em formato de bullet points.\n- Cada bullet = um assunto principal mencionado no áudio\n- Máximo 2-3 bullets, cada um com 1 frase\n- Ideal para áudios curtos (30s-1min) — o leitor quer só a essência\n- Use markdown com "- " para os bullets\n- Seja direto e objetivo' },
  topicos: { maxTokens: 600, systemPrompt: 'Você é um assistente que resume áudios transcritos em português brasileiro.\n\nMODO TÓPICOS: Organize o resumo por assunto/tema. Este é o modo PADRÃO e mais útil.\n- Identifique TODOS os assuntos discutidos no áudio (geralmente 4-8 tópicos para um áudio de 2-5 min)\n- Para cada tópico: 1 bullet com título + 1-2 frases explicando o que foi dito\n- NÃO perca assuntos importantes — um áudio de 5 min deve ter vários tópicos\n- Use markdown: ## para títulos de seção, - para bullets\n- Seja completo mas conciso — capture cada assunto sem repetir' },
  detalhado: { maxTokens: 1200, systemPrompt: 'Você é um assistente que resume áudios transcritos em português brasileiro.\n\nMODO DETALHADO: Produza um resumo COMPLETO preservando o máximo de informação possível.\n- Organize por tópicos/assuntos\n- Para cada tópico: explique com contexto, nuances e detalhes relevantes\n- Quando apropriado, cite frases-chave entre aspas para preservar o que foi dito\n- Inclua informações importantes que um resumo curto perderia\n- Use markdown: ## para seções, - para bullets, "aspas" para citações\n- Ideal para áudios longos (5+ min) onde o usuário quer entender tudo sem ouvir\n- Mantenha a ordem lógica do áudio quando fizer sentido' },
  limpa: { maxTokens: 4000, systemPrompt: 'Você é um assistente que transforma transcrições de áudio em texto limpo e legível.\n\nMODO TRANSCRIÇÃO LIMPA: NÃO faça um resumo. Transforme a transcrição em texto bem formatado.\n- Remova palavras de preenchimento: "né", "tipo", "aí", "então", "daí", "olha", "cara", "bom", etc.\n- Corrija erros de gramática e concordância\n- Adicione pontuação adequada (vírgulas, pontos, dois-pontos)\n- Organize em parágrafos quando houver mudança de assunto\n- Mantenha TODO o conteúdo — não resuma, não omita informações\n- O resultado deve ser um texto que alguém possa ler como se fosse escrito, não falado\n- Preserve a ordem e o sentido original\n- Use parágrafos separados por linha em branco para clareza' },
};
app.post('/api/summarize-audio', async (req, res) => {
  try {
    const { transcription, level = 'topicos' } = req.body || {};
    if (!transcription) {
      return res.status(400).json({ error: 'Missing transcription' });
    }
    const validLevels = ['flash', 'topicos', 'detalhado', 'limpa'];
    const summaryLevel = validLevels.includes(level) ? level : 'topicos';
    const config = AUDIO_LEVEL_CONFIGS[summaryLevel] || AUDIO_LEVEL_CONFIGS.topicos;
    const userMessage = summaryLevel === 'limpa'
      ? `Transforme esta transcrição em texto limpo e legível:\n\n${transcription}`
      : `Resuma este áudio transcrito:\n\n${transcription}`;
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: config.systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: config.maxTokens,
      temperature: 0.3,
    });
    res.json({ summary: completion.choices[0]?.message?.content?.trim() || '' });
  } catch (err) {
    console.error('Summarize audio error:', err);
    if (err.message?.includes('rate') || err.message?.includes('429')) {
      return res.status(429).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

// Audio-chat endpoint
const MAX_TRANSCRIPTION_CHARS = 100_000;
function truncateTranscription(text) {
  if (!text || text.length <= MAX_TRANSCRIPTION_CHARS) return text || '';
  const half = Math.floor(MAX_TRANSCRIPTION_CHARS / 2);
  return `${text.slice(0, half)}\n\n[... transcrição truncada no meio ...]\n\n${text.slice(-half)}`;
}
const CHAT_SYSTEM_TEMPLATE = `Você é um assistente que responde perguntas sobre o conteúdo de um áudio transcrito.

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
app.post('/api/audio-chat', async (req, res) => {
  try {
    const { transcription, messages } = req.body || {};
    if (!transcription || typeof transcription !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid transcription' });
    }
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Missing or invalid messages' });
    }
    const transcriptionText = truncateTranscription(transcription);
    const systemContent = CHAT_SYSTEM_TEMPLATE.replace('{transcription}', transcriptionText);
    const recentMessages = messages.slice(-12);
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: systemContent },
        ...recentMessages,
      ],
      max_tokens: 1024,
      temperature: 0.5,
    });
    const content = completion.choices[0]?.message?.content?.trim() || '';
    const tokensUsed = completion.usage?.total_tokens || 0;
    res.json({ content, tokensUsed });
  } catch (err) {
    console.error('Audio chat error:', err);
    if (err.message?.includes('rate') || err.message?.includes('429')) {
      return res.status(429).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to generate response' });
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
