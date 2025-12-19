/**
 * WhatsApp Group Summarizer - Frontend Application
 */

// ==============================================
// Constants
// ==============================================
const MODEL_LIMITS = {
  fast: 80,
  balanced: 120,
  powerful: 250
};
const DEFAULT_MODEL = 'powerful';
const FULL_MODE_THRESHOLD = 250;

// Time slider config: minutes -> max messages
const TIME_TO_MSGS = {
  1: 3000,
  2: 6000,
  3: 9000,
  4: 12000,
  5: 15000,
  6: 18000,
  7: 21000,
  8: 24000,
  9: 27000,
  10: 30000
};

// Sampling: messages per day in sampling mode
const MSGS_PER_DAY_SAMPLING = 300;

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
  model: DEFAULT_MODEL,
  // Group analysis state
  analysisMode: 'day', // 'day' or 'group'
  analysisTime: 2, // minutes
  collectionMode: 'complete', // 'complete' or 'sampling'
  selectedDaysForAnalysis: [],
  analysisStyle: 'roast',
  maxMessages: 6000
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
  stepGroupAnalysis: $('step-group-analysis'),
  stepGroupResult: $('step-group-result'),
  uploadArea: $('upload-area'),
  fileInput: $('file-input'),
  datesInfo: $('dates-info'),
  recentDates: $('recent-dates'),
  allDates: $('all-dates'),
  loadMoreDates: $('load-more-dates'),
  btnBackUpload: $('btn-back-upload'),
  btnDaySummary: $('btn-day-summary'),
  btnGroupAnalysis: $('btn-group-analysis'),
  daySelectionContainer: $('day-selection-container'),
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
  tokenBar: $('token-bar'),
  // Group analysis elements
  timeSlider: $('time-slider'),
  timeLabel: $('time-label'),
  msgsLabel: $('msgs-label'),
  completeEstimate: $('complete-estimate'),
  samplingEstimate: $('sampling-estimate'),
  limitFill: $('limit-fill'),
  limitText: $('limit-text'),
  daysChecklist: $('days-checklist'),
  styleOptions: $('style-options'),
  btnBackFromAnalysis: $('btn-back-from-analysis'),
  btnStartAnalysis: $('btn-start-analysis'),
  analysisDaysInfo: $('analysis-days-info'),
  analysisText: $('analysis-text'),
  topTalkers: $('top-talkers'),
  activityChart: $('activity-chart'),
  topEmojis: $('top-emojis'),
  vibeScore: $('vibe-score'),
  btnCopyAnalysis: $('btn-copy-analysis'),
  btnShareAnalysis: $('btn-share-analysis'),
  btnNewAnalysis: $('btn-new-analysis')
};

// ==============================================
// Utilities
// ==============================================

