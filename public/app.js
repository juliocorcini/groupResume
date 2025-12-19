/**
 * WhatsApp Group Summarizer - Frontend Application
 * Refactored to work with serverless (no persistent storage on server)
 */

// ==============================================
// State - Now stores all data client-side
// ==============================================
const state = {
  messagesByDate: {},  // All messages grouped by date
  allDates: [],        // All available dates
  selectedDate: null,
  level: 3,
  privacy: 'smart'
};

// ==============================================
// DOM Elements
// ==============================================
const elements = {
  // Steps
  stepUpload: document.getElementById('step-upload'),
  stepDates: document.getElementById('step-dates'),
  stepOptions: document.getElementById('step-options'),
  stepResult: document.getElementById('step-result'),
  
  // Upload
  uploadArea: document.getElementById('upload-area'),
  fileInput: document.getElementById('file-input'),
  
  // Dates
  datesInfo: document.getElementById('dates-info'),
  recentDates: document.getElementById('recent-dates'),
  allDates: document.getElementById('all-dates'),
  loadMoreDates: document.getElementById('load-more-dates'),
  btnBackUpload: document.getElementById('btn-back-upload'),
  
  // Options
  selectedDateInfo: document.getElementById('selected-date-info'),
  levelOptions: document.getElementById('level-options'),
  privacyOptions: document.getElementById('privacy-options'),
  btnBackDates: document.getElementById('btn-back-dates'),
  btnSummarize: document.getElementById('btn-summarize'),
  
  // Result
  resultDate: document.getElementById('result-date'),
  summaryText: document.getElementById('summary-text'),
  summaryStats: document.getElementById('summary-stats'),
  btnCopy: document.getElementById('btn-copy'),
  btnShare: document.getElementById('btn-share'),
  btnNewDate: document.getElementById('btn-new-date'),
  
  // Loading & Toast
  loading: document.getElementById('loading'),
  loadingText: document.getElementById('loading-text'),
  toast: document.getElementById('toast')
};

// ==============================================
// Utilities
// ==============================================

function showStep(stepName) {
  const steps = ['step-upload', 'step-dates', 'step-options', 'step-result'];
  steps.forEach(s => {
    const el = document.getElementById(s);
    el.classList.toggle('active', s === `step-${stepName}`);
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
  
  setTimeout(() => {
    elements.toast.hidden = true;
  }, 4000);
}

function formatDate(dateStr) {
  const [year, month, day] = dateStr.split('-');
  const date = new Date(year, month - 1, day);
  const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  return date.toLocaleDateString('pt-BR', options);
}

function formatDateShort(dateStr) {
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

// ==============================================
// API Calls
// ==============================================

async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to upload file');
  }
  
  return response.json();
}

async function generateSummary(messages, date) {
  const response = await fetch('/api/summarize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messages,
      date,
      level: state.level,
      privacy: state.privacy
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to generate summary');
  }
  
  return response.json();
}

// ==============================================
// Date Cards
// ==============================================

function createDateCard(dateInfo, isSelected = false) {
  const div = document.createElement('div');
  div.className = `date-card${isSelected ? ' selected' : ''}`;
  div.dataset.date = dateInfo.date;
  
  div.innerHTML = `
    <div class="date-info">
      <span class="date-value">${formatDate(dateInfo.date)}</span>
      <span class="date-preview">${dateInfo.preview || ''}</span>
    </div>
    <div class="date-stats">
      <span class="message-count">${dateInfo.messageCount} mensagens</span>
      <span class="participant-count">${dateInfo.participants} participantes</span>
    </div>
  `;
  
  div.addEventListener('click', () => selectDate(dateInfo));
  
  return div;
}

function renderDates(dates, container, clear = true) {
  if (clear) {
    container.innerHTML = '';
  }
  
  dates.forEach(dateInfo => {
    const card = createDateCard(dateInfo);
    container.appendChild(card);
  });
}

function selectDate(dateInfo) {
  state.selectedDate = dateInfo.date;
  
  // Update UI
  document.querySelectorAll('.date-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.date === dateInfo.date);
  });
  
  // Update options header
  elements.selectedDateInfo.textContent = 
    `${formatDate(dateInfo.date)} • ${dateInfo.messageCount} mensagens`;
  
  // Go to options step
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
    
    // Store all data client-side
    state.messagesByDate = result.messagesByDate;
    state.allDates = result.dates;
    
    // Update dates info
    elements.datesInfo.textContent = 
      `${result.totalMessages.toLocaleString()} mensagens em ${result.totalDays} dias`;
    
    // Render first 3 dates
    const recentDates = result.dates.slice(0, 3);
    renderDates(recentDates, elements.recentDates);
    
    // Show load more button if there are more dates
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
// Summary
// ==============================================

async function handleSummarize() {
  try {
    // Get messages for selected date from client-side storage
    const messages = state.messagesByDate[state.selectedDate];
    
    if (!messages || messages.length === 0) {
      showToast('Nenhuma mensagem encontrada para esta data', 'error');
      return;
    }
    
    showLoading('Gerando resumo com IA...');
    
    const result = await generateSummary(messages, state.selectedDate);
    
    // Format and display summary
    elements.summaryText.innerHTML = formatSummary(result.summary);
    
    // Display stats
    elements.summaryStats.innerHTML = `
      <div class="stat-item">
        <span class="stat-value">${result.stats.totalMessages}</span>
        <span class="stat-label">mensagens</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">${result.stats.participants}</span>
        <span class="stat-label">participantes</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">${result.stats.chunks}</span>
        <span class="stat-label">partes processadas</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">${(result.stats.processingTime / 1000).toFixed(1)}s</span>
        <span class="stat-label">tempo</span>
      </div>
    `;
    
    // Update result header
    elements.resultDate.textContent = formatDate(state.selectedDate);
    
    // Show share button if available
    elements.btnShare.hidden = !navigator.share;
    
    hideLoading();
    showStep('result');
    
  } catch (error) {
    hideLoading();
    showToast(error.message, 'error');
  }
}

function formatSummary(text) {
  // Convert markdown-like formatting to HTML
  return text
    .replace(/##\s*(.+)/g, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>');
}

// ==============================================
// Event Listeners
// ==============================================

// Upload area
elements.uploadArea.addEventListener('click', () => {
  elements.fileInput.click();
});

elements.fileInput.addEventListener('change', (e) => {
  handleFile(e.target.files[0]);
});

// Drag and drop
elements.uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  elements.uploadArea.classList.add('dragover');
});

