import Groq from 'groq-sdk';
import dotenv from 'dotenv';

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Models to test with their limits from Groq table
const MODELS_CONFIG = {
  'llama-3.1-8b-instant': { rpm: 30, tpm: 6000, name: 'Llama 3.1 8B' },
  'llama-3.3-70b-versatile': { rpm: 30, tpm: 12000, name: 'Llama 3.3 70B' },
  'meta-llama/llama-4-scout-17b-16e-instruct': { rpm: 30, tpm: 30000, name: 'Llama 4 Scout 17B (30K TPM!)' },
  'meta-llama/llama-4-maverick-17b-128e-instruct': { rpm: 30, tpm: 6000, name: 'Llama 4 Maverick' },
};

// Generate fake WhatsApp messages
function generateMessages(count) {
  const senders = ['Maria', 'João', 'Pedro', 'Ana', 'Carlos', 'Julia'];
  const contents = [
    'Bom dia pessoal! Tudo bem com vocês?',
    'Alguém viu o jogo ontem? Foi incrível!',
    'Preciso de ajuda com um problema no trabalho, alguém pode me ajudar?',
    'Vamos marcar um churrasco no final de semana? Seria muito bom!',
    'Acabei de ver uma notícia interessante sobre tecnologia e inteligência artificial',
    'Quem vai na festa da Ana no sábado? Confirmem aí!',
    'Pessoal, não esqueçam da reunião amanhã às 10h, é importante!',
    'Alguém sabe de um bom restaurante japonês por aqui?',
    'Estou pensando em trocar de carro, alguma sugestão de modelo?',
    'Que dia lindo hoje! Vou aproveitar para fazer uma caminhada ☀️',
  ];
  
  const messages = [];
  for (let i = 0; i < count; i++) {
    messages.push({
      date: '19/12/2024',
      time: `${String(Math.floor(i / 60) % 24).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`,
      sender: senders[i % senders.length],
      content: contents[i % contents.length] + ` (mensagem número ${i + 1})`,
      isMedia: false
    });
  }
  return messages;
}

function formatMessages(messages) {
  return messages.map(m => `[${m.time}] ${m.sender}: ${m.content}`).join('\n');
}

async function testModel(modelName, messageCount) {
  const messages = generateMessages(messageCount);
  const text = formatMessages(messages);
  const estimatedTokens = Math.ceil(text.length / 4); // ~4 chars per token
  
  const start = Date.now();
  
  try {
    const completion = await groq.chat.completions.create({
      model: modelName,
      messages: [
        { role: 'system', content: 'Resuma esta conversa de WhatsApp em português brasileiro, de forma clara e organizada.' },
        { role: 'user', content: `Resuma:\n\n${text}` }
      ],
      max_tokens: 400,
      temperature: 0.3,
    });
    
    const elapsed = (Date.now() - start) / 1000;
    const tokens = completion.usage?.total_tokens || 0;
    
    return { 
      success: true, 
      time: elapsed, 
      tokens, 
      messages: messageCount,
      estimatedTokens,
      chars: text.length
    };
    
  } catch (err) {
    const elapsed = (Date.now() - start) / 1000;
    return { 
      success: false, 
      time: elapsed, 
      error: err.message.slice(0, 100), 
      messages: messageCount,
      estimatedTokens,
      chars: text.length
    };
  }
}

