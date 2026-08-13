// ===== State Management =====
const STORAGE_KEYS = {
  WORDS: 'vocab_words',
  SETTINGS: 'vocab_settings',
  REVIEW_QUEUE: 'vocab_review_queue',
  REVIEW_STATS: 'vocab_review_stats',
};

function loadWords() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.WORDS) || '[]'); }
  catch { return []; }
}

function saveWords(words) {
  localStorage.setItem(STORAGE_KEYS.WORDS, JSON.stringify(words));
}

function loadSettings() {
  const defaults = { defaultCount: 20, defaultOrder: 'english-first' };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS) || '{}') }; }
  catch { return defaults; }
}

function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
}

function loadReviewQueue() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.REVIEW_QUEUE) || '[]'); }
  catch { return []; }
}

function saveReviewQueue(queue) {
  localStorage.setItem(STORAGE_KEYS.REVIEW_QUEUE, JSON.stringify(queue));
}

function loadReviewStats() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.REVIEW_STATS) || '{}'); }
  catch { return {}; }
}

function saveReviewStats(stats) {
  localStorage.setItem(STORAGE_KEYS.REVIEW_STATS, JSON.stringify(stats));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ===== Toast =====
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2200);
}

// ===== Tab Navigation =====
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'list') renderWordList();
    if (tab.dataset.tab === 'review') updateReviewInfo();
    if (tab.dataset.tab === 'add') updateStats();
    if (tab.dataset.tab === 'settings') updateSettingsUI();
  });
});

// ===== Input Parsing =====
function parseLine(line) {
  line = line.trim();
  if (!line) return null;

  // Known delimiters (try longer ones first to avoid partial matches)
  const delimiters = [' - ', ' – ', ' — ', ' — ', ' = ', ': ', '：', '\t', ' | '];
  for (const delim of delimiters) {
    const idx = line.indexOf(delim);
    if (idx > 0) {
      const eng = line.substring(0, idx).trim();
      const chn = line.substring(idx + delim.length).trim();
      if (eng && chn) return { english: eng, chinese: chn };
    }
  }

  // Try to split at the boundary between ASCII and non-ASCII (space before Chinese)
  const match = line.match(/^(.+?)\s+([^\x00-\x7F].*)$/);
  if (match && match[1].trim() && match[2].trim()) {
    return { english: match[1].trim(), chinese: match[2].trim() };
  }

  // Single space split as last resort
  const spaceIdx = line.indexOf(' ');
  if (spaceIdx > 0) {
    return { english: line.substring(0, spaceIdx).trim(), chinese: line.substring(spaceIdx + 1).trim() };
  }

  return null;
}

function parseInput(text) {
  const lines = text.split('\n');
  const results = [];
  const errors = [];
  lines.forEach((line, i) => {
    const parsed = parseLine(line);
    if (parsed) {
      results.push(parsed);
    } else if (line.trim()) {
      errors.push({ line: i + 1, text: line.trim() });
    }
  });
  return { results, errors };
}

// ===== Add Tab =====
const inputArea = document.getElementById('input-area');
let previewData = [];

document.getElementById('btn-preview').addEventListener('click', () => {
  const { results, errors } = parseInput(inputArea.value);
  previewData = results;
  const previewCard = document.getElementById('preview-card');
  const previewList = document.getElementById('preview-list');

  if (results.length === 0) {
    previewList.innerHTML = '<p style="color:var(--text-light);text-align:center;padding:20px 0;">未识别到有效词组，请检查格式</p>';
    previewCard.style.display = 'block';
    return;
  }

  previewList.innerHTML = results.map(r =>
    `<div class="preview-item"><span class="eng">${escapeHtml(r.english)}</span><span class="arrow">→</span><span class="chn">${escapeHtml(r.chinese)}</span></div>`
  ).join('');

  if (errors.length > 0) {
    previewList.innerHTML += `<div style="color:var(--danger);font-size:13px;padding:8px 0;">${errors.length} 行无法解析，已跳过</div>`;
  }

  previewCard.style.display = 'block';
  showToast(`解析成功：${results.length} 个词组`);
});