function showStep(name) {
  ['upload', 'dates', 'options', 'result', 'group-analysis', 'group-result'].forEach(s => {
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
  // If too many summaries, merge in batches of 3
  if (summaries.length > 4) {
    const batches = [];
    for (let i = 0; i < summaries.length; i += 3) {
      batches.push(summaries.slice(i, i + 3));
    }
    
    // First pass: merge each batch
    const firstPassResults = [];
    for (const batch of batches) {
      if (batch.length === 1) {
        firstPassResults.push(batch[0]);
      } else {
        const res = await fetch('/api/merge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ summaries: batch, level: state.level, privacy: state.privacy })
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Erro ao combinar');
        const data = await res.json();
        firstPassResults.push(data.summary);
      }
    }
    
    // If still too many, merge again
    if (firstPassResults.length > 3) {
      return mergeSummaries(firstPassResults);
    }
    
    // Final merge
    summaries = firstPassResults;
  }
  
  const res = await fetch('/api/merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ summaries, level: state.level, privacy: state.privacy })
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Erro ao combinar');
  return res.json();
}

async function analyzeGroup(messages, style) {
  const res = await fetch('/api/analyze-group', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, style, privacy: state.privacy })
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Erro ao analisar');
  return res.json();
}

// ==============================================
// Smart Sampling - Groups messages into conversation blocks
// ==============================================

function parseTime(msg) {
  // Parse time from message format "HH:MM" or similar
  const timeMatch = msg.time?.match(/(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    return parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2]);
  }
  return 0;
}

function groupIntoBlocks(messages, maxGapMinutes = 5) {
  if (!messages.length) return [];
  
  const blocks = [];
  let currentBlock = [messages[0]];
  
  for (let i = 1; i < messages.length; i++) {
    const prevTime = parseTime(messages[i - 1]);
    const currTime = parseTime(messages[i]);
    const gap = currTime - prevTime;
    
    // If gap is more than maxGapMinutes, start new block
    if (gap > maxGapMinutes || gap < 0) { // gap < 0 means next day
      blocks.push(currentBlock);
      currentBlock = [messages[i]];
    } else {
      currentBlock.push(messages[i]);
    }
  }
  
  if (currentBlock.length > 0) {
    blocks.push(currentBlock);
  }
  
  return blocks;
}

function smartSample(dayMessages, targetMsgs) {
  if (dayMessages.length <= targetMsgs) {
    return dayMessages;
  }
  
  // Group into conversation blocks
  const blocks = groupIntoBlocks(dayMessages, 5);
  
  // Sort blocks by size (larger = more important conversations)
  const sortedBlocks = [...blocks].sort((a, b) => b.length - a.length);
  
  // Select blocks ensuring we get beginning, middle, and end of day
  const result = [];
  let totalMsgs = 0;
  
  // First, ensure we get some from beginning and end
  const firstBlock = blocks[0];
  const lastBlock = blocks[blocks.length - 1];
  
  if (firstBlock && totalMsgs + firstBlock.length <= targetMsgs) {
    result.push(...firstBlock);
    totalMsgs += firstBlock.length;
  }
  
  if (lastBlock && lastBlock !== firstBlock && totalMsgs + lastBlock.length <= targetMsgs) {
    result.push(...lastBlock);
    totalMsgs += lastBlock.length;
  }
  
  // Fill remaining with largest blocks
  for (const block of sortedBlocks) {
    if (block === firstBlock || block === lastBlock) continue;
    if (totalMsgs + block.length <= targetMsgs) {
      result.push(...block);
      totalMsgs += block.length;
    } else if (totalMsgs < targetMsgs) {
      // Partial block to fill remaining space
      result.push(...block.slice(0, targetMsgs - totalMsgs));
      break;
    }
  }
  
  // Sort by original order (time)
  return result.sort((a, b) => parseTime(a) - parseTime(b));
}

// ==============================================
// Statistics Calculation
// ==============================================

function calculateStats(messages) {
  const stats = {
    topTalkers: [],
    activityByHour: new Array(24).fill(0),
    topEmojis: [],
    totalMessages: messages.length
  };
  
  // Count messages per sender
  const senderCounts = {};
  const emojiCounts = {};
  const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
  
  for (const msg of messages) {
    if (msg.sender && msg.sender !== '__system__') {
      senderCounts[msg.sender] = (senderCounts[msg.sender] || 0) + 1;
    }
    
    // Count activity by hour
    const hour = parseInt(msg.time?.split(':')[0] || 0);
    if (hour >= 0 && hour < 24) {
      stats.activityByHour[hour]++;
    }
    
    // Count emojis
    const emojis = msg.content?.match(emojiRegex) || [];
    for (const emoji of emojis) {
      emojiCounts[emoji] = (emojiCounts[emoji] || 0) + 1;
    }
  }
  
  // Top talkers
  stats.topTalkers = Object.entries(senderCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));
  
  // Top emojis
  stats.topEmojis = Object.entries(emojiCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([emoji, count]) => ({ emoji, count }));
  
  return stats;
}

// ==============================================
// Group Analysis UI
// ==============================================

function updateTimeSlider() {
  const minutes = parseInt(elements.timeSlider?.value || 2);
  state.analysisTime = minutes;
  state.maxMessages = TIME_TO_MSGS[minutes];
  
  if (elements.timeLabel) {
    elements.timeLabel.textContent = `${minutes} minuto${minutes > 1 ? 's' : ''}`;
  }
  if (elements.msgsLabel) {
    elements.msgsLabel.textContent = `~${state.maxMessages.toLocaleString()} mensagens`;
  }
  
  updateModeEstimates();
  updateDaysChecklist();
}

function updateModeEstimates() {
  if (!state.allDates.length) return;
  
  // Calculate based on actual day sizes
  let completeTotal = 0;
  let completeDays = 0;
  let samplingTotal = 0;
  let samplingDays = 0;
  
  // Sort by date (most recent first) and calculate
  const sortedDates = [...state.allDates].sort((a, b) => b.date.localeCompare(a.date));
  
  for (const day of sortedDates) {
    // Complete mode: all messages
    if (completeTotal + day.messageCount <= state.maxMessages) {
      completeTotal += day.messageCount;
      completeDays++;
    }
    
    // Sampling mode: max 300 per day
    const sampledMsgs = Math.min(day.messageCount, MSGS_PER_DAY_SAMPLING);
    if (samplingTotal + sampledMsgs <= state.maxMessages) {
      samplingTotal += sampledMsgs;
      samplingDays++;
    }
  }
  
  if (elements.completeEstimate) {
    elements.completeEstimate.textContent = `~${completeDays} dias completos`;
  }
  
  if (elements.samplingEstimate) {
    if (samplingDays <= completeDays) {
      elements.samplingEstimate.textContent = `~${samplingDays} dias (sem vantagem)`;
    } else {
      elements.samplingEstimate.textContent = `~${samplingDays} dias (${samplingDays - completeDays} a mais!)`;
    }
  }
}

function updateDaysChecklist() {
  if (!elements.daysChecklist) return;
  
  const isSampling = state.collectionMode === 'sampling';
  const msgsPerDay = isSampling ? MSGS_PER_DAY_SAMPLING : null;
  
  // Calculate how many messages each day would contribute
  let usedMsgs = 0;
  state.selectedDaysForAnalysis = [];
  
  elements.daysChecklist.innerHTML = '';
  
  const maxMsgCount = Math.max(...state.allDates.map(d => d.messageCount));
  
  for (const dateInfo of state.allDates) {
    const msgsForThisDay = isSampling 
      ? Math.min(dateInfo.messageCount, MSGS_PER_DAY_SAMPLING)
      : dateInfo.messageCount;
    
    const wouldExceed = usedMsgs + msgsForThisDay > state.maxMessages;
    const isDisabled = wouldExceed && !state.selectedDaysForAnalysis.includes(dateInfo.date);
    
    const item = document.createElement('label');
    item.className = `day-check-item${isDisabled ? ' disabled' : ''}`;
    item.dataset.date = dateInfo.date;
    item.dataset.msgs = msgsForThisDay;
    
    const barWidth = (dateInfo.messageCount / maxMsgCount) * 100;
    
    item.innerHTML = `
      <input type="checkbox" ${isDisabled ? 'disabled' : ''}>
      <div class="day-check-info">
        <span class="day-check-date">${formatDate(dateInfo.date)}</span>
        <span class="day-check-msgs">${dateInfo.messageCount} msgs${isSampling ? ` → ${msgsForThisDay}` : ''}</span>
      </div>
      <div class="day-check-bar">
        <div class="day-check-bar-fill" style="width: ${barWidth}%"></div>
      </div>
    `;
    
    const checkbox = item.querySelector('input');
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        state.selectedDaysForAnalysis.push(dateInfo.date);
      } else {
        state.selectedDaysForAnalysis = state.selectedDaysForAnalysis.filter(d => d !== dateInfo.date);
      }
      item.classList.toggle('selected', checkbox.checked);
      updateLimitBar();
      updateDaysChecklistDisabled();
    });
    
    elements.daysChecklist.appendChild(item);
  }
  
  updateLimitBar();
}