async function runTests() {
  console.log('='.repeat(70));
  console.log('GROQ API - Teste de Performance para Vercel (timeout 10s)');
  console.log('='.repeat(70));
  
  // Test different message counts
  const messageCounts = [50, 80, 100, 120, 150, 180, 200, 250];
  
  const results = {};
  
  for (const [modelId, config] of Object.entries(MODELS_CONFIG)) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`📊 ${config.name}`);
    console.log(`   Model: ${modelId}`);
    console.log(`   Limits: ${config.rpm} req/min | ${config.tpm.toLocaleString()} tokens/min`);
    console.log(`${'─'.repeat(70)}`);
    
    results[modelId] = { config, tests: [] };
    
    for (const count of messageCounts) {
      process.stdout.write(`   Testing ${count} msgs... `);
      
      const result = await testModel(modelId, count);
      results[modelId].tests.push(result);
      
      if (result.success) {
        const status = result.time < 9 ? '✅' : '⚠️';
        console.log(`${status} ${result.time.toFixed(2)}s | ${result.tokens} tokens`);
      } else {
        console.log(`❌ ${result.time.toFixed(2)}s | ${result.error}`);
      }
      
      // Stop if too slow or error
      if (result.time > 12 || !result.success) {
        console.log(`   ⏹️ Stopping - ${result.success ? 'too slow' : 'error'}`);
        break;
      }
      
      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 500));
    }
  }
  
  // Analysis
  console.log('\n' + '='.repeat(70));
  console.log('📈 ANÁLISE DOS RESULTADOS');
  console.log('='.repeat(70));
  
  const analysis = [];
  
  for (const [modelId, data] of Object.entries(results)) {
    const safes = data.tests.filter(t => t.success && t.time < 9);
    const maxMsgs = safes.length > 0 ? Math.max(...safes.map(t => t.messages)) : 0;
    const avgTime = safes.length > 0 ? safes.reduce((a, t) => a + t.time, 0) / safes.length : 0;
    const avgTokens = safes.length > 0 ? safes.reduce((a, t) => a + t.tokens, 0) / safes.length : 0;
    
    // Calculate how many chunks needed for 1300 msgs
    const chunksFor1300 = maxMsgs > 0 ? Math.ceil(1300 / maxMsgs) : Infinity;
    const totalTokensFor1300 = chunksFor1300 * avgTokens;
    const fitsInTPM = totalTokensFor1300 <= data.config.tpm;
    
    analysis.push({
      modelId,
      name: data.config.name,
      tpm: data.config.tpm,
      maxMsgs,
      avgTime,
      avgTokens,
      chunksFor1300,
      totalTokensFor1300,
      fitsInTPM,
      score: fitsInTPM ? maxMsgs * 10 + (data.config.tpm / 1000) : maxMsgs
    });
    
    console.log(`\n${data.config.name}:`);
    console.log(`   Max msgs/chunk: ${maxMsgs}`);
    console.log(`   Avg time: ${avgTime.toFixed(2)}s`);
    console.log(`   Avg tokens/chunk: ${Math.round(avgTokens)}`);
    console.log(`   Para 1300 msgs: ${chunksFor1300} chunks = ${Math.round(totalTokensFor1300)} tokens`);
    console.log(`   Cabe no TPM (${data.config.tpm})? ${fitsInTPM ? '✅ SIM' : '❌ NÃO (precisa esperar)'}`);
  }
  
  // Sort by score
  analysis.sort((a, b) => b.score - a.score);
  
  console.log('\n' + '='.repeat(70));
  console.log('🏆 RANKING (considerando TPM e velocidade)');
  console.log('='.repeat(70));
  
  analysis.forEach((a, i) => {
    const medal = ['🥇', '🥈', '🥉', '4️⃣'][i] || `${i+1}.`;
    console.log(`\n${medal} ${a.name}`);
    console.log(`   ${a.maxMsgs} msgs/chunk | ${a.avgTime.toFixed(2)}s | TPM: ${a.tpm.toLocaleString()}`);
    console.log(`   1300 msgs → ${a.chunksFor1300} chunks ${a.fitsInTPM ? '(tudo em 1 min!)' : '(precisa ~2 min)'}`);
  });
  
  // Best recommendation
  const best = analysis[0];
  console.log('\n' + '='.repeat(70));
  console.log('✨ RECOMENDAÇÃO FINAL');
  console.log('='.repeat(70));
  console.log(`\nModelo: ${best.name}`);
  console.log(`ID: ${best.modelId}`);
  console.log(`Chunk size: ${best.maxMsgs} mensagens`);
  console.log(`Tempo médio: ${best.avgTime.toFixed(2)}s por chunk`);
  console.log(`TPM: ${best.tpm.toLocaleString()} tokens/minuto`);
  
  if (best.fitsInTPM) {
    console.log(`\n✅ 1300 mensagens = ${best.chunksFor1300} chunks processados em ~${Math.ceil(best.chunksFor1300 * best.avgTime)}s`);
    console.log(`   Todos os chunks cabem no limite de TPM!`);
  } else {
    console.log(`\n⚠️ 1300 mensagens pode precisar esperar reset de TPM`);
  }
}

runTests().catch(console.error);