document.getElementById('btn-add').addEventListener('click', () => {
  const text = inputArea.value.trim();
  if (!text) { showToast('请先输入词汇'); return; }

  const { results } = parseInput(text);
  if (results.length === 0) { showToast('未识别到有效词组'); return; }

  const words = loadWords();
  const today = todayKey();
  let added = 0;
  let duplicates = 0;

  results.forEach(r => {
    // Check for duplicates (case-insensitive English)
    const exists = words.some(w => w.english.toLowerCase() === r.english.toLowerCase());
    if (exists) {
      duplicates++;
      return;
    }
    words.push({
      id: genId(),
      english: r.english,
      chinese: r.chinese,
      createdAt: new Date().toISOString(),
      addedDate: today,
      reviewCount: 0,
      correctCount: 0,
      lastReviewed: null,
      lastResult: null,
    });
    added++;
  });

  saveWords(words);

  // Add new words to review queue
  const queue = loadReviewQueue();
  const newIds = words.slice(-added).map(w => w.id);
  queue.push(...newIds);
  saveReviewQueue(queue);

  inputArea.value = '';
  document.getElementById('preview-card').style.display = 'none';
  previewData = [];

  if (duplicates > 0) {
    showToast(`已添加 ${added} 个词组，跳过 ${duplicates} 个重复词`);
  } else {
    showToast(`成功添加 ${added} 个词组！`);
  }
  updateStats();
});

document.getElementById('btn-clear-input').addEventListener('click', () => {
  inputArea.value = '';
  document.getElementById('preview-card').style.display = 'none';
  previewData = [];
});

// ===== Stats =====
function updateStats() {
  const words = loadWords();
  const today = todayKey();
  const todayAdded = words.filter(w => w.addedDate === today).length;

  const stats = loadReviewStats();
  const todayReviewed = (stats[today] && stats[today].reviewed) || 0;

  document.getElementById('stat-total').textContent = words.length;
  document.getElementById('stat-today-added').textContent = todayAdded;
  document.getElementById('stat-today-reviewed').textContent = todayReviewed;
}

// ===== Review Tab =====
let reviewSession = {
  words: [],
  currentIndex: 0,
  knownCount: 0,
  unknownCount: 0,
  isFlipped: false,
  order: 'english-first',
};

function updateReviewInfo() {
  const words = loadWords();
  const queue = loadReviewQueue();
  const reviewCount = parseInt(document.getElementById('review-count').value) || 20;
  document.getElementById('info-total').textContent = words.length;
  const pending = Math.min(reviewCount, queue.length || words.length);
  document.getElementById('info-pending').textContent = pending;

  const setupBtn = document.getElementById('btn-start-review');
  if (words.length === 0) {
    setupBtn.disabled = true;
    setupBtn.textContent = '词库为空，请先添加词汇';
    setupBtn.style.opacity = '0.5';
  } else {
    setupBtn.disabled = false;
    setupBtn.textContent = '开始复习';
    setupBtn.style.opacity = '1';
  }
}

// Number controls
document.getElementById('btn-count-minus').addEventListener('click', () => {
  const input = document.getElementById('review-count');
  const val = Math.max(1, parseInt(input.value) - 5);
  input.value = val;
  updateReviewInfo();
});

document.getElementById('btn-count-plus').addEventListener('click', () => {
  const input = document.getElementById('review-count');
  const val = Math.min(200, parseInt(input.value) + 5);
  input.value = val;
  updateReviewInfo();
});

document.getElementById('review-count').addEventListener('change', () => {
  const input = document.getElementById('review-count');
  let val = parseInt(input.value) || 20;
  val = Math.max(1, Math.min(200, val));
  input.value = val;
  updateReviewInfo();
});