function updateDaysChecklistDisabled() {
  const isSampling = state.collectionMode === 'sampling';
  let usedMsgs = 0;
  
  // Calculate currently used messages
  for (const date of state.selectedDaysForAnalysis) {
    const dateInfo = state.allDates.find(d => d.date === date);
    if (dateInfo) {
      usedMsgs += isSampling 
        ? Math.min(dateInfo.messageCount, MSGS_PER_DAY_SAMPLING)
        : dateInfo.messageCount;
    }
  }
  
  // Update disabled state for each item
  document.querySelectorAll('.day-check-item').forEach(item => {
    const date = item.dataset.date;
    const msgs = parseInt(item.dataset.msgs);
    const checkbox = item.querySelector('input');
    const isSelected = state.selectedDaysForAnalysis.includes(date);
    
    if (!isSelected && usedMsgs + msgs > state.maxMessages) {
      item.classList.add('disabled');
      checkbox.disabled = true;
    } else {
      item.classList.remove('disabled');
      checkbox.disabled = false;
    }
  });
}

function updateLimitBar() {
  const isSampling = state.collectionMode === 'sampling';
  let usedMsgs = 0;
  
  for (const date of state.selectedDaysForAnalysis) {
    const dateInfo = state.allDates.find(d => d.date === date);
    if (dateInfo) {
      usedMsgs += isSampling 
        ? Math.min(dateInfo.messageCount, MSGS_PER_DAY_SAMPLING)
        : dateInfo.messageCount;
    }
  }
  
  const pct = Math.min((usedMsgs / state.maxMessages) * 100, 100);
  
  if (elements.limitFill) {
    elements.limitFill.style.width = `${pct}%`;
    elements.limitFill.classList.remove('warning', 'full');
    if (pct >= 100) elements.limitFill.classList.add('full');
    else if (pct >= 80) elements.limitFill.classList.add('warning');
  }
  
  if (elements.limitText) {
    elements.limitText.textContent = `${usedMsgs.toLocaleString()} / ${state.maxMessages.toLocaleString()} mensagens`;
  }
}

