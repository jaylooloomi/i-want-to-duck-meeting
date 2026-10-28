const $ = (id) => document.getElementById(id);
const selector = $('meeting'), primaryLang = $('primary-lang'), secondaryLang = $('secondary-lang');
const params = new URLSearchParams(location.search);
let selected = params.get('id') || 'latest';
if (primaryLang && params.get('primary')) primaryLang.value = params.get('primary');
if (secondaryLang && params.get('secondary')) secondaryLang.value = params.get('secondary');
let signature = '', translating = false;
const translations = new Map();
function syncSelection() {
  const url = new URL(location.href); url.searchParams.set('id', selected);
  if (primaryLang) { if (primaryLang.value !== 'all') url.searchParams.set('primary', primaryLang.value); else url.searchParams.delete('primary'); }
  if (secondaryLang) { if (secondaryLang.value !== 'none') url.searchParams.set('secondary', secondaryLang.value); else url.searchParams.delete('secondary'); }
  history.replaceState(null, '', url);
}
document.addEventListener('microphone-started', ({ detail }) => {
  selected = detail.id; signature = ''; selector.dataset.signature = '';
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
selector.addEventListener('change', () => { selected = selector.value; signature = ''; syncSelection(); });
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
      $('count').textContent = '0 段發言'; $('meet').hidden = true; $('meet').removeAttribute('href');
      $('updated').textContent = ''; signature = '';
      $('connection').textContent = '● 已連線'; return;
    }
    const data = await get('/api/transcript?id=' + encodeURIComponent(selected));
    document.dispatchEvent(new CustomEvent('meeting-status', { detail:data }));
    $('state').textContent = states[data.status?.state] || '未知狀態';
    $('speaking').textContent = data.status?.error?.message || (data.activeSpeakers.length ? (['microphone','teams'].includes(data.status?.source) ? '語音辨識 · ' : '字幕活動 · ') + data.activeSpeakers.join('、') : (['done','failed'].includes(data.status?.state) ? '記錄已停止' : '等待新的發言…'));
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
      if ($('follow').checked && data.status?.state === 'in_call' && filtered.length + data.pending.length > 0) { const box = $('transcript'); box.scrollTop = box.scrollHeight; rows.at(-1).scrollIntoView({ block:'nearest' }); }
    }
    $('connection').textContent = '● 已連線 · 自動更新';
    $('updated').textContent = '最後同步 ' + clock(Date.now());
  } catch { $('connection').textContent = '連線中斷 · 正在重試'; $('speaking').textContent = '畫面可能不是最新資料'; }
  finally { setTimeout(poll, 750); }
}
poll();