// Order toggle (in review setup)
document.querySelectorAll('[data-order]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-order]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

function getSelectedOrder() {
  const active = document.querySelector('[data-order].active');
  return active ? active.dataset.order : 'english-first';
}

// Start review
document.getElementById('btn-start-review').addEventListener('click', () => {
  const words = loadWords();
  if (words.length === 0) { showToast('词库为空'); return; }

  const count = Math.min(parseInt(document.getElementById('review-count').value) || 20, words.length);
  const order = getSelectedOrder();

  // Get words from review queue
  let queue = loadReviewQueue();
  if (queue.length === 0) {
    // Rebuild queue from all words
    queue = words.map(w => w.id);
  }

  // Get review batch
  const batchIds = queue.slice(0, count);
  const batchWords = batchIds.map(id => words.find(w => w.id === id)).filter(Boolean);

  // If batch is smaller than count (some queue items were deleted), fill with random words
  if (batchWords.length < count) {
    const usedIds = new Set(batchWords.map(w => w.id));
    const remaining = words.filter(w => !usedIds.has(w.id));
    while (batchWords.length < count && remaining.length > 0) {
      const idx = Math.floor(Math.random() * remaining.length);
      batchWords.push(remaining.splice(idx, 1)[0]);
    }
  }

  reviewSession = {
    words: batchWords,
    currentIndex: 0,
    knownCount: 0,
    unknownCount: 0,
    isFlipped: false,
    order: order,
    queueIds: batchIds,
  };

  document.getElementById('review-setup').style.display = 'none';
  document.getElementById('review-complete').style.display = 'none';
  document.getElementById('review-session').style.display = 'block';

  showCurrentCard();
});

function showCurrentCard() {
  if (reviewSession.currentIndex >= reviewSession.words.length) {
    finishReview();
    return;
  }

  const word = reviewSession.words[reviewSession.currentIndex];
  const isFlipped = reviewSession.isFlipped;

  // Reset flip state
  reviewSession.isFlipped = false;
  const flashcard = document.getElementById('flashcard');
  flashcard.classList.remove('flipped');

  // Set card content based on order
  if (reviewSession.order === 'english-first') {
    document.getElementById('card-label-front').textContent = '英文';
    document.getElementById('card-text-front').textContent = word.english;
    document.getElementById('card-label-back').textContent = '中文';
    document.getElementById('card-text-back').textContent = word.chinese;
  } else {
    document.getElementById('card-label-front').textContent = '中文';
    document.getElementById('card-text-front').textContent = word.chinese;
    document.getElementById('card-label-back').textContent = '英文';
    document.getElementById('card-text-back').textContent = word.english;
  }

  // Update progress
  const progress = ((reviewSession.currentIndex) / reviewSession.words.length) * 100;
  document.getElementById('progress-fill').style.width = progress + '%';
  document.getElementById('progress-text').textContent =
    `${reviewSession.currentIndex + 1} / ${reviewSession.words.length}`;

  // Reset buttons
  document.getElementById('btn-flip').style.display = 'block';
  document.getElementById('result-buttons').style.display = 'none';
}

// Flip card
document.getElementById('flashcard').addEventListener('click', () => flipCard());
document.getElementById('btn-flip').addEventListener('click', () => flipCard());

function flipCard() {
  const flashcard = document.getElementById('flashcard');
  flashcard.classList.toggle('flipped');
  reviewSession.isFlipped = flashcard.classList.contains('flipped');

  if (reviewSession.isFlipped) {
    document.getElementById('btn-flip').style.display = 'none';
    document.getElementById('result-buttons').style.display = 'flex';
  }
}

// Mark known/unknown
document.getElementById('btn-known').addEventListener('click', () => markWord(true));
document.getElementById('btn-unknown').addEventListener('click', () => markWord(false));

function markWord(isKnown) {
  const word = reviewSession.words[reviewSession.currentIndex];
  if (!word) return;

  // Update word stats
  const words = loadWords();
  const wordIdx = words.findIndex(w => w.id === word.id);
  if (wordIdx >= 0) {
    words[wordIdx].reviewCount++;
    words[wordIdx].correctCount += isKnown ? 1 : 0;
    words[wordIdx].lastReviewed = new Date().toISOString();
    words[wordIdx].lastResult = isKnown ? 'known' : 'unknown';
    saveWords(words);
  }

  // Update session counters
  if (isKnown) reviewSession.knownCount++;
  else reviewSession.unknownCount++;

  // Move to next
  reviewSession.currentIndex++;
  showCurrentCard();
}

function finishReview() {
  // Update review queue: remove reviewed words, re-add based on result
  let queue = loadReviewQueue();
  const reviewedIds = reviewSession.queueIds;
  const words = loadWords();

  // Remove reviewed from queue
  queue = queue.filter(id => !reviewedIds.includes(id));

  // Re-add: known words go to back, unknown words go to 1/3 position
  reviewedIds.forEach(id => {
    const word = words.find(w => w.id === id);
    if (!word) return;
    if (word.lastResult === 'unknown') {
      // Insert at 1/3 position for sooner re-review
      const insertPos = Math.max(1, Math.floor(queue.length / 3));
      queue.splice(insertPos, 0, id);
    } else {
      // Known words go to the back
      queue.push(id);
    }
  });

  // If queue is empty, rebuild from all words
  if (queue.length === 0 && words.length > 0) {
    queue = words.map(w => w.id);
  }

  saveReviewQueue(queue);

  // Update daily stats
  const stats = loadReviewStats();
  const today = todayKey();
  if (!stats[today]) stats[today] = { reviewed: 0, known: 0, unknown: 0 };
  stats[today].reviewed += reviewSession.words.length;
  stats[today].known += reviewSession.knownCount;
  stats[today].unknown += reviewSession.unknownCount;
  saveReviewStats(stats);

  // Show completion screen
  document.getElementById('review-session').style.display = 'none';
  document.getElementById('review-complete').style.display = 'block';

  document.getElementById('summary-total').textContent = reviewSession.words.length;
  document.getElementById('summary-known').textContent = reviewSession.knownCount;
  document.getElementById('summary-unknown').textContent = reviewSession.unknownCount;
  const rate = reviewSession.words.length > 0
    ? Math.round((reviewSession.knownCount / reviewSession.words.length) * 100)
    : 0;
  document.getElementById('summary-rate').textContent = rate + '%';

  updateStats();
}

document.getElementById('btn-review-again').addEventListener('click', () => {
  document.getElementById('review-complete').style.display = 'none';
  document.getElementById('review-setup').style.display = 'block';
  updateReviewInfo();
});

document.getElementById('btn-back-to-setup').addEventListener('click', () => {
  document.getElementById('review-complete').style.display = 'none';
  document.getElementById('review-setup').style.display = 'block';
  updateReviewInfo();
});

// Keyboard shortcuts during review
document.addEventListener('keydown', (e) => {
  const reviewSessionEl = document.getElementById('review-session');
  if (reviewSessionEl.style.display === 'none') return;

  if (e.code === 'Space') {
    e.preventDefault();
    if (!reviewSession.isFlipped) flipCard();
  } else if (e.key === '1') {
    if (reviewSession.isFlipped) markWord(false);
  } else if (e.key === '2') {
    if (reviewSession.isFlipped) markWord(true);
  }
});

// ===== Word List Tab =====
function renderWordList() {
  const words = loadWords();
  const search = document.getElementById('search-input').value.toLowerCase().trim();
  const sortBy = document.getElementById('sort-select').value;

  let filtered = words;
  if (search) {
    filtered = words.filter(w =>
      w.english.toLowerCase().includes(search) ||
      w.chinese.toLowerCase().includes(search)
    );
  }

  // Sort
  filtered.sort((a, b) => {
    switch (sortBy) {
      case 'newest': return new Date(b.createdAt) - new Date(a.createdAt);
      case 'oldest': return new Date(a.createdAt) - new Date(b.createdAt);
      case 'english-az': return a.english.toLowerCase().localeCompare(b.english.toLowerCase());
      case 'reviewed-least': return a.reviewCount - b.reviewCount;
      case 'worst-rate':
        const rateA = a.reviewCount > 0 ? a.correctCount / a.reviewCount : -1;
        const rateB = b.reviewCount > 0 ? b.correctCount / b.reviewCount : -1;
        return rateA - rateB;
      default: return 0;
    }
  });

  const listEl = document.getElementById('word-list');
  const emptyEl = document.getElementById('list-empty');

  if (filtered.length === 0) {
    listEl.innerHTML = '';
    if (words.length === 0) {
      emptyEl.style.display = 'block';
    } else {
      emptyEl.style.display = 'none';
      listEl.innerHTML = '<p style="text-align:center;color:var(--text-light);padding:32px 0;">未找到匹配的词汇</p>';
    }
    return;
  }

  emptyEl.style.display = 'none';

  listEl.innerHTML = filtered.map(w => {
    const rate = w.reviewCount > 0 ? Math.round((w.correctCount / w.reviewCount) * 100) : null;
    let badge = '';
    if (rate === null) {
      badge = '<span class="word-badge rate-new">新</span>';
    } else if (rate >= 80) {
      badge = `<span class="word-badge rate-good">${rate}%</span>`;
    } else if (rate < 50) {
      badge = `<span class="word-badge rate-bad">${rate}%</span>`;
    } else {
      badge = `<span class="word-badge">${rate}%</span>`;
    }

    const reviewBadge = w.reviewCount > 0
      ? `<span class="word-badge">×${w.reviewCount}</span>`
      : '';

    return `
      <div class="word-item" data-id="${w.id}">
        <span class="word-eng">${escapeHtml(w.english)}</span>
        <span class="word-arrow">→</span>
        <span class="word-chn">${escapeHtml(w.chinese)}</span>
        <div class="word-stats">${badge}${reviewBadge}</div>
        <button class="btn-delete" data-id="${w.id}" title="删除">✕</button>
      </div>
    `;
  }).join('');

  // Attach delete handlers
  listEl.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      deleteWord(id);
    });
  });
}