function showGroupAnalysisStep() {
  state.analysisMode = 'group';
  state.selectedDaysForAnalysis = [];
  updateTimeSlider();
  showStep('group-analysis');
}

// ==============================================
// Group Analysis Processing
// ==============================================

async function startGroupAnalysis() {
  if (state.selectedDaysForAnalysis.length === 0) {
    showToast('Selecione pelo menos um dia', 'error');
    return;
  }
  
  const isSampling = state.collectionMode === 'sampling';
  let allMessages = [];
  
  // Collect messages from selected days
  for (const date of state.selectedDaysForAnalysis) {
    const dayMsgs = state.messagesByDate[date] || [];
    if (isSampling) {
      allMessages.push(...smartSample(dayMsgs, MSGS_PER_DAY_SAMPLING));
    } else {
      allMessages.push(...dayMsgs);
    }
  }
  
  if (allMessages.length === 0) {
    showToast('Nenhuma mensagem encontrada', 'error');
    return;
  }
  
  // Calculate stats before sending to API
  const stats = calculateStats(allMessages);
  
  try {
    showLoading('Analisando o grupo...');
    
    // Process in smaller chunks for analysis (150 msgs to avoid timeout)
    const ANALYSIS_CHUNK_SIZE = 150;
    const chunks = [];
    for (let i = 0; i < allMessages.length; i += ANALYSIS_CHUNK_SIZE) {
      chunks.push(allMessages.slice(i, i + ANALYSIS_CHUNK_SIZE));
    }
    
    if (chunks.length === 1) {
      // Single chunk - direct analysis
      const result = await analyzeGroup(chunks[0], state.analysisStyle);
      displayGroupResult(result.analysis, result.vibeScore, stats);
    } else {
      // Multiple chunks - process and merge
      showProgressUI(chunks.length);
      const summaries = [];
      
      for (let i = 0; i < chunks.length; i++) {
        updateProgressUI(i, chunks.length, `Analisando parte ${i + 1}/${chunks.length}...`);
        const result = await analyzeGroup(chunks[i], state.analysisStyle);
        summaries.push(result.analysis);
      }
      
      updateProgressUI(chunks.length, chunks.length, 'Combinando análises...');
      const mergeResult = await mergeSummaries(summaries);
      
      // Get vibe score from last chunk (or calculate average)
      const lastResult = await analyzeGroup(chunks[chunks.length - 1], state.analysisStyle);
      displayGroupResult(mergeResult.summary, lastResult.vibeScore, stats);
    }
  } catch (err) {
    hideLoading();
    showToast(err.message, 'error');
  }
}

