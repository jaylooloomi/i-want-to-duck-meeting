const $ = (id) => document.getElementById(id);
const selector = $('meeting'), primaryLang = $('primary-lang'), secondaryLang = $('secondary-lang');
const summaryPanel = $('summary-panel'), summaryProgressWrap = $('summary-progress-wrap'), summaryBody = $('summary-body');
const summaryStage = $('summary-stage'), summaryPercent = $('summary-percent'), summaryFill = $('summary-progress-fill');
const summaryBadge = $('summary-badge'), summaryRegen = $('summary-regenerate'), summaryToggle = $('summary-toggle');
const params = new URLSearchParams(location.search);
let selected = params.get('id') || 'latest';
if (primaryLang && params.get('primary')) primaryLang.value = params.get('primary');
if (secondaryLang && params.get('secondary')) secondaryLang.value = params.get('secondary');
let signature = '', summarySignature = '', translating = false, summaryCollapsed = false;
const translations = new Map(), autoTriggeredIds = new Set();
function syncSelection() {
  const url = new URL(location.href); url.searchParams.set('id', selected);
  if (primaryLang) { if (primaryLang.value !== 'all') url.searchParams.set('primary', primaryLang.value); else url.searchParams.delete('primary'); }
  if (secondaryLang) { if (secondaryLang.value !== 'none') url.searchParams.set('secondary', secondaryLang.value); else url.searchParams.delete('secondary'); }
  history.replaceState(null, '', url);
}
document.addEventListener('microphone-started', ({ detail }) => {
  selected = detail.id; signature = ''; summarySignature = ''; selector.dataset.signature = '';
  syncSelection();
});
const states = { starting:'準備中', launching:'啟動中', joining:'加入中', waiting_login:'等待 Google 登入', selecting_account:'等待選擇記錄帳號', waiting_admission:'等待放行', in_call:'記錄中', leaving:'收尾中', transcribing:'轉錄中', done:'已結束', failed:'記錄失敗' };
const clock = (value) => { const date = new Date(value); return Number.isNaN(+date) ? '' : date.toLocaleTimeString('zh-TW', { hour12:false }); };
const hasCjk = (s) => /[\u3400-\u9FFF\uF900-\uFAFF]/.test(s);
function filterRecords(records) {
  const mode = primaryLang ? primaryLang.value : 'all';
  if (mode === 'zh-TW') return records.filter((r) => r.source !== 'teams-native' || hasCjk(r.text));
  if (mode === 'en') return records.filter((r) => !hasCjk(r.text) || r.source === 'teams-native');
  return records;
}
async function requestTranslations(records) {
  const target = secondaryLang ? secondaryLang.value : 'none';
  if (target === 'none' || translating) return;
  const missing = [...new Set(records.map((r) => r.text).filter((t) => t && !translations.has(target + ':' + t) && (target === 'zh-TW' ? !hasCjk(t) : target === 'en' ? hasCjk(t) : true)))].slice(-8);
  if (!missing.length) return;
  translating = true;
  try {
    const response = await fetch('/api/translate', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ texts:missing, target }) });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data.translations)) {
        missing.forEach((text, i) => { translations.set(target + ':' + text, data.translations[i] || ''); });
        signature = '';
      }
    }
  } catch {}
  finally { translating = false; }
}
function appendInline(parent, text) {
  const parts = String(text || '').split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      const strong = document.createElement('strong');
      strong.textContent = part.slice(2, -2);
      parent.append(strong);
    } else if (part) {
      parent.append(document.createTextNode(part));
    }
  }
}
function renderMarkdownDom(md) {
  const frag = document.createDocumentFragment();
  const lines = String(md || '').split(/\r?\n/);
  let currentList = null, currentTable = null, tbody = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) { currentList = null; currentTable = null; tbody = null; continue; }
    if (line.startsWith('|') && line.endsWith('|')) {
      currentList = null;
      const cells = line.slice(1, -1).split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      if (!currentTable) {
        currentTable = document.createElement('table'); currentTable.className = 'summary-table';
        const thead = document.createElement('thead'), tr = document.createElement('tr');
        for (const c of cells) { const th = document.createElement('th'); appendInline(th, c); tr.append(th); }
        thead.append(tr); tbody = document.createElement('tbody'); currentTable.append(thead, tbody); frag.append(currentTable);
      } else {
        const tr = document.createElement('tr');
        for (const c of cells) { const td = document.createElement('td'); appendInline(td, c); tr.append(td); }
        tbody.append(tr);
      }
      continue;
    }
    currentTable = null; tbody = null;
    const hMatch = /^(#{1,3})\s+(.+)$/.exec(line);
    if (hMatch) {
      currentList = null;
      const h = document.createElement(hMatch[1].length === 1 ? 'h3' : hMatch[1].length === 2 ? 'h3' : 'h4');
      h.className = 'summary-h'; appendInline(h, hMatch[2]); frag.append(h); continue;
    }
    const liMatch = /^(?:[-*•]|\d+\.)\s+(.+)$/.exec(line);
    if (liMatch) {
      if (!currentList) { currentList = document.createElement('ul'); currentList.className = 'summary-list'; frag.append(currentList); }
      const li = document.createElement('li');
      const indent = (raw.match(/^\s*/)?.[0]?.length || 0) >= 2;
      if (indent) li.className = 'summary-subitem';
      appendInline(li, liMatch[1]); currentList.append(li); continue;
    }
    currentList = null;
    const p = document.createElement('p'); p.className = 'summary-p'; appendInline(p, line); frag.append(p);
  }
  return frag;
}
async function requestSummarize(meetingId, force = false) {
  if (!meetingId) return;
  try {
    await fetch('/api/summarize', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ id:meetingId, force }) });
    summarySignature = '';
  } catch {}
}
summaryRegen?.addEventListener('click', () => {
  summaryCollapsed = false;
  if (summaryToggle) summaryToggle.textContent = '收合';
  void requestSummarize(selected, true);
});
summaryToggle?.addEventListener('click', () => {
  summaryCollapsed = !summaryCollapsed;
  summaryToggle.textContent = summaryCollapsed ? '展開' : '收合';
  if (summaryBody) summaryBody.hidden = summaryCollapsed;
});
function updateSummaryPanel(data) {
  if (!summaryPanel) return;
  const st = data.status?.state;
  const sum = data.summary || { state:'idle', progress:0, stage:'' };
  const isTerminal = st === 'done' || st === 'failed' || st === 'leaving' || st === 'transcribing';
  if (!isTerminal && sum.state === 'idle') {
    summaryPanel.hidden = true; return;
  }
  if (st === 'done' && sum.state === 'idle' && data.records?.length > 0 && !autoTriggeredIds.has(data.id)) {
    autoTriggeredIds.add(data.id);
    void requestSummarize(data.id, false);
  }
  summaryPanel.hidden = false;
  const nextSig = JSON.stringify([data.id, st, sum.state, sum.progress, sum.stage, sum.updatedAt, summaryCollapsed]);
  if (nextSig === summarySignature) return;
  summarySignature = nextSig;
  if (st === 'leaving' || st === 'transcribing' || sum.state === 'generating') {
    const pct = sum.state === 'generating' ? Math.max(8, Number(sum.progress) || 10) : 15;
    summaryBadge.textContent = '正在整理中';
    summaryBadge.className = 'summary-badge generating';
    summaryProgressWrap.hidden = false;
    summaryStage.textContent = sum.state === 'generating' ? (sum.stage || '正在整理會議記錄…') : '正在收尾並準備整理會議記錄…';
    summaryPercent.textContent = pct + '%';
    summaryFill.style.width = pct + '%';
    summaryFill.parentElement?.setAttribute('aria-valuenow', String(pct));
    summaryRegen.disabled = true;
    if (!sum.markdown) { summaryBody.replaceChildren(); summaryBody.hidden = true; }
    return;
  }
  summaryRegen.disabled = false;
  if (sum.state === 'ready' && sum.markdown) {
    summaryBadge.textContent = '已完成整理';
    summaryBadge.className = 'summary-badge ready';
    summaryProgressWrap.hidden = true;
    summaryBody.replaceChildren(renderMarkdownDom(sum.markdown));
    summaryBody.hidden = summaryCollapsed;
    return;
  }
  summaryBadge.textContent = sum.state === 'failed' ? '整理失敗' : '待整理';
  summaryBadge.className = 'summary-badge';
  summaryProgressWrap.hidden = true;
  const empty = document.createElement('p'); empty.className = 'summary-p';
  empty.textContent = data.records?.length ? (sum.stage || '點擊右上角「重新整理會議記錄」即可產生結構化會議摘要。') : '本場會議尚無有效字幕，略過自動整理。';
  summaryBody.replaceChildren(empty);
  summaryBody.hidden = summaryCollapsed;
}
function row(record, pending) {
  const card = document.createElement('article'); card.className = 'utterance' + (pending ? ' pending' : '');
  const name = record.speaker || '未知發言者';
  const hue = [...name].reduce((n, c) => (n * 31 + c.codePointAt(0)) % 360, 0);
  const avatar = document.createElement('div'); avatar.className = 'avatar'; avatar.style.setProperty('--hue', hue); avatar.textContent = name.match(/^講者 ([A-Z]+)$/)?.[1] || [...name].slice(0, 1).join('');
  const body = document.createElement('div'); body.className = 'body';
  const meta = document.createElement('div'); meta.className = 'meta';
  const speaker = document.createElement('strong'); speaker.textContent = name;
  const time = document.createElement('time'); time.textContent = clock(record.t0);
  meta.append(speaker, time);
  if (pending) { const draft = document.createElement('span'); draft.className = 'draft'; draft.textContent = record.source === 'local-audio' || record.source?.startsWith('teams-') ? '語音辨識中' : '字幕更新中'; meta.append(draft); }
  const text = document.createElement('p'); text.className = 'text'; text.textContent = record.text;
  body.append(meta, text);
  const target = secondaryLang ? secondaryLang.value : 'none';
  const translated = !pending && target !== 'none' ? translations.get(target + ':' + record.text) : '';
  if (translated && translated !== record.text) {
    const sub = document.createElement('p'); sub.className = 'subtext'; sub.textContent = translated;
    body.append(sub);
  }
  card.append(avatar, body); return card;
}
selector.addEventListener('change', () => { selected = selector.value; signature = ''; summarySignature = ''; syncSelection(); });
primaryLang?.addEventListener('change', () => { signature = ''; syncSelection(); });
secondaryLang?.addEventListener('change', () => { signature = ''; syncSelection(); });
async function get(url) { const response = await fetch(url); if (!response.ok) throw new Error('讀取失敗'); return response.json(); }
async function poll() {
  try {
    const meetings = await get('/api/meetings');
    const optionSignature = JSON.stringify(meetings);
    if (selector.dataset.signature !== optionSignature) {
      const options = [new Option('自動跟隨最新會議', 'latest'), ...meetings.map((m) => new Option(m.id + ' · ' + (states[m.state] || '未知'), m.id))];
      selector.replaceChildren(...options); selector.value = selected;
      if (!selector.value) { selected = 'latest'; selector.value = selected; syncSelection(); }
      selector.dataset.signature = optionSignature;
    }
    if (!meetings.length) {
      $('state').textContent = '尚無會議'; $('speaking').textContent = '加入會議後將自動顯示';
      $('transcript').replaceChildren(Object.assign(document.createElement('div'), { className:'empty', textContent:'尚無字幕，開始發言後會自動顯示。' }));
      if (summaryPanel) summaryPanel.hidden = true;
      $('count').textContent = '0 段發言'; $('meet').hidden = true; $('meet').removeAttribute('href');
      $('updated').textContent = ''; signature = ''; summarySignature = '';
      $('connection').textContent = '● 已連線'; return;
    }
    const data = await get('/api/transcript?id=' + encodeURIComponent(selected));
    document.dispatchEvent(new CustomEvent('meeting-status', { detail:data }));
    $('state').textContent = states[data.status?.state] || '未知狀態';
    $('speaking').textContent = data.status?.error?.message || (data.activeSpeakers.length ? (['microphone','teams'].includes(data.status?.source) ? '語音辨識 · ' : '字幕活動 · ') + data.activeSpeakers.join('、') : (['done','failed'].includes(data.status?.state) ? '記錄已停止' : '等待新的發言…'));
    updateSummaryPanel(data);
    const filtered = filterRecords(data.records);
    void requestTranslations(filtered);
    $('count').textContent = filtered.length + ' 段發言';
    if (data.status?.source === 'teams' && data.status?.state === 'in_call') {
      const missing = Object.entries(data.status.audioHealth || {}).filter(([,value]) => value === 'no_signal').map(([lane]) => lane === 'mic' ? '本機麥克風' : '會議播放端');
      if (missing.length) $('speaking').textContent = missing.join('、') + ' 尚無訊號；發言後仍無訊號時請檢查裝置。';
    }
    if (data.status?.source === 'microphone' && data.status?.queuedSegments > 1 && data.status?.state === 'in_call') {
      $('count').textContent += ' · 待辨識 ' + data.status.queuedSegments + ' 段';
    }
    $('meet').hidden = true;
    try { const url = new URL(data.status?.url); if (url.protocol === 'https:' && url.hostname === 'meet.google.com') { $('meet').href = url.href; $('meet').hidden = false; } } catch {}
    const target = secondaryLang ? secondaryLang.value : 'none';
    const next = JSON.stringify([data.id, filtered, data.pending, primaryLang?.value, target, filtered.map((r) => translations.get(target + ':' + r.text) || '')]);
    if (next !== signature) {
      const rows = [...filtered.map((r) => row(r, false)), ...data.pending.map((r) => row(r, true))];
      if (!rows.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '尚無字幕，開始發言後會自動顯示。'; rows.push(empty); }
      $('transcript').replaceChildren(...rows); signature = next;
      if ($('follow').checked && data.status?.state === 'in_call' && filtered.length + data.pending.length > 0) { const box = document.querySelector('.content-scroll') || $('transcript'); box.scrollTop = box.scrollHeight; rows.at(-1).scrollIntoView({ block:'nearest' }); }
    }
    $('connection').textContent = '● 已連線 · 自動更新';
    $('updated').textContent = '最後同步 ' + clock(Date.now());
  } catch { $('connection').textContent = '連線中斷 · 正在重試'; $('speaking').textContent = '畫面可能不是最新資料'; }
  finally { setTimeout(poll, 750); }
}
poll();
