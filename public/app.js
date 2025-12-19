/**
 * WhatsApp Group Summarizer - Frontend Application
 * With smart rate limit handling and token tracking
 */

// ==============================================
// Constants
// ==============================================
const GROQ_TPM_LIMIT = 6000; // Tokens per minute limit
const TOKENS_PER_MESSAGE = 50; // Estimated tokens per message
const SAMPLE_SIZE = 150; // Messages for quick sampling
const CHUNK_SIZE = 100; // Messages per chunk for full processing

// ==============================================
// State
// ==============================================
const state = {
  messagesByDate: {},
  allDates: [],
  selectedDate: null,
  selectedDateInfo: null,
  level: 3,
  privacy: 'smart',
  // Token tracking
  tokensUsed: 0,
  tokenResetTime: 0, // Timestamp when tokens reset
  processingMode: null, // 'quick' or 'full'
  processingProgress: { current: 0, total: 0, summaries: [] }
};

// ==============================================
// DOM Elements
// ==============================================
const elements = {
  stepUpload: document.getElementById('step-upload'),
  stepDates: document.getElementById('step-dates'),
  stepOptions: document.getElementById('step-options'),
  stepResult: document.getElementById('step-result'),
  
  uploadArea: document.getElementById('upload-area'),
  fileInput: document.getElementById('file-input'),
  
  datesInfo: document.getElementById('dates-info'),
  recentDates: document.getElementById('recent-dates'),
  allDates: document.getElementById('all-dates'),
  loadMoreDates: document.getElementById('load-more-dates'),
  btnBackUpload: document.getElementById('btn-back-upload'),
  
  selectedDateInfo: document.getElementById('selected-date-info'),
  levelOptions: document.getElementById('level-options'),
  privacyOptions: document.getElementById('privacy-options'),
  btnBackDates: document.getElementById('btn-back-dates'),
  btnSummarize: document.getElementById('btn-summarize'),
  
  resultDate: document.getElementById('result-date'),
  summaryText: document.getElementById('summary-text'),
  summaryStats: document.getElementById('summary-stats'),
  btnCopy: document.getElementById('btn-copy'),
  btnShare: document.getElementById('btn-share'),
  btnNewDate: document.getElementById('btn-new-date'),
  
  loading: document.getElementById('loading'),
  loadingText: document.getElementById('loading-text'),
  toast: document.getElementById('toast'),
  
  // New elements for token tracking
  tokenBar: document.getElementById('token-bar'),
  modeModal: document.getElementById('mode-modal')
};

// ==============================================
// Utilities
// ==============================================

function showStep(stepName) {
  ['step-upload', 'step-dates', 'step-options', 'step-result'].forEach(s => {
    document.getElementById(s)?.classList.toggle('active', s === `step-${stepName}`);
  });
}

function showLoading(text = 'Processando...') {
  elements.loadingText.textContent = text;
  elements.loading.hidden = false;
}

function hideLoading() {
  elements.loading.hidden = true;
}

function showToast(message, type = 'info') {
  elements.toast.textContent = message;
  elements.toast.className = `toast ${type}`;
  elements.toast.hidden = false;
  setTimeout(() => { elements.toast.hidden = true; }, 4000);
}

function formatDate(dateStr) {
  const [year, month, day] = dateStr.split('-');
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('pt-BR', { 
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' 
  });
}

