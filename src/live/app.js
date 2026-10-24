const $ = (id) => document.getElementById(id);
const selector = $('meeting');
let selected = new URLSearchParams(location.search).get('id') || 'latest';
let signature = '';
document.addEventListener('microphone-started', ({ detail }) => {
  selected = detail.id; signature = ''; selector.dataset.signature = '';
  history.replaceState(null, '', '?id=' + encodeURIComponent(selected));
});
const states = { starting:'準備中', launching:'啟動中', joining:'加入中', waiting_admission:'等待放行', in_call:'記錄中', leaving:'收尾中', transcribing:'轉錄中', done:'已結束', failed:'記錄失敗' };
const clock = (value) => { const date = new Date(value); return Number.isNaN(+date) ? '' : date.toLocaleTimeString('zh-TW', { hour12:false }); };
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
  body.append(meta, text); card.append(avatar, body); return card;
}
selector.addEventListener('change', () => {
  selected = selector.value; signature = '';
  history.replaceState(null, '', '?id=' + encodeURIComponent(selected));
});
async function get(url) { const response = await fetch(url); if (!response.ok) throw new Error('讀取失敗'); return response.json(); }
async function poll() {
  try {
    const meetings = await get('/api/meetings');
    const optionSignature = JSON.stringify(meetings);
    if (selector.dataset.signature !== optionSignature) {
      const options = [new Option('自動跟隨最新會議', 'latest'), ...meetings.map((m) => new Option(m.id + ' · ' + (states[m.state] || '未知'), m.id))];
      selector.replaceChildren(...options); selector.value = selected;
      if (!selector.value) { selected = 'latest'; selector.value = selected; }
      selector.dataset.signature = optionSignature;
    }
    if (!meetings.length) {
      $('state').textContent = '尚無會議'; $('speaking').textContent = '加入會議後將自動顯示';
      $('connection').textContent = '● 已連線'; return;
    }
    const data = await get('/api/transcript?id=' + encodeURIComponent(selected));
    document.dispatchEvent(new CustomEvent('meeting-status', { detail:data }));
    $('state').textContent = states[data.status?.state] || '未知狀態';
    $('speaking').textContent = data.status?.error?.message || (data.activeSpeakers.length ? (['microphone','teams'].includes(data.status?.source) ? '語音辨識 · ' : '字幕活動 · ') + data.activeSpeakers.join('、') : (['done','failed'].includes(data.status?.state) ? '記錄已停止' : '等待新的發言…'));
    $('count').textContent = data.records.length + ' 段發言';
    if (data.status?.source === 'microphone' && data.status?.queuedSegments > 1 && data.status?.state === 'in_call') {
      $('count').textContent += ' · 待辨識 ' + data.status.queuedSegments + ' 段';
    }
    $('meet').hidden = true;
    try { const url = new URL(data.status?.url); if (url.protocol === 'https:' && url.hostname === 'meet.google.com') { $('meet').href = url.href; $('meet').hidden = false; } } catch {}
    const next = JSON.stringify([data.id, data.records, data.pending]);
    if (next !== signature) {
      const rows = [...data.records.map((r) => row(r, false)), ...data.pending.map((r) => row(r, true))];
      if (!rows.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '尚無字幕，開始發言後會自動顯示。'; rows.push(empty); }
      $('transcript').replaceChildren(...rows); signature = next;
      if ($('follow').checked && data.status?.state === 'in_call' && data.records.length + data.pending.length > 0) rows.at(-1).scrollIntoView({ block:'end' });
    }
    $('connection').textContent = '● 已連線 · 自動更新';
    $('updated').textContent = '最後同步 ' + clock(Date.now());
  } catch { $('connection').textContent = '連線中斷 · 正在重試'; $('speaking').textContent = '畫面可能不是最新資料'; }
  finally { setTimeout(poll, 750); }
}
poll();
