// ===== Utils =====
// Fisher-Yates shuffle — returns a new array, does not mutate input
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

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
  const defaults = { defaultCount: 20, defaultOrder: 'english-first', autoSpeak: true, ttsRate: 0.9 };
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

// 词组去重主键：优先用英文（跨设备合并时 id 会重新生成，不可靠）
function phraseKey(it) {
  const e = ((it.english || '').trim().toLowerCase());
  if (e) return 'e:' + e;
  if (it.id) return 'i:' + it.id;
  return 'c:' + ((it.chinese || '').trim());
}

// ===== TTS (语音朗读) =====
// 使用浏览器原生 Web Speech API，无需外部服务
let _enVoice = null;
function initVoices() {
  if (!('speechSynthesis' in window)) return;
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return;
  _enVoice = voices.find(v => v.lang === 'en-US')
    || voices.find(v => v.lang === 'en-GB')
    || voices.find(v => v.lang && v.lang.startsWith('en'))
    || null;
}
if ('speechSynthesis' in window) {
  initVoices();
  speechSynthesis.onvoiceschanged = initVoices;
}

function speakEnglish(text) {
  if (!('speechSynthesis' in window)) { showToast('当前浏览器不支持语音朗读'); return; }
  if (!text) return;
  speechSynthesis.cancel(); // 取消上一句，避免排队堆积
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  if (_enVoice) u.voice = _enVoice;
  const settings = loadSettings();
  u.rate = (settings.ttsRate != null) ? settings.ttsRate : 0.9;
  speechSynthesis.speak(u);
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
    if (tab.dataset.tab === 'history') renderHistory();
    if (tab.dataset.tab === 'review') updateReviewInfo();
    if (tab.dataset.tab === 'add') updateStats();
    if (tab.dataset.tab === 'settings') updateSettingsUI();
  });
});