function displayGroupResult(analysis, vibeScore, stats) {
  hideLoading();
  
  // Days info
  if (elements.analysisDaysInfo) {
    elements.analysisDaysInfo.textContent = `${state.selectedDaysForAnalysis.length} dias analisados • ${stats.totalMessages.toLocaleString()} mensagens`;
  }
  
  // Analysis text
  if (elements.analysisText) {
    elements.analysisText.innerHTML = analysis
      .replace(/##\s*(.+)/g, '<h2>$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/^/, '<p>').replace(/$/, '</p>');
  }
  
  // Top talkers
  if (elements.topTalkers && stats.topTalkers.length > 0) {
    const maxCount = stats.topTalkers[0].count;
    elements.topTalkers.innerHTML = stats.topTalkers.map((t, i) => {
      const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
      const barWidth = (t.count / maxCount) * 100;
      return `
        <div class="talker-item">
          <span class="talker-rank ${rankClass}">${i + 1}</span>
          <span class="talker-name">${t.name}</span>
          <div class="talker-bar"><div class="talker-bar-fill" style="width: ${barWidth}%"></div></div>
          <span class="talker-count">${t.count}</span>
        </div>
      `;
    }).join('');
  }
  
  // Activity chart
  if (elements.activityChart) {
    const maxActivity = Math.max(...stats.activityByHour);
    elements.activityChart.innerHTML = stats.activityByHour.map((count, hour) => {
      const height = maxActivity > 0 ? (count / maxActivity) * 100 : 0;
      return `<div class="activity-bar" style="height: ${Math.max(height, 5)}%" title="${hour}h: ${count} msgs"></div>`;
    }).join('') + `
      <div class="activity-labels">
        <span>0h</span>
        <span>6h</span>
        <span>12h</span>
        <span>18h</span>
        <span>23h</span>
      </div>
    `;
  }
  
  // Top emojis
  if (elements.topEmojis && stats.topEmojis.length > 0) {
    elements.topEmojis.innerHTML = stats.topEmojis.map(e => `
      <div class="emoji-item">
        <span class="emoji-char">${e.emoji}</span>
        <span class="emoji-count">${e.count}</span>
      </div>
    `).join('');
  }
  
  // Vibe score
  if (elements.vibeScore) {
    const score = vibeScore || Math.floor(Math.random() * 3) + 7; // Fallback 7-9
    const vibeLabels = {
      1: 'Grupo morto 💀',
      2: 'Bem parado',
      3: 'Meio devagar',
      4: 'Tranquilo',
      5: 'Na média',
      6: 'Ativo',
      7: 'Animado!',
      8: 'Muito ativo! 🔥',
      9: 'Caótico! 🎉',
      10: 'LENDÁRIO! 🚀'
    };
    elements.vibeScore.innerHTML = `
      <div class="vibe-number">${score}/10</div>
      <div class="vibe-label">${vibeLabels[score] || 'Grupo interessante'}</div>
      <div class="vibe-bar"><div class="vibe-bar-fill" style="width: ${score * 10}%"></div></div>
    `;
  }
  
  elements.btnShareAnalysis.hidden = !navigator.share;
  showStep('group-result');
}

// ==============================================
// Mode Selection Modal (for day summary)
// ==============================================

function showModeModal(messageCount) {
  const chunkSize = MODEL_LIMITS[state.model];
  const chunks = Math.ceil(messageCount / chunkSize);
  const estimatedTime = chunks * 5 + 5;
  
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
// Summarization (Day mode)
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
    
    if (messages.length > maxMsgs) {
      toProcess = smartSample(messages, maxMsgs);
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
  const TPM_LIMIT = 70000;
  
  try {
    for (let i = 0; i < chunks.length; i++) {
      updateProgressUI(i, chunks.length, `Parte ${i + 1}/${chunks.length}...`);
      
      const result = await summarizeChunk(chunks[i], true);
      summaries.push(result.summary);
      tokensUsed += result.stats?.tokensUsed || 0;
      
      if (tokensUsed > TPM_LIMIT * 0.9 && i < chunks.length - 1) {
        updateProgressUI(i + 1, chunks.length, 'Aguardando reset de tokens...');
        await new Promise(r => setTimeout(r, 60000));
        tokensUsed = 0;
      }
    }
    
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

async function extractTxtFromZip(zipFile) {
  try {
    const zip = await JSZip.loadAsync(zipFile);
    
    let largestTxt = null;
    let largestSize = 0;
    
    for (const [filename, file] of Object.entries(zip.files)) {
      if (filename.endsWith('.txt') && !file.dir) {
        const content = await file.async('string');
        if (content.length > largestSize) {
          largestSize = content.length;
          largestTxt = { name: filename, content };
        }
      }
    }
    
    if (!largestTxt) {
      throw new Error('Nenhum arquivo .txt encontrado no ZIP');
    }
    
    console.log(`Extracted ${largestTxt.name} (${(largestSize / 1024).toFixed(1)} KB) from ZIP`);
    return largestTxt;
  } catch (err) {
    throw new Error('Erro ao extrair ZIP: ' + err.message);
  }
}

async function handleFile(file) {
  if (!file) return;
  
  const isZip = file.name.endsWith('.zip') || file.type === 'application/zip';
  const isTxt = file.name.endsWith('.txt') || file.type === 'text/plain';
  
  if (!isZip && !isTxt) {
    showToast('Selecione um arquivo .txt ou .zip do WhatsApp', 'error');
    return;
  }
  
  if (isZip) {
    try {
      showLoading('Extraindo arquivo do ZIP...');
      const extracted = await extractTxtFromZip(file);
      file = new File([extracted.content], extracted.name, { type: 'text/plain' });
      showToast(`Extraído: ${extracted.name}`, 'success');
    } catch (err) {
      hideLoading();
      showToast(err.message, 'error');
      return;
    }
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
    
    // Reset action choice
    elements.btnDaySummary?.classList.add('selected');
    elements.btnGroupAnalysis?.classList.remove('selected');
    if (elements.daySelectionContainer) {
      elements.daySelectionContainer.style.display = 'block';
    }
    
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

// Action choice (Day vs Group)
elements.btnDaySummary?.addEventListener('click', () => {
  state.analysisMode = 'day';
  elements.btnDaySummary.classList.add('selected');
  elements.btnGroupAnalysis?.classList.remove('selected');
  if (elements.daySelectionContainer) {
    elements.daySelectionContainer.style.display = 'block';
  }
});

elements.btnGroupAnalysis?.addEventListener('click', () => {
  elements.btnGroupAnalysis.classList.add('selected');
  elements.btnDaySummary?.classList.remove('selected');
  showGroupAnalysisStep();
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

// Group Analysis Event Listeners
elements.timeSlider?.addEventListener('input', updateTimeSlider);

document.querySelectorAll('[name="collection-mode"]').forEach(radio => {
  radio.addEventListener('change', e => {
    state.collectionMode = e.target.value;
    document.querySelectorAll('.mode-option').forEach(opt => 
      opt.classList.toggle('selected', opt.dataset.mode === state.collectionMode)
    );
    state.selectedDaysForAnalysis = [];
    updateDaysChecklist();
  });
});

elements.styleOptions?.addEventListener('change', e => {
  if (e.target.name === 'analysis-style') {
    state.analysisStyle = e.target.value;
    document.querySelectorAll('#style-options .radio-card').forEach(c => 
      c.classList.toggle('selected', c.querySelector('input').checked)
    );
  }
});

elements.btnBackFromAnalysis?.addEventListener('click', () => showStep('dates'));
elements.btnStartAnalysis?.addEventListener('click', startGroupAnalysis);

elements.btnCopyAnalysis?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(elements.analysisText.innerText);
    showToast('Copiado!', 'success');
  } catch { showToast('Erro ao copiar', 'error'); }
});

elements.btnShareAnalysis?.addEventListener('click', async () => {
  try {
    await navigator.share({ title: 'Análise do Grupo', text: elements.analysisText.innerText });
  } catch {}
});

elements.btnNewAnalysis?.addEventListener('click', () => {
  state.selectedDaysForAnalysis = [];
  showStep('dates');
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