function deleteWord(id) {
  const words = loadWords();
  const filtered = words.filter(w => w.id !== id);
  saveWords(filtered);

  // Remove from review queue
  let queue = loadReviewQueue();
  queue = queue.filter(qid => qid !== id);
  saveReviewQueue(queue);

  renderWordList();
  updateStats();
  showToast('已删除');
}

document.getElementById('search-input').addEventListener('input', renderWordList);
document.getElementById('sort-select').addEventListener('change', renderWordList);

// ===== Settings Tab =====
function updateSettingsUI() {
  const settings = loadSettings();
  document.getElementById('setting-default-count').value = settings.defaultCount;
  document.querySelectorAll('[data-setting-order]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.settingOrder === settings.defaultOrder);
  });

  // Data stats
  const words = loadWords();
  const stats = loadReviewStats();
  const totalReviews = Object.values(stats).reduce((sum, s) => sum + (s.reviewed || 0), 0);
  const dataStatsEl = document.getElementById('data-stats');
  dataStatsEl.innerHTML = `
    词库：${words.length} 个词组 ｜ 累计复习：${totalReviews} 次 ｜
    存储位置：浏览器本地 (localStorage)
  `;
}

document.getElementById('setting-default-count').addEventListener('change', () => {
  const settings = loadSettings();
  settings.defaultCount = Math.max(1, Math.min(200, parseInt(document.getElementById('setting-default-count').value) || 20));
  document.getElementById('setting-default-count').value = settings.defaultCount;
  saveSettings(settings);
  // Also update review tab
  document.getElementById('review-count').value = settings.defaultCount;
  showToast('已保存设置');
});