// ===== Input Parsing =====
function parseLine(line) {
  line = line.trim();
  if (!line) return null;

  // Format: English（Chinese）— answer inside full-width parentheses
  const fwIdx = line.lastIndexOf('（');
  const fwEnd = line.lastIndexOf('）');
  if (fwIdx > 0 && fwEnd > fwIdx) {
    const eng = line.substring(0, fwIdx).trim();
    const chn = line.substring(fwIdx + 1, fwEnd).trim();
    if (eng && chn) return { english: eng, chinese: chn };
  }

  // Format: English (Chinese) — answer inside half-width parentheses containing Chinese
  const hwMatch = line.match(/\(([^)]+)\)\s*$/);
  if (hwMatch) {
    const inner = hwMatch[1].trim();
    if (inner && /[^\x00-\x7F]/.test(inner)) {
      const eng = line.substring(0, line.lastIndexOf('(')).trim();
      if (eng) return { english: eng, chinese: inner };
    }
  }

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
  if (!text) { showToast('请先输入词组'); return; }

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

  // Record daily added count
  if (added > 0) {
    const stats = loadReviewStats();
    if (!stats[today]) stats[today] = { reviewed: 0, known: 0, unknown: 0, added: 0, items: [] };
    stats[today].added = (stats[today].added || 0) + added;
    saveReviewStats(stats);
  }

  // Add new words to review queue
  const queue = loadReviewQueue();
  const newIds = words.slice(-added).map(w => w.id);
  queue.push(...newIds);
  saveReviewQueue(queue);

  inputArea.value = '';
  document.getElementById('preview-card').style.display = 'none';
  previewData = [];

  if (duplicates > 0) {
    showToast(`已添加 ${added} 个词组，跳过 ${duplicates} 个重复词组`);
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
  const todayStats = stats[today];
  const todayItems = (todayStats && todayStats.items) || [];
  const todayReviewed = todayItems.length > 0 ? todayItems.length : ((todayStats && todayStats.reviewed) || 0);

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
  const reviewCount = parseInt(document.getElementById('review-count').value) || 20;
  document.getElementById('info-total').textContent = words.length;
  const pending = Math.min(reviewCount, words.length);
  document.getElementById('info-pending').textContent = pending;

  const setupBtn = document.getElementById('btn-start-review');
  if (words.length === 0) {
    setupBtn.disabled = true;
    setupBtn.textContent = '词库为空，请先添加词组';
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

  // 去重：确保每个词只出现一次（防止 queue 历史数据残留导致重复）
  const seen = new Set();
  const uniqueWords = words.filter(w => {
    if (!w.id || seen.has(w.id)) return false;
    seen.add(w.id);
    return true;
  });

  // 按复习次数升序排序（复习次数少的优先），同复习次数的随机排序
  // 这样每次复习都优先练生词/薄弱词，同分段内每次选的词也不完全一样
  const sorted = uniqueWords
    .map(w => ({ w, r: Math.random() }))
    .sort((a, b) => {
      const rc = (a.w.reviewCount || 0) - (b.w.reviewCount || 0);
      if (rc !== 0) return rc;
      return a.r - b.r;
    })
    .map(x => x.w);

  // 取复习次数最少的 count 个词
  const batch = sorted.slice(0, count);

  // 打乱呈现顺序，确保每次复习的题目顺序都不同
  const shuffled = shuffleArray(batch);

  reviewSession = {
    words: shuffled,
    currentIndex: 0,
    knownCount: 0,
    unknownCount: 0,
    isFlipped: false,
    order: order,
    queueIds: shuffled.map(w => w.id),
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

  // 无动画地瞬间回到正面，再填入新词组。
  // 如果带 0.6s 翻转动画，转回正面的过程中背面会先展示新词组的答案，导致用户提前看到答案。
  const flashcard = document.getElementById('flashcard');
  const inner = flashcard.querySelector('.flashcard-inner');
  if (inner) {
    inner.style.transition = 'none';
    inner.style.transform = 'rotateY(0deg)';
    flashcard.classList.remove('flipped');
    void inner.offsetWidth; // 强制 inner reflow，让无 transition 的 transform 立即生效
    inner.style.transition = '';
    inner.style.transform = '';
  }
  reviewSession.isFlipped = false;

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

  // Reset buttons: show flip + result buttons, hide next button
  document.getElementById('btn-flip').style.display = 'block';
  document.getElementById('result-buttons').style.display = 'flex';
  document.getElementById('btn-next').style.display = 'none';

  // 自动朗读英文（如设置开启）
  const settings = loadSettings();
  if (settings.autoSpeak) speakEnglish(word.english);
}

// Flip card
document.getElementById('flashcard').addEventListener('click', () => flipCard());
document.getElementById('btn-flip').addEventListener('click', () => flipCard());

// Speak current card's English
document.getElementById('btn-speak-card').addEventListener('click', (e) => {
  e.stopPropagation();
  const word = reviewSession.words[reviewSession.currentIndex];
  if (word) speakEnglish(word.english);
});

function flipCard() {
  const flashcard = document.getElementById('flashcard');
  flashcard.classList.toggle('flipped');
  reviewSession.isFlipped = flashcard.classList.contains('flipped');

  if (reviewSession.isFlipped) {
    document.getElementById('btn-flip').style.display = 'none';
  }
}

// Mark known/unknown
document.getElementById('btn-known').addEventListener('click', () => markWord(true));
document.getElementById('btn-unknown').addEventListener('click', () => markWord(false));

// Next button
document.getElementById('btn-next').addEventListener('click', () => {
  reviewSession.currentIndex++;
  showCurrentCard();
});

function markWord(isKnown) {
  const word = reviewSession.words[reviewSession.currentIndex];
  if (!word) return;

  // Always show the answer when marking
  if (!reviewSession.isFlipped) {
    const flashcard = document.getElementById('flashcard');
    flashcard.classList.add('flipped');
    reviewSession.isFlipped = true;
  }

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

  // Record the result of the current card
  reviewSession.lastResult = isKnown;
  word.lastResult = isKnown ? 'known' : 'unknown';

  // Show "next" button, keep the answer visible
  document.getElementById('btn-flip').style.display = 'none';
  document.getElementById('result-buttons').style.display = 'none';
  document.getElementById('btn-next').style.display = 'block';
}

function finishReview() {
  // 选词逻辑已改为基于 reviewCount 排序，不再依赖 queue 做滚动重排
  // 这里只更新每日复习统计 + 显示完成界面
  const words = loadWords();

  // Update daily stats
  const stats = loadReviewStats();
  const today = todayKey();
  if (!stats[today]) stats[today] = { reviewed: 0, known: 0, unknown: 0, added: 0, items: [] };
  if (!Array.isArray(stats[today].items)) stats[today].items = [];

  // 记录每个复习的词组，按词组去重（同一天同一词组只算一次）
  const byEnglish = new Map();
  stats[today].items.forEach(it => byEnglish.set(phraseKey(it), it));
  reviewSession.words.forEach(w => {
    const key = phraseKey(w);
    const result = w.lastResult || 'unknown';
    if (byEnglish.has(key)) {
      // 同一词组再次复习：结果升级为"认识"
      if (result === 'known') byEnglish.get(key).result = 'known';
    } else {
      byEnglish.set(key, { id: w.id, english: w.english, chinese: w.chinese, result });
    }
  });
  stats[today].items = Array.from(byEnglish.values());
  stats[today].reviewed = stats[today].items.length;
  stats[today].known = stats[today].items.filter(it => it.result === 'known').length;
  stats[today].unknown = stats[today].items.filter(it => it.result !== 'known').length;
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

  const nextBtn = document.getElementById('btn-next');
  const isMarked = nextBtn.style.display === 'block';

  if (e.code === 'Space') {
    e.preventDefault();
    if (!isMarked && !reviewSession.isFlipped) flipCard();
  } else if (e.key === '1') {
    if (!isMarked) markWord(false);
  } else if (e.key === '2') {
    if (!isMarked) markWord(true);
  } else if (e.key === 'Enter') {
    if (isMarked) {
      e.preventDefault();
      reviewSession.currentIndex++;
      showCurrentCard();
    }
  }
});

// ===== Word List Tab =====
function formatAddedDate(isoString) {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}月${d.getDate()}日添加`;
}

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
  const countEl = document.getElementById('list-count');

  // Update count label
  if (countEl) {
    if (search) {
      countEl.textContent = `找到 ${filtered.length} 个 / 共 ${words.length} 个词组`;
    } else {
      countEl.textContent = `共 ${words.length} 个词组`;
    }
  }

  if (filtered.length === 0) {
    listEl.innerHTML = '';
    if (words.length === 0) {
      emptyEl.style.display = 'block';
    } else {
      emptyEl.style.display = 'none';
      listEl.innerHTML = '<p style="text-align:center;color:var(--text-light);padding:32px 0;">未找到匹配的词组</p>';
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

    const addedDate = w.createdAt ? formatAddedDate(w.createdAt) : '';

    return `
      <div class="word-item" data-id="${w.id}">
        <span class="word-eng">${escapeHtml(w.english)}</span>
        <span class="word-arrow">→</span>
        <span class="word-chn">${escapeHtml(w.chinese)}</span>
        <div class="word-stats">${badge}${reviewBadge}</div>
        <button class="btn-speak-sm" data-id="${w.id}" title="朗读">🔊</button>
        <span class="word-date">${addedDate}</span>
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

  // Attach speak handlers
  listEl.querySelectorAll('.btn-speak-sm').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const w = loadWords().find(x => x.id === btn.dataset.id);
      if (w) speakEnglish(w.english);
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

// ===== History Tab =====
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function formatDateKey(key) {
  const parts = key.split('-').map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  return `${parts[1]}月${parts[2]}日 星期${WEEKDAYS[date.getDay()]}`;
}

function renderHistory() {
  const stats = loadReviewStats();
  const days = Object.keys(stats).sort().reverse();
  const allWords = loadWords();

  // 累计统计
  // 累计复习词组 = 所有天明细按词组去重后的数量（旧版备份无明细的天退化为数字相加）
  let activeDays = 0, totalReviewed = 0;
  const reviewedSet = new Set();
  days.forEach(k => {
    const s = stats[k];
    const items = s.items || [];
    if ((s.reviewed || 0) > 0 || (s.added || 0) > 0) activeDays++;
    if (items.length > 0) {
      items.forEach(it => { const key = phraseKey(it); if (key) reviewedSet.add(key); });
    } else {
      totalReviewed += s.reviewed || 0;
    }
  });
  totalReviewed += reviewedSet.size;
  // 累计新增词组 = 词库中的词组总数（词库本身已按英文去重，天然不重复累计）
  const totalAdded = allWords.length;

  document.getElementById('hist-days').textContent = activeDays;
  document.getElementById('hist-reviewed').textContent = totalReviewed;
  document.getElementById('hist-added').textContent = totalAdded;

  const listEl = document.getElementById('history-list');
  if (days.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🗓️</span>
        <p>还没有学习记录，去添加或复习一些词组吧！</p>
      </div>`;
    return;
  }

  listEl.innerHTML = days.map(key => {
    const s = stats[key];
    const items = s.items || [];
    // 有明细的天以去重后明细为准（跨设备合并后同词只算一次）
    const reviewed = items.length > 0 ? items.length : (s.reviewed || 0);
    const known = items.length > 0 ? items.filter(it => it.result === 'known').length : (s.known || 0);
    const unknown = items.length > 0 ? items.filter(it => it.result !== 'known').length : (s.unknown || 0);
    const added = s.added || 0;

    // Only show days with actual activity
    if (reviewed === 0 && added === 0) return '';

    // Words added on this day (addedDate stored at add time; fallback to createdAt UTC date)
    const addedItems = allWords.filter(w => (w.addedDate || ((w.createdAt || '').slice(0, 10))) === key);

    const reviewItemsHtml = items.length > 0 ? `
      <div class="hist-section">📝 复习 ${items.length} 个</div>
      ${items.map(it => `
        <div class="hist-item">
          <span class="hist-item-text"><button class="btn-speak-sm" data-eng="${escapeHtml(it.english)}" title="朗读">🔊</button>${escapeHtml(it.english)}<span class="hist-item-sep">→</span>${escapeHtml(it.chinese)}</span>
          <span class="hist-item-badge ${it.result === 'known' ? 'badge-known' : 'badge-unknown'}">${it.result === 'known' ? '认识' : '不认识'}</span>
        </div>`).join('')}` : '';

    const addedItemsHtml = addedItems.length > 0 ? `
      <div class="hist-section">📥 当天新增 ${addedItems.length} 个</div>
      ${addedItems.map(w => `
        <div class="hist-item">
          <span class="hist-item-text"><button class="btn-speak-sm" data-eng="${escapeHtml(w.english)}" title="朗读">🔊</button>${escapeHtml(w.english)}<span class="hist-item-sep">→</span>${escapeHtml(w.chinese)}</span>
          <span class="hist-item-badge badge-added">新增</span>
        </div>`).join('')}` : '';

    const itemsHtml = (reviewItemsHtml || addedItemsHtml) ? `
      <div class="hist-items" style="display:none">
        ${reviewItemsHtml}
        ${addedItemsHtml}
      </div>` : '';

    const badges = [];
    if (reviewed > 0) badges.push(`复习 <b>${reviewed}</b> 个`);
    if (added > 0) badges.push(`新增 <b>${added}</b> 个`);
    if (known > 0) badges.push(`<span class="hist-known">认识 ${known}</span>`);
    if (unknown > 0) badges.push(`<span class="hist-unknown">不认识 ${unknown}</span>`);

    return `
      <div class="hist-day">
        <div class="hist-day-head">
          <span class="hist-date">${formatDateKey(key)}</span>
          <span class="hist-badges">${badges.join(' · ')}</span>
          ${(items.length > 0 || addedItems.length > 0) ? `<button class="btn-icon hist-toggle" title="展开详情">▾</button>` : ''}
        </div>
        ${itemsHtml}
      </div>`;
  }).join('');

  // Toggle day details
  listEl.querySelectorAll('.hist-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const items = btn.closest('.hist-day').querySelector('.hist-items');
      const expanded = items.style.display !== 'none';
      items.style.display = expanded ? 'none' : 'block';
      btn.textContent = expanded ? '▾' : '▴';
    });
  });

  // Speak handlers in history details
  listEl.querySelectorAll('.btn-speak-sm').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      speakEnglish(btn.dataset.eng);
    });
  });
}

// ===== Settings Tab =====
function updateSettingsUI() {
  const settings = loadSettings();
  document.getElementById('setting-default-count').value = settings.defaultCount;
  document.querySelectorAll('[data-setting-order]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.settingOrder === settings.defaultOrder);
  });

  // 自动朗读开关
  document.querySelectorAll('[data-setting-autospeak]').forEach(btn => {
    btn.classList.toggle('active', (settings.autoSpeak !== false ? 'on' : 'off') === btn.dataset.settingAutospeak);
  });
  // 朗读语速
  const rate = (settings.ttsRate != null) ? settings.ttsRate : 0.9;
  const rateSlider = document.getElementById('setting-tts-rate');
  if (rateSlider) {
    rateSlider.value = rate;
    const rateValEl = document.getElementById('rate-value');
    if (rateValEl) rateValEl.textContent = rate.toFixed(1) + '×';
  }

  // Data stats
  const words = loadWords();
  const stats = loadReviewStats();
  // 累计复习词组：所有明细按词组去重（旧版无明细的天退化为数字）
  const reviewedSet = new Set();
  let legacyReviewed = 0;
  Object.values(stats).forEach(s => {
    const items = s.items || [];
    if (items.length > 0) items.forEach(it => { const key = phraseKey(it); if (key) reviewedSet.add(key); });
    else legacyReviewed += s.reviewed || 0;
  });
  const totalReviews = reviewedSet.size + legacyReviewed;
  const dataStatsEl = document.getElementById('data-stats');
  dataStatsEl.innerHTML = `
    词库：${words.length} 个词组 ｜ 累计复习词组：${totalReviews} 个 ｜
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

// 自动朗读开关
document.querySelectorAll('[data-setting-autospeak]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-setting-autospeak]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const settings = loadSettings();
    settings.autoSpeak = btn.dataset.settingAutospeak === 'on';
    saveSettings(settings);
    showToast(settings.autoSpeak ? '已开启自动朗读' : '已关闭自动朗读');
  });
});

