/**
 * WhatsApp Group Summarizer - Frontend Application
 */

// ==============================================
// Constants
// ==============================================
// Chunks must complete in <10s (Vercel timeout)
const MODEL_LIMITS = {
  fast: 60,       // llama-3.1-8b-instant - very fast
  balanced: 80,   // llama-3.3-70b-versatile - medium
  powerful: 120   // compound-beta - slower but 70K TPM
};
const DEFAULT_MODEL = 'powerful';
const FULL_MODE_THRESHOLD = 120; // Show modal above this

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
  model: DEFAULT_MODEL
};

// ==============================================
// DOM Elements
// ==============================================
const $ = id => document.getElementById(id);

const elements = {
  stepUpload: $('step-upload'),
  stepDates: $('step-dates'),
  stepOptions: $('step-options'),
  stepResult: $('step-result'),
  uploadArea: $('upload-area'),
  fileInput: $('file-input'),
  datesInfo: $('dates-info'),
  recentDates: $('recent-dates'),
  allDates: $('all-dates'),
  loadMoreDates: $('load-more-dates'),
  btnBackUpload: $('btn-back-upload'),
  selectedDateInfo: $('selected-date-info'),
  levelOptions: $('level-options'),
  privacyOptions: $('privacy-options'),
  btnBackDates: $('btn-back-dates'),
  btnSummarize: $('btn-summarize'),
  resultDate: $('result-date'),
  summaryText: $('summary-text'),
  summaryStats: $('summary-stats'),
  btnCopy: $('btn-copy'),
  btnShare: $('btn-share'),
  btnNewDate: $('btn-new-date'),
  loading: $('loading'),
  loadingText: $('loading-text'),
  toast: $('toast'),
  tokenBar: $('token-bar')
};

// ==============================================
// Utilities
// ==============================================

function showStep(name) {
  ['upload', 'dates', 'options', 'result'].forEach(s => {
    $(`step-${s}`)?.classList.toggle('active', s === name);
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
  return new Date(year, month - 1, day).toLocaleDateString('pt-BR', { 
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' 
  });
}

function formatDateShort(dateStr) {
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

function formatTime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
}

// ==============================================
// API Calls
// ==============================================

async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', body: formData });
  if (!res.ok) throw new Error((await res.json()).error || 'Erro no upload');
  return res.json();
}

async function summarizeChunk(messages, isPartial = false) {
  const res = await fetch('/api/summarize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      messages, 
      level: state.level, 
      privacy: state.privacy, 
      model: state.model,
      isPartial 
    })
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Erro ao resumir');
  return res.json();
}