elements.uploadArea.addEventListener('dragleave', () => {
  elements.uploadArea.classList.remove('dragover');
});

elements.uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  elements.uploadArea.classList.remove('dragover');
  handleFile(e.dataTransfer.files[0]);
});

// Load more dates - now uses client-side data
elements.loadMoreDates.addEventListener('click', () => {
  // Hide load more button, show all dates
  elements.loadMoreDates.hidden = true;
  elements.allDates.hidden = false;
  
  // Render remaining dates (skip first 3 which are already shown)
  renderDates(state.allDates.slice(3), elements.allDates);
});

// Navigation
elements.btnBackUpload.addEventListener('click', () => {
  state.messagesByDate = {};
  state.allDates = [];
  elements.fileInput.value = '';
  showStep('upload');
});

elements.btnBackDates.addEventListener('click', () => {
  showStep('dates');
});

elements.btnNewDate.addEventListener('click', () => {
  showStep('dates');
});

// Options - Level
elements.levelOptions.addEventListener('change', (e) => {
  if (e.target.name === 'level') {
    state.level = parseInt(e.target.value);
    
    // Update selected state
    document.querySelectorAll('#level-options .radio-card').forEach(card => {
      const input = card.querySelector('input');
      card.classList.toggle('selected', input.checked);
    });
  }
});

// Options - Privacy
elements.privacyOptions.addEventListener('change', (e) => {
  if (e.target.name === 'privacy') {
    state.privacy = e.target.value;
    
    // Update selected state
    document.querySelectorAll('#privacy-options .radio-card').forEach(card => {
      const input = card.querySelector('input');
      card.classList.toggle('selected', input.checked);
    });
  }
});

// Summarize button
elements.btnSummarize.addEventListener('click', handleSummarize);

// Copy button
elements.btnCopy.addEventListener('click', async () => {
  const text = elements.summaryText.innerText;
  
  try {
    await navigator.clipboard.writeText(text);
    showToast('Resumo copiado!', 'success');
  } catch {
    showToast('Não foi possível copiar', 'error');
  }
});

// Share button
elements.btnShare.addEventListener('click', async () => {
  const text = elements.summaryText.innerText;
  const title = `Resumo do grupo - ${formatDateShort(state.selectedDate)}`;
  
  try {
    await navigator.share({
      title,
      text
    });
  } catch {
    // User cancelled or error
  }
});

// ==============================================
// PWA & Service Worker
// ==============================================

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
    .then(() => console.log('Service Worker registered'))
    .catch(err => console.error('SW registration failed:', err));
}

// ==============================================
// Initialize
// ==============================================

async function init() {
  // Check if there's a shared file in session storage (from Share Target)
  const sharedContent = sessionStorage.getItem('sharedFileContent');
  const sharedFileName = sessionStorage.getItem('sharedFileName');
  
  if (sharedContent && sharedFileName) {
    sessionStorage.removeItem('sharedFileContent');
    sessionStorage.removeItem('sharedFileName');
    
    // Create a File object from the shared content
    const file = new File([sharedContent], sharedFileName, { type: 'text/plain' });
    
    // Process the file
    await handleFile(file);
  }
  
  console.log('WhatsApp Group Summarizer initialized');
}

// Run initialization
init();