// 朗读语速调节（拖动时实时显示数值，松手时保存并试听）
const _rateSlider = document.getElementById('setting-tts-rate');
if (_rateSlider) {
  _rateSlider.addEventListener('input', () => {
    const v = parseFloat(_rateSlider.value).toFixed(1) + '×';
    const el = document.getElementById('rate-value');
    if (el) el.textContent = v;
  });
  _rateSlider.addEventListener('change', () => {
    const settings = loadSettings();
    settings.ttsRate = parseFloat(_rateSlider.value);
    saveSettings(settings);
    speakEnglish('Hello, this is a sample.'); // 试听效果
  });
}

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

// Merge daily review stats from another device's backup.
// 关键：按词组（英文）去重 —— 同一词组在两台设备上都复习过，累计只算一次
function mergeReviewStats(srcStats, dstStats) {
  Object.keys(srcStats || {}).forEach(day => {
    const s = srcStats[day] || {};
    if (!dstStats[day]) dstStats[day] = { reviewed: 0, known: 0, unknown: 0, added: 0, items: [] };
    const d = dstStats[day];

    // 1) 合并 items，按词组去重；同一词组结果升级为"认识"
    if (!Array.isArray(d.items)) d.items = [];
    const byEnglish = new Map();
    d.items.forEach(it => byEnglish.set(phraseKey(it), it));
    (s.items || []).forEach(it => {
      const key = phraseKey(it);
      if (!byEnglish.has(key)) {
        byEnglish.set(key, it);
      } else if (it.result === 'known' && byEnglish.get(key).result !== 'known') {
        byEnglish.get(key).result = 'known';
      }
    });
    d.items = Array.from(byEnglish.values());

    // 2) 有明细的天：以去重后的明细为准重算统计，避免重复累加
    if (d.items.length > 0) {
      d.reviewed = d.items.length;
      d.known = d.items.filter(it => it.result === 'known').length;
      d.unknown = d.items.filter(it => it.result !== 'known').length;
    } else {
      // 旧版本备份没有明细：只能退化为数字相加
      d.reviewed = (d.reviewed || 0) + (s.reviewed || 0);
      d.known = (d.known || 0) + (s.known || 0);
      d.unknown = (d.unknown || 0) + (s.unknown || 0);
    }
    // added 字段仅作兼容保留，实际显示以词库（去重后）为准
    d.added = (d.added || 0) + (s.added || 0);
  });
  return dstStats;
}

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
      if (confirm(`将导入 ${data.words.length} 个词组和全部学习记录，是否合并到当前数据？\n（相同词组和复习记录会自动去重，不会重复累计）\n（点击"取消"将替换当前全部数据）`)) {
        // Merge mode: merge words (dedupe by English, accumulate review counts) + merge review stats
        const existing = loadWords();
        const existingEng = new Set(existing.map(w => w.english.toLowerCase()));
        let added = 0;
        let mergedStats = 0;
        data.words.forEach(w => {
          const lower = (w.english || '').toLowerCase();
          if (!lower) return;
          if (existingEng.has(lower)) {
            // Word already exists: accumulate review stats from the other device
            const ex = existing.find(x => x.english.toLowerCase() === lower);
            if (w.reviewCount > 0) {
              ex.reviewCount = (ex.reviewCount || 0) + (w.reviewCount || 0);
              ex.correctCount = (ex.correctCount || 0) + (w.correctCount || 0);
              if (w.lastReviewed && (!ex.lastReviewed || new Date(w.lastReviewed) > new Date(ex.lastReviewed))) {
                ex.lastReviewed = w.lastReviewed;
              }
              mergedStats++;
            }
          } else {
            existing.push({ ...w, id: genId() });
            existingEng.add(lower);
            added++;
          }
        });
        saveWords(existing);
        // Merge review queue (add only new words)
        if (data.reviewQueue) {
          const queue = loadReviewQueue();
          const newIds = existing.slice(-added).map(w => w.id);
          queue.push(...newIds);
          saveReviewQueue(queue);
        }
        // Merge daily learning records (the key fix: stats now accumulate across devices)
        let mergedReviewed = 0;
        if (data.reviewStats && Object.keys(data.reviewStats).length > 0) {
          const stats = mergeReviewStats(data.reviewStats, loadReviewStats());
          saveReviewStats(stats);
          // 累计复习词组：合并后所有明细按词组去重（旧版无明细的天退化为数字）
          const reviewedSet = new Set();
          let legacy = 0;
          Object.values(stats).forEach(d => {
            const items = d.items || [];
            if (items.length > 0) items.forEach(it => { const k = phraseKey(it); if (k) reviewedSet.add(k); });
            else legacy += d.reviewed || 0;
          });
          mergedReviewed = reviewedSet.size + legacy;
        } else if (!data.reviewStats) {
          showToast('⚠️ 该备份文件不包含学习记录（可能是旧版本导出的），请用最新版重新导出');
        }
        const msg = [`新增 ${added} 个词组`];
        if (mergedStats > 0) msg.push(`累计 ${mergedStats} 个词的复习次数`);
        if (data.reviewStats && Object.keys(data.reviewStats).length > 0) msg.push(`学习记录累计复习词组 ${mergedReviewed} 个`);
        showToast(`合并完成：${msg.join('，')}`);
      } else {
        // Replace mode
        saveWords(data.words);
        if (data.reviewQueue) saveReviewQueue(data.reviewQueue);
        if (data.reviewStats) saveReviewStats(data.reviewStats);
        if (data.settings) saveSettings(data.settings);
        showToast('数据已替换');
      }
      updateStats();
      updateSettingsUI();
      renderWordList();
      renderHistory();
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
  if (!confirm('再次确认：真的要删除所有词组和复习记录吗？')) return;
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