function formatDateShort(dateStr) {
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

function estimateTokens(messages) {
  return messages.reduce((sum, msg) => sum + Math.ceil(msg.content.length / 4) + 10, 0);
}

function formatTime(seconds) {
  if (seconds < 60) return `${seconds} segundos`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}min ${secs}s` : `${mins} minuto${mins > 1 ? 's' : ''}`;
}

// ==============================================
// Token Tracking
// ==============================================

function loadTokenState() {
  const saved = localStorage.getItem('groqTokenState');
  if (saved) {
    const data = JSON.parse(saved);
    // Check if reset time has passed
    if (Date.now() > data.resetTime) {
      state.tokensUsed = 0;
      state.tokenResetTime = 0;
    } else {
      state.tokensUsed = data.tokensUsed;
      state.tokenResetTime = data.resetTime;
    }
  }
}

function saveTokenState() {
  localStorage.setItem('groqTokenState', JSON.stringify({
    tokensUsed: state.tokensUsed,
    resetTime: state.tokenResetTime
  }));
}

function updateTokensUsed(tokens) {
  state.tokensUsed += tokens;
  // Reset time is 60 seconds from first use in this minute
  if (state.tokenResetTime < Date.now()) {
    state.tokenResetTime = Date.now() + 60000;
  }
  saveTokenState();
  updateTokenBar();
}

function getAvailableTokens() {
  if (Date.now() > state.tokenResetTime) {
    state.tokensUsed = 0;
    state.tokenResetTime = 0;
    saveTokenState();
  }
  return GROQ_TPM_LIMIT - state.tokensUsed;
}

function getSecondsUntilReset() {
  if (state.tokenResetTime <= Date.now()) return 0;
  return Math.ceil((state.tokenResetTime - Date.now()) / 1000);
}

function updateTokenBar() {
  const bar = elements.tokenBar;
  if (!bar) return;
  
  const available = getAvailableTokens();
  const percentage = (available / GROQ_TPM_LIMIT) * 100;
  const secondsLeft = getSecondsUntilReset();
  
  const fill = bar.querySelector('.token-fill');
  const text = bar.querySelector('.token-text');
  
  if (fill) {
    fill.style.width = `${percentage}%`;
    fill.className = `token-fill ${percentage > 50 ? 'good' : percentage > 20 ? 'warning' : 'critical'}`;
  }
  
  if (text) {
    if (available >= GROQ_TPM_LIMIT) {
      text.textContent = `✓ Pronto para usar`;
    } else if (secondsLeft > 0) {
      text.textContent = `${available.toLocaleString()} tokens disponíveis • Recarrega em ${secondsLeft}s`;
    } else {
      text.textContent = `${available.toLocaleString()} tokens disponíveis`;
    }
  }
}

// Update token bar every second
setInterval(updateTokenBar, 1000);

// ==============================================
// Mode Selection Modal
// ==============================================

function showModeModal(messageCount) {
  const estimatedTokens = messageCount * TOKENS_PER_MESSAGE;
  const chunksNeeded = Math.ceil(messageCount / CHUNK_SIZE);
  const fullTimeSeconds = chunksNeeded * 60; // 1 minute per chunk
  
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'mode-modal';
  
  modal.innerHTML = `
    <div class="modal-content">
      <h2>📊 Dia com muitas mensagens</h2>
      <p class="modal-subtitle">${messageCount.toLocaleString()} mensagens (~${estimatedTokens.toLocaleString()} tokens)</p>
      
      <div class="mode-options">
        <div class="mode-card" data-mode="quick">
          <div class="mode-icon">⚡</div>
          <h3>Resumo Rápido</h3>
          <p>Amostragem de ~${SAMPLE_SIZE} mensagens</p>
          <ul>
            <li>✓ Pronto em segundos</li>
            <li>✓ Captura os principais tópicos</li>
            <li>⚠ Pode perder alguns detalhes</li>
          </ul>
          <div class="mode-time">~5 segundos</div>
        </div>
        
        <div class="mode-card" data-mode="full">
          <div class="mode-icon">📖</div>
          <h3>Resumo Completo</h3>
          <p>Processa todas as ${messageCount.toLocaleString()} mensagens</p>
          <ul>
            <li>✓ Cobre toda a conversa</li>
            <li>✓ Máxima precisão</li>
            <li>⏱ Requer várias etapas</li>
          </ul>
          <div class="mode-time">~${formatTime(fullTimeSeconds)}</div>
        </div>
      </div>
      
      <button class="btn-link modal-cancel">Cancelar</button>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Event listeners
  modal.querySelectorAll('.mode-card').forEach(card => {
    card.addEventListener('click', () => {
      const mode = card.dataset.mode;
      modal.remove();
      startSummarization(mode);
    });
  });
  
  modal.querySelector('.modal-cancel').addEventListener('click', () => {
    modal.remove();
  });
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

// ==============================================
// API Calls
// ==============================================

async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await fetch('/api/upload', { method: 'POST', body: formData });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Falha ao processar arquivo');
  }
  return response.json();
}