document.querySelectorAll('[data-setting-order]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-setting-order]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const settings = loadSettings();
    settings.defaultOrder = btn.dataset.settingOrder;
    saveSettings(settings);
    // Also update review tab
    document.querySelectorAll('[data-order]').forEach(b => {
      b.classList.toggle('active', b.dataset.order === settings.defaultOrder);
    });
    showToast('已保存设置');
  });
});

// Export
document.getElementById('btn-export').addEventListener('click', () => {
  const data = {
    words: loadWords(),
    settings: loadSettings(),
    reviewQueue: loadReviewQueue(),
    reviewStats: loadReviewStats(),
    exportDate: new Date().toISOString(),
    version: 1,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vocab-backup-${todayKey()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('数据已导出');
});

// Import
document.getElementById('btn-import').addEventListener('click', () => {
  document.getElementById('import-file').click();
});

document.getElementById('import-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data.words || !Array.isArray(data.words)) {
        showToast('文件格式不正确');
        return;
      }
      if (confirm(`将导入 ${data.words.length} 个词组，是否合并到当前词库？\n（点击"取消"将替换当前词库）`)) {
        // Merge mode
        const existing = loadWords();
        const existingEng = new Set(existing.map(w => w.english.toLowerCase()));
        let added = 0;
        data.words.forEach(w => {
          if (!existingEng.has(w.english.toLowerCase())) {
            existing.push({ ...w, id: genId() });
            added++;
          }
        });
        saveWords(existing);
        if (data.reviewQueue) {
          const queue = loadReviewQueue();
          const newIds = existing.slice(-added).map(w => w.id);
          queue.push(...newIds);
          saveReviewQueue(queue);
        }
        showToast(`合并完成，新增 ${added} 个词组`);
      } else {
        // Replace mode
        saveWords(data.words);
        if (data.reviewQueue) saveReviewQueue(data.reviewQueue);
        if (data.reviewStats) saveReviewStats(data.reviewStats);
        if (data.settings) saveSettings(data.settings);
        showToast('词库已替换');
      }
      updateStats();
      updateSettingsUI();
      renderWordList();
    } catch (err) {
      showToast('导入失败：文件格式错误');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

// Clear all
document.getElementById('btn-clear-all').addEventListener('click', () => {
  if (!confirm('⚠️ 确认清空所有数据？此操作不可恢复！\n\n建议先导出数据备份。')) return;
  if (!confirm('再次确认：真的要删除所有词汇和复习记录吗？')) return;
  localStorage.removeItem(STORAGE_KEYS.WORDS);
  localStorage.removeItem(STORAGE_KEYS.REVIEW_QUEUE);
  localStorage.removeItem(STORAGE_KEYS.REVIEW_STATS);
  updateStats();
  updateSettingsUI();
  renderWordList();
  updateReviewInfo();
  showToast('所有数据已清空');
});

// ===== Utility =====
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ===== Init =====
function init() {
  const settings = loadSettings();
  document.getElementById('review-count').value = settings.defaultCount;
  document.querySelectorAll('[data-order]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.order === settings.defaultOrder);
  });
  updateStats();
  updateReviewInfo();
}

init();