// 校准历史统计：有明细的天一律以去重后的明细为准重算，
// 自动修复旧版本合并造成的重复累计（如 A10+B10(5 重复) 误记为 20）
function normalizeStats() {
  const stats = loadReviewStats();
  let changed = false;
  Object.keys(stats).forEach(day => {
    const d = stats[day];
    const items = d.items || [];
    if (!items.length) return;
    const byEnglish = new Map();
    items.forEach(it => {
      const key = phraseKey(it);
      if (!byEnglish.has(key)) byEnglish.set(key, it);
      else if (it.result === 'known' && byEnglish.get(key).result !== 'known') byEnglish.get(key).result = 'known';
    });
    const deduped = Array.from(byEnglish.values());
    const newReviewed = deduped.length;
    const newKnown = deduped.filter(it => it.result === 'known').length;
    const newUnknown = deduped.filter(it => it.result !== 'known').length;
    if (deduped.length !== items.length ||
        newReviewed !== (d.reviewed || 0) ||
        newKnown !== (d.known || 0) ||
        newUnknown !== (d.unknown || 0)) {
      d.items = deduped;
      d.reviewed = newReviewed;
      d.known = newKnown;
      d.unknown = newUnknown;
      changed = true;
    }
  });
  if (changed) saveReviewStats(stats);
}

// ===== Init =====
function init() {
  normalizeStats(); // 打开页面即校准历史统计（修复旧版本合并的重复累计）
  const settings = loadSettings();
  document.getElementById('review-count').value = settings.defaultCount;
  document.querySelectorAll('[data-order]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.order === settings.defaultOrder);
  });
  updateStats();
  updateReviewInfo();
}

init();