async function summarizeMessages(messages, isPartial = false) {
  const response = await fetch('/api/summarize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      level: state.level,
      privacy: state.privacy,
      isPartial
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Falha ao gerar resumo');
  }
  return response.json();
}

async function mergeSummaries(summaries) {
  const response = await fetch('/api/merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summaries,
      level: state.level,
      privacy: state.privacy
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Falha ao combinar resumos');
  }
  return response.json();
}

// ==============================================
// Summarization Logic
// ==============================================

async function startSummarization(mode) {
  state.processingMode = mode;
  const messages = state.messagesByDate[state.selectedDate];
  
  if (mode === 'quick') {
    await processQuickMode(messages);
  } else {
    await processFullMode(messages);
  }
}

async function processQuickMode(messages) {
  try {
    showLoading('Gerando resumo rápido...');
    
    // Sample messages from throughout the day
    const step = Math.max(1, Math.floor(messages.length / SAMPLE_SIZE));
    const sampled = messages.filter((_, i) => i % step === 0).slice(0, SAMPLE_SIZE);
    
    const result = await summarizeMessages(sampled, false);
    
    updateTokensUsed(result.stats.tokensUsed);
    
    const note = messages.length > SAMPLE_SIZE 
      ? `\n\n---\n_📊 Resumo baseado em amostra de ${sampled.length} de ${messages.length} mensagens_`
      : '';
    
    displayResult(result.summary + note, result.stats);
    
  } catch (error) {
    hideLoading();
    showToast(error.message, 'error');
  }
}

async function processFullMode(messages) {
  const chunks = [];
  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    chunks.push(messages.slice(i, i + CHUNK_SIZE));
  }
  
  state.processingProgress = { current: 0, total: chunks.length, summaries: [] };
  
  showProgressUI(chunks.length);
  
  for (let i = 0; i < chunks.length; i++) {
    // Check if we need to wait for tokens
    const available = getAvailableTokens();
    const needed = estimateTokens(chunks[i]);
    
    if (available < needed) {
      const waitTime = getSecondsUntilReset();
      await waitWithCountdown(waitTime, `Aguardando limite de tokens... ${i + 1}/${chunks.length}`);
    }
    
    try {
      updateProgressUI(i + 1, chunks.length, 'Processando...');
      
      const result = await summarizeMessages(chunks[i], true);
      state.processingProgress.summaries.push(result.summary);
      updateTokensUsed(result.stats.tokensUsed);
      
      updateProgressUI(i + 1, chunks.length, 'Concluído');
      
    } catch (error) {
      if (error.message.includes('rate') || error.message.includes('limit')) {
        // Wait and retry
        const waitTime = 60;
        await waitWithCountdown(waitTime, `Limite atingido, aguardando... ${i + 1}/${chunks.length}`);
        i--; // Retry this chunk
        continue;
      }
      throw error;
    }
  }
  
  // Merge all summaries
  updateProgressUI(chunks.length, chunks.length, 'Combinando resumos...');
  
  // Wait for tokens if needed
  const available = getAvailableTokens();
  if (available < 2000) {
    const waitTime = getSecondsUntilReset();
    await waitWithCountdown(waitTime, 'Aguardando para combinar...');
  }
  
  try {
    const mergeResult = await mergeSummaries(state.processingProgress.summaries);
    updateTokensUsed(mergeResult.stats?.tokensUsed || 0);
    
    hideProgressUI();
    displayResult(mergeResult.summary, {
      totalMessages: messages.length,
      participants: new Set(messages.map(m => m.sender)).size,
      tokensUsed: state.processingProgress.summaries.length * 500,
      chunks: chunks.length,
      processingTime: 0
    });
    
  } catch (error) {
    hideProgressUI();
    showToast(error.message, 'error');
  }
}