async function mergeSummaries(summaries) {
  const res = await fetch('/api/merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ summaries, level: state.level, privacy: state.privacy })
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Erro ao combinar');
  return res.json();
}

// ==============================================
// Mode Selection Modal
// ==============================================

function showModeModal(messageCount) {
  const chunkSize = MODEL_LIMITS[state.model];
  const chunks = Math.ceil(messageCount / chunkSize);
  // With 70K TPM, chunks process quickly in sequence (no waits between)
  const estimatedTime = chunks * 5 + 5; // ~5s per chunk + 5s for merge
  
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content">
      <h2>📊 ${messageCount.toLocaleString()} mensagens</h2>
      <p class="modal-subtitle">Escolha como processar:</p>
      
      <div class="mode-options">
        <div class="mode-card" data-mode="quick">
          <div class="mode-icon">⚡</div>
          <h3>Rápido</h3>
          <p>Amostra de ~${chunkSize} mensagens</p>
          <div class="mode-time">~5 segundos</div>
        </div>
        
        <div class="mode-card" data-mode="full">
          <div class="mode-icon">📖</div>
          <h3>Completo</h3>
          <p>${chunks} partes processadas em sequência</p>
          <div class="mode-time">~${formatTime(estimatedTime)}</div>
        </div>
      </div>
      
      <button class="btn-link modal-cancel">Cancelar</button>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  modal.querySelectorAll('.mode-card').forEach(card => {
    card.onclick = () => { modal.remove(); startSummarization(card.dataset.mode); };
  });
  modal.querySelector('.modal-cancel').onclick = () => modal.remove();
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
}

// ==============================================
// Summarization
// ==============================================

async function startSummarization(mode) {
  const messages = state.messagesByDate[state.selectedDate];
  
  if (mode === 'quick') {
    await processQuick(messages);
  } else {
    await processFull(messages);
  }
}

async function processQuick(messages) {
  try {
    showLoading('Gerando resumo...');
    
    const maxMsgs = MODEL_LIMITS[state.model];
    let toProcess = messages;
    let sampled = false;
    
    // Sample if above model limit
    if (messages.length > maxMsgs) {
      const step = Math.floor(messages.length / maxMsgs);
      toProcess = messages.filter((_, i) => i % step === 0).slice(0, maxMsgs);
      sampled = true;
    }
    
    const result = await summarizeChunk(toProcess, false);
    
    let summary = result.summary;
    if (sampled) {
      summary += `\n\n---\n_Resumo de ${toProcess.length} de ${messages.length} mensagens_`;
    }
    
    displayResult(summary, { ...result.stats, totalMessages: messages.length });
  } catch (err) {
    hideLoading();
    showToast(err.message, 'error');
  }
}

async function processFull(messages) {
  const chunkSize = MODEL_LIMITS[state.model];
  const chunks = [];
  for (let i = 0; i < messages.length; i += chunkSize) {
    chunks.push(messages.slice(i, i + chunkSize));
  }
  
  showProgressUI(chunks.length);
  const summaries = [];
  let tokensUsed = 0;
  const TPM_LIMIT = 70000; // compound-beta has 70K TPM
  
  try {
    for (let i = 0; i < chunks.length; i++) {
      updateProgressUI(i, chunks.length, `Parte ${i + 1}/${chunks.length}...`);
      
      const result = await summarizeChunk(chunks[i], true);
      summaries.push(result.summary);
      tokensUsed += result.stats?.tokensUsed || 0;
      
      // Check if approaching TPM limit - only wait if needed
      if (tokensUsed > TPM_LIMIT * 0.9 && i < chunks.length - 1) {
        updateProgressUI(i + 1, chunks.length, 'Aguardando reset de tokens...');
        await new Promise(r => setTimeout(r, 60000)); // Wait 1 min for reset
        tokensUsed = 0; // Reset counter
      }
      // No delay needed otherwise - use all 70K TPM!
    }
    
    // Merge all summaries
    updateProgressUI(chunks.length, chunks.length, 'Combinando resumos...');
    
    let finalSummary;
    if (summaries.length === 1) {
      finalSummary = summaries[0];
    } else {
      const mergeResult = await mergeSummaries(summaries);
      finalSummary = mergeResult.summary;
    }
    
    hideLoading();
    displayResult(finalSummary, {
      totalMessages: messages.length,
      participants: new Set(messages.map(m => m.sender)).size,
      chunks: chunks.length
    });
    
  } catch (err) {
    hideLoading();
    // If rate limited, show helpful message
    if (err.message.includes('429') || err.message.includes('Limite')) {
      showToast('Limite de tokens atingido. Aguarde 1 minuto e tente novamente.', 'error');
    } else {
      showToast(err.message, 'error');
    }
  }
}

function showProgressUI(total) {
  elements.loading.hidden = false;
  elements.loadingText.innerHTML = `
    <div class="progress-container">
      <div class="progress-bar"><div class="progress-fill" style="width:0%"></div></div>
      <div class="progress-text">Iniciando... 0/${total}</div>
    </div>
  `;
}

function updateProgressUI(current, total, text) {
  const pct = (current / total) * 100;
  const fill = document.querySelector('.progress-fill');
  const txt = document.querySelector('.progress-text');
  if (fill) fill.style.width = `${pct}%`;
  if (txt) txt.textContent = text;
}

function displayResult(summary, stats) {
  hideLoading();
  
  elements.summaryText.innerHTML = summary
    .replace(/##\s*(.+)/g, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^/, '<p>').replace(/$/, '</p>');
  
  elements.summaryStats.innerHTML = `
    <div class="stat-item"><span class="stat-value">${stats.totalMessages}</span><span class="stat-label">mensagens</span></div>
    <div class="stat-item"><span class="stat-value">${stats.participants || '-'}</span><span class="stat-label">participantes</span></div>
    <div class="stat-item"><span class="stat-value">${stats.chunks || 1}</span><span class="stat-label">partes</span></div>
  `;
  
  elements.resultDate.textContent = formatDate(state.selectedDate);
  elements.btnShare.hidden = !navigator.share;
  showStep('result');
}

// ==============================================
// Date Selection
// ==============================================

function createDateCard(info) {
  const div = document.createElement('div');
  div.className = 'date-card';
  div.dataset.date = info.date;
  
  const isLarge = info.messageCount > FULL_MODE_THRESHOLD;
  
  div.innerHTML = `
    <div class="date-info">
      <span class="date-value">${formatDate(info.date)}</span>
      <span class="date-preview">${info.preview || ''}</span>
    </div>
    <div class="date-stats">
      <span class="message-count ${isLarge ? 'large' : ''}">${info.messageCount} msgs</span>
      <span class="participant-count">${info.participants} pessoas</span>
    </div>
  `;
  
  div.onclick = () => selectDate(info);
  return div;
}

function renderDates(dates, container, clear = true) {
  if (clear) container.innerHTML = '';
  dates.forEach(d => container.appendChild(createDateCard(d)));
}

function selectDate(info) {
  state.selectedDate = info.date;
  state.selectedDateInfo = info;
  
  document.querySelectorAll('.date-card').forEach(c => 
    c.classList.toggle('selected', c.dataset.date === info.date)
  );
  
  elements.selectedDateInfo.textContent = `${formatDate(info.date)} • ${info.messageCount} mensagens`;
  showStep('options');
}

// ==============================================
// File Upload
// ==============================================

async function handleFile(file) {
  if (!file) return;
  if (!file.name.endsWith('.txt') && file.type !== 'text/plain') {
    showToast('Selecione um arquivo .txt do WhatsApp', 'error');
    return;
  }
  
  try {
    showLoading('Analisando...');
    const result = await uploadFile(file);
    
    state.messagesByDate = result.messagesByDate;
    state.allDates = result.dates;
    
    elements.datesInfo.textContent = `${result.totalMessages.toLocaleString()} mensagens em ${result.totalDays} dias`;
    renderDates(result.dates.slice(0, 3), elements.recentDates);
    elements.loadMoreDates.hidden = result.totalDays <= 3;
    elements.allDates.hidden = true;
    
    hideLoading();
    showStep('dates');
  } catch (err) {
    hideLoading();
    showToast(err.message, 'error');
  }
}

async function handleSummarize() {
  const messages = state.messagesByDate[state.selectedDate];
  if (!messages?.length) {
    showToast('Nenhuma mensagem', 'error');
    return;
  }
  
  // Show modal for large conversations
  if (messages.length > FULL_MODE_THRESHOLD) {
    showModeModal(messages.length);
  } else {
    await startSummarization('quick');
  }
}

// ==============================================
// Event Listeners
// ==============================================

elements.uploadArea?.addEventListener('click', () => elements.fileInput?.click());
elements.fileInput?.addEventListener('change', e => handleFile(e.target.files[0]));

elements.uploadArea?.addEventListener('dragover', e => {
  e.preventDefault();
  elements.uploadArea.classList.add('dragover');
});
elements.uploadArea?.addEventListener('dragleave', () => elements.uploadArea.classList.remove('dragover'));
elements.uploadArea?.addEventListener('drop', e => {
  e.preventDefault();
  elements.uploadArea.classList.remove('dragover');
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

elements.levelOptions?.addEventListener('change', e => {
  if (e.target.name === 'level') {
    state.level = parseInt(e.target.value);
    document.querySelectorAll('#level-options .radio-card').forEach(c => 
      c.classList.toggle('selected', c.querySelector('input').checked)
    );
  }
});

elements.privacyOptions?.addEventListener('change', e => {
  if (e.target.name === 'privacy') {
    state.privacy = e.target.value;
    document.querySelectorAll('#privacy-options .radio-card').forEach(c => 
      c.classList.toggle('selected', c.querySelector('input').checked)
    );
  }
});

elements.btnSummarize?.addEventListener('click', handleSummarize);

elements.btnCopy?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(elements.summaryText.innerText);
    showToast('Copiado!', 'success');
  } catch { showToast('Erro ao copiar', 'error'); }
});

elements.btnShare?.addEventListener('click', async () => {
  try {
    await navigator.share({ title: `Resumo - ${formatDateShort(state.selectedDate)}`, text: elements.summaryText.innerText });
  } catch {}
});

// ==============================================
// Initialize
// ==============================================

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

(async function init() {
  const content = sessionStorage.getItem('sharedFileContent');
  const name = sessionStorage.getItem('sharedFileName');
  if (content && name) {
    sessionStorage.removeItem('sharedFileContent');
    sessionStorage.removeItem('sharedFileName');
    await handleFile(new File([content], name, { type: 'text/plain' }));
  }
  console.log('App initialized');
})();