async function waitWithCountdown(seconds, message) {
  return new Promise(resolve => {
    const interval = setInterval(() => {
      seconds--;
      if (seconds <= 0) {
        clearInterval(interval);
        resolve();
      } else {
        updateProgressUI(
          state.processingProgress.current, 
          state.processingProgress.total,
          `${message} (${seconds}s)`
        );
      }
    }, 1000);
  });
}

function showProgressUI(totalChunks) {
  elements.loading.hidden = false;
  elements.loadingText.innerHTML = `
    <div class="progress-container">
      <div class="progress-bar">
        <div class="progress-fill" style="width: 0%"></div>
      </div>
      <div class="progress-text">Iniciando... 0/${totalChunks}</div>
    </div>
  `;
}

function updateProgressUI(current, total, status) {
  state.processingProgress.current = current;
  const percentage = (current / total) * 100;
  
  const fill = document.querySelector('.progress-fill');
  const text = document.querySelector('.progress-text');
  
  if (fill) fill.style.width = `${percentage}%`;
  if (text) text.textContent = `${status} ${current}/${total}`;
}

function hideProgressUI() {
  elements.loading.hidden = true;
}

function displayResult(summary, stats) {
  hideLoading();
  
  elements.summaryText.innerHTML = formatSummary(summary);
  elements.summaryStats.innerHTML = `
    <div class="stat-item">
      <span class="stat-value">${stats.totalMessages}</span>
      <span class="stat-label">mensagens</span>
    </div>
    <div class="stat-item">
      <span class="stat-value">${stats.participants}</span>
      <span class="stat-label">participantes</span>
    </div>
    <div class="stat-item">
      <span class="stat-value">${stats.chunks}</span>
      <span class="stat-label">partes</span>
    </div>
  `;
  
  elements.resultDate.textContent = formatDate(state.selectedDate);
  elements.btnShare.hidden = !navigator.share;
  
  showStep('result');
}

function formatSummary(text) {
  return text
    .replace(/##\s*(.+)/g, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>');
}

// ==============================================
// Date Cards
// ==============================================

function createDateCard(dateInfo) {
  const div = document.createElement('div');
  div.className = 'date-card';
  div.dataset.date = dateInfo.date;
  
  const isLarge = dateInfo.messageCount > 200;
  
  div.innerHTML = `
    <div class="date-info">
      <span class="date-value">${formatDate(dateInfo.date)}</span>
      <span class="date-preview">${dateInfo.preview || ''}</span>
    </div>
    <div class="date-stats">
      <span class="message-count ${isLarge ? 'large' : ''}">${dateInfo.messageCount} mensagens</span>
      <span class="participant-count">${dateInfo.participants} participantes</span>
    </div>
  `;
  
  div.addEventListener('click', () => selectDate(dateInfo));
  return div;
}

function renderDates(dates, container, clear = true) {
  if (clear) container.innerHTML = '';
  dates.forEach(d => container.appendChild(createDateCard(d)));
}

function selectDate(dateInfo) {
  state.selectedDate = dateInfo.date;
  state.selectedDateInfo = dateInfo;
  
  document.querySelectorAll('.date-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.date === dateInfo.date);
  });
  
  elements.selectedDateInfo.textContent = 
    `${formatDate(dateInfo.date)} • ${dateInfo.messageCount} mensagens`;
  
  showStep('options');
}

// ==============================================
// File Upload
// ==============================================

async function handleFile(file) {
  if (!file) return;
  
  if (!file.name.endsWith('.txt') && file.type !== 'text/plain') {
    showToast('Por favor, selecione um arquivo .txt exportado do WhatsApp', 'error');
    return;
  }
  
  if (file.size > 10 * 1024 * 1024) {
    showToast('Arquivo muito grande. Máximo 10MB.', 'error');
    return;
  }
  
  try {
    showLoading('Analisando arquivo...');
    
    const result = await uploadFile(file);
    
    state.messagesByDate = result.messagesByDate;
    state.allDates = result.dates;
    
    elements.datesInfo.textContent = 
      `${result.totalMessages.toLocaleString()} mensagens em ${result.totalDays} dias`;
    
    renderDates(result.dates.slice(0, 3), elements.recentDates);
    elements.loadMoreDates.hidden = result.totalDays <= 3;
    elements.allDates.hidden = true;
    
    hideLoading();
    showStep('dates');
    
  } catch (error) {
    hideLoading();
    showToast(error.message, 'error');
  }
}

// ==============================================
// Summary Handler
// ==============================================

async function handleSummarize() {
  const messages = state.messagesByDate[state.selectedDate];
  
  if (!messages || messages.length === 0) {
    showToast('Nenhuma mensagem encontrada para esta data', 'error');
    return;
  }
  
  // Check if day has many messages
  const estimatedTokens = estimateTokens(messages);
  
  if (estimatedTokens > GROQ_TPM_LIMIT || messages.length > 300) {
    // Show mode selection modal
    showModeModal(messages.length);
  } else {
    // Direct processing
    await startSummarization('quick');
  }
}

// ==============================================
// Event Listeners
// ==============================================

elements.uploadArea?.addEventListener('click', () => elements.fileInput?.click());
elements.fileInput?.addEventListener('change', (e) => handleFile(e.target.files[0]));

elements.uploadArea?.addEventListener('dragover', (e) => {
  e.preventDefault();
  elements.uploadArea.classList.add('dragover');
});

elements.uploadArea?.addEventListener('dragleave', () => {
  elements.uploadArea?.classList.remove('dragover');
});

elements.uploadArea?.addEventListener('drop', (e) => {
  e.preventDefault();
  elements.uploadArea?.classList.remove('dragover');
  handleFile(e.dataTransfer.files[0]);
});

elements.loadMoreDates?.addEventListener('click', () => {
  elements.loadMoreDates.hidden = true;
  elements.allDates.hidden = false;
  renderDates(state.allDates.slice(3), elements.allDates);
});

elements.btnBackUpload?.addEventListener('click', () => {
  state.messagesByDate = {};
  state.allDates = [];
  elements.fileInput.value = '';
  showStep('upload');
});

elements.btnBackDates?.addEventListener('click', () => showStep('dates'));
elements.btnNewDate?.addEventListener('click', () => showStep('dates'));

elements.levelOptions?.addEventListener('change', (e) => {
  if (e.target.name === 'level') {
    state.level = parseInt(e.target.value);
    document.querySelectorAll('#level-options .radio-card').forEach(card => {
      card.classList.toggle('selected', card.querySelector('input').checked);
    });
  }
});

elements.privacyOptions?.addEventListener('change', (e) => {
  if (e.target.name === 'privacy') {
    state.privacy = e.target.value;
    document.querySelectorAll('#privacy-options .radio-card').forEach(card => {
      card.classList.toggle('selected', card.querySelector('input').checked);
    });
  }
});

elements.btnSummarize?.addEventListener('click', handleSummarize);

elements.btnCopy?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(elements.summaryText.innerText);
    showToast('Resumo copiado!', 'success');
  } catch { showToast('Não foi possível copiar', 'error'); }
});

elements.btnShare?.addEventListener('click', async () => {
  try {
    await navigator.share({
      title: `Resumo do grupo - ${formatDateShort(state.selectedDate)}`,
      text: elements.summaryText.innerText
    });
  } catch {}
});

// ==============================================
// PWA & Initialize
// ==============================================

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
    .then(() => console.log('Service Worker registered'))
    .catch(err => console.error('SW registration failed:', err));
}

async function init() {
  loadTokenState();
  updateTokenBar();
  
  const sharedContent = sessionStorage.getItem('sharedFileContent');
  const sharedFileName = sessionStorage.getItem('sharedFileName');
  
  if (sharedContent && sharedFileName) {
    sessionStorage.removeItem('sharedFileContent');
    sessionStorage.removeItem('sharedFileName');
    await handleFile(new File([sharedContent], sharedFileName, { type: 'text/plain' }));
  }
  
  console.log('WhatsApp Group Summarizer initialized');
}

init();
