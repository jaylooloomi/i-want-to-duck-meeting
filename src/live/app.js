const uiText=(source,values)=>window.DuckI18n.t(source,values);
const $ = (id) => document.getElementById(id);
const primaryLang = $('primary-lang'), secondaryLang = $('secondary-lang');
const meetingList = $('meeting-list'), meetingTotal = $('meeting-total'), archivedCountEl = $('archived-count');
const workspaceGrid = $('workspace-grid'), paneCount = $('pane-count');
const summaryPanel = $('summary-panel'), summaryProgressWrap = $('summary-progress-wrap'), summaryBody = $('summary-body');
const summaryStage = $('summary-stage'), summaryPercent = $('summary-percent'), summaryFill = $('summary-progress-fill');
const summaryBadge = $('summary-badge'), summaryRegen = $('summary-regenerate'), summaryToggle = $('summary-toggle'), summaryExport = $('summary-export'), summaryExportAi = $('summary-export-ai');
const reportBtn = $('report-issue-btn'), sidebarReportBtn = $('sidebar-report-btn'), issueModal = $('issue-modal'), issueClose = $('issue-modal-close');
const issueTitleInput = $('issue-title-input'), issueDescInput = $('issue-desc-input'), issueCopyBtn = $('issue-copy-template'), issueGithubLink = $('issue-github-link');
const params = new URLSearchParams(location.search);
let selected = params.get('id') || 'latest';
// Explicit language URLs retain their independently specified display preferences.
if(params.has('primary')||params.has('secondary')){primaryLang.value='all';secondaryLang.value='none';}
if (primaryLang && params.get('primary')) primaryLang.value = params.get('primary');
if (secondaryLang && params.get('secondary')) secondaryLang.value = params.get('secondary');
let signature = '', summarySignature = '', translating = false, summaryCollapsed = false, activeMeetingId = '';
let meetingOptionsSignature = '', currentRecord = null, ownedRecordId = '', setupOpen = false, endingRecordId = '', stopRequestedFor = '';
const setupPanel = document.querySelector('.mic-panel');
const recordingStates = new Set(['starting','launching','joining','waiting_login','selecting_account','waiting_admission','in_call','leaving','transcribing']);
let sidebarFilter = 'active', cachedMeetings = [], confirmDeleteId = '';
const translationRetryAt = new Map(), translationNextAt = new Map(), draftTranslations = new Map();
const translations = new Map(), autoTriggeredIds = new Set();
function syncSelection() {
  const url = new URL(location.href); url.searchParams.set('id', selected);
  if(primaryLang)url.searchParams.set('primary',primaryLang.value||'all');
  if(secondaryLang)url.searchParams.set('secondary',secondaryLang.value||'none');
  history.replaceState(null, '', url);
}
function selectMeeting(id) {
  if (!id) return;
  selected = id;
  $('record-action-status').textContent = '';
  setupOpen = false;
  setupPanel.hidden = true;
  $('follow-latest').checked = selected === 'latest';
  signature = ''; summarySignature = '';
  syncSelection();
  updateSidebarActive();
  void pollNow();
}
document.querySelectorAll('.view-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.view || 'split';
    if (workspaceGrid) workspaceGrid.dataset.view = mode;
    document.querySelectorAll('.view-tab').forEach((b) => b.classList.toggle('active', b === btn));
  });
});
document.querySelectorAll('.sidebar-filter').forEach((btn) => {
  btn.addEventListener('click', () => {
    sidebarFilter = btn.dataset.filter || 'active';
    confirmDeleteId = '';
    document.querySelectorAll('.sidebar-filter').forEach((b) => {b.classList.toggle('active', b === btn);b.setAttribute('aria-pressed',String(b===btn));});
    renderSidebar(cachedMeetings);
  });
});
document.addEventListener('microphone-started', ({ detail }) => {
  ownedRecordId = detail.id; setupOpen = false; setupPanel.hidden = true;
  selectMeeting(detail.id); meetingOptionsSignature = '';
  syncSelection();
});
const states = { starting:'準備中', launching:'啟動中', joining:'加入中', waiting_login:'等待 Google 登入', selecting_account:'等待選擇記錄帳號', waiting_admission:'等待放行', in_call:'記錄中', leaving:'收尾中', transcribing:'轉錄中', done:'已完成', archived:'已封存', failed:'記錄失敗' };
const sidebarStates = { starting:'準備中', launching:'啟動中', joining:'加入中', waiting_login:'待登入', selecting_account:'待選帳號', waiting_admission:'待放行', in_call:'● 收音中', leaving:'收尾中', transcribing:'轉錄中', done:'已完成', archived:'📦 已封存', failed:'✕ 異常' };
const recordingClock=value=>{const base=Date.parse(currentRecord?.status?.joinedAt||currentRecord?.status?.startedAt),at=Date.parse(value);if(!Number.isFinite(base)||!Number.isFinite(at))return clock(value);const seconds=Math.max(0,Math.floor((at-base)/1000));return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');};
const clock = (value) => { const date = new Date(value); return Number.isNaN(+date) ? '' : date.toLocaleTimeString(window.DuckI18n.language, { hour12:false }); };
const hasCjk = (s) => /[\u3400-\u9FFF\uF900-\uFAFF]/.test(s);
function formatMeetingMeta(m) {
  const match=/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(.+)$/.exec(m.id||'');
  const labels={'teams-audio':uiText('Teams 會議收音'),'local-mic':uiText('現場麥克風收音'),teams:uiText('Teams 線上會議')};
  const title=m.title||labels[m.code]||m.code||m.id;
  const start=new Date(m.startedAt),end=new Date(m.endedAt);
  if(m.startedAt && Number.isFinite(+start)){
    const date=start.toLocaleDateString(window.DuckI18n.language,{year:'numeric',month:'2-digit',day:'2-digit'});
    const clock=d=>d.toLocaleTimeString(window.DuckI18n.language,{hour12:false,hour:'2-digit',minute:'2-digit'});
    return {title,dateOnly:date,dateStr:date+' '+clock(start)+(m.endedAt&&Number.isFinite(+end)?' – '+clock(end):'')};
  }
  if(!match)return {title,dateOnly:m.id,dateStr:m.id};
  const [,y,mo,d,h,mi]=match;return {title,dateOnly:`${y}/${mo}/${d}`,dateStr:`${y}/${mo}/${d} ${h}:${mi}`};
}
function stateClass(st) {
  if (st === 'in_call' || st === 'starting' || st === 'joining' || st === 'launching') return 'live';
  if (st === 'failed') return 'failed';
  if (st === 'archived') return 'archived';
  return 'done';
}
async function performMeetingAction(id, action) {
  if (!id || id === 'latest') return;
  try {
    const res = await fetch('/api/meetings/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    });
    if (!res.ok) {const error=await res.json();$('workspace-message').textContent=error.error||uiText('會議操作未完成');return;}
    confirmDeleteId = '';
    if (action === 'delete' && (selected === id || activeMeetingId === id)) {
      selected = 'latest';
      syncSelection();
    }
    meetingOptionsSignature = '';
    signature = '';
    summarySignature = '';
    await pollNow();
  } catch {}
}
function updateSidebarActive() {
  if (!meetingList) return;
  for (const card of meetingList.querySelectorAll('.meeting-card')) {
    const id = card.dataset.id;
    const isCurrent = id === selected || (selected === 'latest' && id === activeMeetingId && id !== 'latest');
    card.classList.toggle('active', id === selected || (selected === 'latest' && id === 'latest'));
    card.classList.toggle('current-resolved', isCurrent);
  }
}
function platformIcon(meeting){
  const kind=['meet','teams','microphone','desktop','unknown'].includes(meeting.platform)?meeting.platform:meeting.source==='meet'?'meet':meeting.source==='microphone'?'microphone':meeting.source==='teams'?'desktop':'unknown';
  const label={meet:'Google Meet',teams:'Microsoft Teams',microphone:uiText('本機麥克風'),desktop:uiText('電腦雙路錄音'),unknown:uiText('會議（類型未確認）')}[kind];
  const wrap=document.createElement('span');wrap.className='meeting-platform '+kind;wrap.title=label;
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 32 28');svg.setAttribute('role','img');svg.setAttribute('aria-label',label);svg.setAttribute('focusable','false');
  const shapes={
    meet:[['path',{d:'M3 8 10 1h10v7Z',fill:'#fbbc04'}],['path',{d:'M3 8h7v18H5a2 2 0 0 1-2-2Z',fill:'#4285f4'}],['path',{d:'M10 8h12v18H10Z',fill:'#34a853'}],['path',{d:'m22 10 8-6v20l-8-6Z',fill:'#188038'}],['path',{d:'M10 8h10v5H10Z',fill:'#188038'}]],
    teams:[['circle',{cx:20,cy:5,r:4,fill:'#7b83eb'}],['circle',{cx:28,cy:8,r:3,fill:'#5059c9'}],['rect',{x:23,y:12,width:8,height:12,rx:3,fill:'#464eb8'}],['rect',{x:12,y:11,width:15,height:15,rx:4,fill:'#7b83eb'}],['rect',{x:1,y:8,width:18,height:18,rx:2,fill:'#6264a7'}],['path',{d:'M5 12h10v3h-3.5v8h-3v-8H5Z',fill:'#fff'}]],
    microphone:[['rect',{x:12,y:2,width:8,height:15,rx:4,fill:'#65a99a'}],['path',{d:'M8 12v2a8 8 0 0 0 16 0v-2M16 22v4m-5 0h10',fill:'none',stroke:'#65a99a','stroke-width':2,'stroke-linecap':'round'}]],
    desktop:[['rect',{x:3,y:3,width:26,height:18,rx:2,fill:'none',stroke:'#648fb9','stroke-width':2}],['path',{d:'M16 22v4m-6 0h12M8 10v5m4-8v10m4-6v4m4-9v12m4-9v6',fill:'none',stroke:'#648fb9','stroke-width':2,'stroke-linecap':'round'}]],
    unknown:[['rect',{x:3,y:5,width:19,height:18,rx:3,fill:'none',stroke:'#8196ab','stroke-width':2}],['path',{d:'m22 11 7-5v16l-7-5',fill:'none',stroke:'#8196ab','stroke-width':2}],['path',{d:'M10 10a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3v1',fill:'none',stroke:'#8196ab','stroke-width':2}]]
  };
  for(const [tag,attributes] of shapes[kind]){const node=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));svg.append(node);}
  wrap.append(svg);return wrap;
}

function renderSidebar(meetings) {
  cachedMeetings = meetings;
  const activeList = meetings.filter((m) => m.state !== 'archived');
  const archivedList = meetings.filter((m) => m.state === 'archived');
  if (meetingTotal) meetingTotal.textContent = String(activeList.length);
  if (archivedCountEl) {archivedCountEl.textContent = String(archivedList.length);archivedCountEl.hidden=archivedList.length===0;}
  if (!meetingList) return;
  const frag = document.createDocumentFragment();
  const query=$('meeting-search').value.trim().toLocaleLowerCase();
  const visibleMeetings = (sidebarFilter === 'archived' ? archivedList : activeList).filter(m=>[m.title,m.code,m.id,formatMeetingMeta(m).dateStr].join(' ').toLocaleLowerCase().includes(query));
  if (!visibleMeetings.length && sidebarFilter === 'archived') {
    const empty = document.createElement('div');
    empty.className = 'sidebar-empty';
    empty.textContent = uiText('目前沒有已封存的會議紀錄');
    frag.append(empty);
  }
  if(query && !visibleMeetings.length){const empty=document.createElement('p');empty.className='sidebar-empty';empty.textContent=uiText('找不到符合的會議');frag.append(empty);}
  let lastDay='';
  for (const m of visibleMeetings) {
    const date=new Date(m.startedAt || m.id.slice(0,8).replace(/(....)(..)(..)/,'$1-$2-$3'));
    const day=Number.isNaN(+date)?uiText('其他會議'):date.toLocaleDateString(window.DuckI18n.language);
    if(day!==lastDay){const h=document.createElement('h3');h.className='meeting-day';const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);h.textContent=day===new Date().toLocaleDateString(window.DuckI18n.language)?uiText('今天'):day===yesterday.toLocaleDateString(window.DuckI18n.language)?uiText('昨天'):day;frag.append(h);lastDay=day;}
    const info = formatMeetingMeta(m);
    const card = document.createElement('div');
    card.className = 'meeting-card'; card.dataset.id = m.id;
    const mainBtn = document.createElement('button');
    mainBtn.type = 'button'; mainBtn.className = 'meeting-card-select';
    const top = document.createElement('div'); top.className = 'meeting-card-top';
    const title = document.createElement('span'); title.className = 'meeting-card-title'; title.textContent = info.title;
    const badge = document.createElement('span'); badge.className = 'meeting-card-state ' + stateClass(m.state); badge.textContent = uiText(sidebarStates[m.state] || '未知');
    mainBtn.append(platformIcon(m));top.append(title,badge);
    const meta = document.createElement('div'); meta.className = 'meeting-card-meta';
    const dt = document.createElement('span'); dt.textContent = info.dateOnly;mainBtn.title=info.title+' · '+info.dateStr;
    const codeSpan = document.createElement('span'); codeSpan.textContent = m.code || '';
    meta.append(dt, codeSpan);
    mainBtn.append(top, meta);
    mainBtn.addEventListener('click', () => selectMeeting(m.id));
    const actions = document.createElement('div');
    actions.className = 'meeting-card-actions';
    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'card-action-btn export';
    exportBtn.textContent = uiText('匯出');
    exportBtn.title = uiText('一鍵打包下載此場會議所有檔案（錄音、逐字稿、會議紀錄整理 ZIP）');
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportMeeting(m.id);
    });
    actions.append(exportBtn);
    const isArchived = m.state === 'archived';
    const archiveBtn = document.createElement('button');
    archiveBtn.type = 'button'; archiveBtn.disabled=recordingStates.has(m.state)||m.canArchive===false;
    archiveBtn.className = 'card-action-btn archive';
    archiveBtn.textContent = isArchived ? uiText('取消封存') : uiText('封存');
    archiveBtn.title = isArchived ? uiText('將此會議移回一般清單') : uiText('將此會議移至封存區');
    archiveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void performMeetingAction(m.id, isArchived ? 'unarchive' : 'archive');
    });
    actions.append(archiveBtn);
    if (confirmDeleteId === m.id) {
      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'card-action-btn delete-confirm';
      confirmBtn.textContent = uiText('確定刪除？');
      confirmBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        void performMeetingAction(m.id, 'delete');
      });
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'card-action-btn cancel';
      cancelBtn.textContent = uiText('取消');
      cancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        confirmDeleteId = '';
        renderSidebar(cachedMeetings);
      });
      actions.append(confirmBtn, cancelBtn);
    } else {
      const delBtn = document.createElement('button');
      delBtn.type = 'button'; delBtn.disabled=recordingStates.has(m.state)||m.canArchive===false;
      delBtn.className = 'card-action-btn delete';
      delBtn.textContent = uiText('刪除');
      delBtn.title = uiText('永久刪除此場會議紀錄');
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        confirmDeleteId = m.id;
        renderSidebar(cachedMeetings);
      });
      actions.append(delBtn);
    }
    card.append(mainBtn, actions);
    frag.append(card);
  }
  meetingList.replaceChildren(frag);
  updateSidebarActive();
}
function filterRecords(records) {
  const mode = primaryLang ? primaryLang.value : 'all';
  if(['de','ja','ko'].includes(mode))return records.filter(record=>{const raw=record.language||record.lang;const language=typeof raw==='string'?raw.trim().toLowerCase().split(/[-_]/)[0]:'';return !language||language==='und'||language==='unknown'||language===mode;});
  if (mode === 'zh-TW') return records.filter((r) => hasCjk(r.text));
  if (mode === 'en') return records.filter((r) => !hasCjk(r.text));
  return records;
}
function searchRecords(records){const text=$('transcript-search').value.trim().toLocaleLowerCase();return records.filter(r=>(!$('highlights-only').checked||r.highlightCount>0)&&[r.text,r.speaker].join(' ').toLocaleLowerCase().includes(text));}
function draftKey(record,target,meetingId=currentRecord?.id){return [meetingId,target,record.speaker||'',record.t0||''].join('|');}
async function requestTranslations(records,pending=[],meetingId=currentRecord?.id) {
  const target=secondaryLang?.value||'none';
  const status=text=>{if(secondaryLang?.value===target && currentRecord?.id===meetingId)$('translation-status').textContent=text;};
  if(target==='none'){status('');return;}
  if(translating || Date.now()<(translationRetryAt.get(target)||0) || Date.now()<(translationNextAt.get(target)||0))return;
  const draftRows=pending.filter(r=>r.text?.trim().length>=2 && draftTranslations.get(draftKey(r,target,meetingId))?.source!==r.text).slice(-4);
  const finals=[...new Set(records.map(r=>r.text).filter(t=>t&&!translations.has(target+':'+t)))].slice(-4);
  const texts=[...new Set([...draftRows.map(r=>r.text),...finals])];
  if(!texts.length){status('');return;}
  translating=true;translationNextAt.set(target,Date.now()+1400);status(draftRows.length?uiText('即時暫譯中…'):uiText('翻譯中…'));
  try{
    const response=await fetch('/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({texts,target}),signal:AbortSignal.timeout(7000)});
    if(!response.ok)throw new Error('service');
    const data=await response.json();if(!Array.isArray(data.translations))throw new Error('format');
    let missing=false;
    texts.forEach((text,i)=>{
      const translated=data.translations[i];if(typeof translated!=='string'||!translated.trim()){missing=true;return;}
      if(finals.includes(text))translations.set(target+':'+text,translated);
      for(const row of draftRows.filter(r=>r.text===text))draftTranslations.set(draftKey(row,target,meetingId),{source:text,text:translated});
    });
    while(draftTranslations.size>96)draftTranslations.delete(draftTranslations.keys().next().value);
    if(missing){status(uiText('部分翻譯暫時無法取得，將自動重試。'));translationRetryAt.set(target,Date.now()+5000);}
    else{status('');translationRetryAt.delete(target);}
    signature='';
  }catch{status(uiText('翻譯服務暫時無法使用，將自動重試。'));translationRetryAt.set(target,Date.now()+5000);}
  finally{translating=false;}
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
  let currentList=null,currentTable=null,tbody=null,tableHeaders=[],actionSection=false,actionLevel=0;const actionOccurrences=new Map();
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) { currentList = null; currentTable = null; tbody = null; continue; }
    if (line.startsWith('|') && line.endsWith('|')) {
      currentList = null;
      const cells = line.slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g,'|'));
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      if (!currentTable) {
        tableHeaders=cells;
        currentTable = document.createElement('table'); currentTable.className = 'summary-table';
        const thead = document.createElement('thead'), tr = document.createElement('tr');
        for (const c of cells) { const th = document.createElement('th'); appendInline(th, c); tr.append(th); }
        thead.append(tr); tbody = document.createElement('tbody'); currentTable.append(thead, tbody); frag.append(currentTable);
      } else {
        const tr = document.createElement('tr');
        const rowSignature=JSON.stringify(cells),occurrence=actionOccurrences.get(rowSignature)||0;
        const task=actionSection?(currentRecord?.workspace?.actions?.items||[]).filter(item=>JSON.stringify(item.cells)===rowSignature)[occurrence]:null;
        if(actionSection)actionOccurrences.set(rowSignature,occurrence+1);
        if(task)tr.classList.toggle('task-complete',task.completed);
        for (const [index,c] of cells.entries()) {
          const td=document.createElement('td');
          if(/負責人|owner/i.test(tableHeaders[index]||'') && c && !/未指定|未確認|unknown/i.test(c) && /^[\p{L} .-]{1,40}$/u.test(c)){
            const owner=document.createElement('span');owner.className='owner-chip';
            const icon=document.createElement('span');icon.className='owner-avatar';icon.setAttribute('aria-hidden','true');const names=[...new Set((currentRecord?.records||[]).map(r=>r.speaker).filter(name=>typeof name==='string'&&(name===c||name.startsWith(c+' '))))];const displayName=names.length===1?names[0]:c;icon.textContent=/^[A-Za-z]/.test(displayName)?displayName.split(/\s+/).slice(0,2).map(word=>word[0]).join('').toUpperCase():[...displayName][0];
            owner.append(icon,document.createTextNode(c));td.append(owner);
          }else if(/期限|時限|due/i.test(tableHeaders[index]||'') && c && !/未指定|未確認/i.test(c)){
            const due=document.createElement('span');due.className='due-chip';appendInline(due,c);td.append(due);
          }else appendInline(td,c);
          if(task&&index===task.column){td.setAttribute('aria-label',c);const label=document.createElement('label');label.className='task-label';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=task.completed;checkbox.setAttribute('aria-label',uiText('完成待辦：')+task.text);checkbox.addEventListener('change',()=>document.dispatchEvent(new CustomEvent('action-item-change',{detail:{id:currentRecord.id,key:task.key,revision:currentRecord.workspace.actions.revision,completed:checkbox.checked,control:checkbox}})));label.append(checkbox,...td.childNodes);td.append(label);}
          tr.append(td);
        }
        tbody.append(tr);
      }
      continue;
    }
    currentTable = null; tbody = null;
    const hMatch = /^(#{1,3})\s+(.+)$/.exec(line);
    if (hMatch) {
      currentList = null;if(/行動|待辦|action items|next steps/i.test(hMatch[2])){actionSection=true;actionLevel=hMatch[1].length;}else if(hMatch[1].length<=actionLevel)actionSection=false;
      const h = document.createElement(hMatch[1].length === 1 ? 'h3' : hMatch[1].length === 2 ? 'h3' : 'h4');
      if(hMatch[1].length===1 && hMatch[2].trim()===currentRecord?.workspace?.title)continue;
      h.className='summary-h';appendInline(h,hMatch[2]);frag.append(h);continue;
    }
    const liMatch = /^(?:[-*•]|\d+\.)\s+(.+)$/.exec(line);
    if (liMatch) {
      if (!currentList) { currentList=document.createElement(/^\d+\./.test(line)?'ol':'ul');currentList.className='summary-list';if(currentList.tagName==='OL')currentList.classList.add('decision-list'); frag.append(currentList); }
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
  const targetId = meetingId === 'latest' ? activeMeetingId : meetingId;
  if (!targetId) return;
  try {
    const response = await fetch('/api/summarize', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ id:targetId, force }) });
    const result=await response.json();if(!response.ok)throw new Error(result.error||uiText('無法提交整理請求'));
    summarySignature='';await pollNow();
  } catch(error) { $('workspace-message').textContent=uiText('整理請求失敗：')+error.message; }
}
function exportMeeting(meetingId) {
  const targetId = meetingId === 'latest' ? activeMeetingId : meetingId;
  if (!targetId) return;
  const a = document.createElement('a');
  a.href = '/api/export?id=' + encodeURIComponent(targetId);
  a.download = targetId + '.zip';
  document.body.append(a);
  a.click();
  a.remove();
}
async function exportForCustomAi(meetingId) {
  const targetId = meetingId === 'latest' ? activeMeetingId : meetingId;
  if (!targetId) return;
  const origText = summaryExportAi ? summaryExportAi.textContent : '';
  try {
    const res = await fetch('/api/export-prompt?id=' + encodeURIComponent(targetId));
    if (!res.ok) return;
    const data = await res.json();
    let copied = false;
    if (navigator.clipboard?.writeText && data.content) {
      try { await navigator.clipboard.writeText(data.content); copied = true; } catch {}
    }
    const blob = new Blob([data.content || ''], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = data.filename || (targetId + '-ai-prompt.md');
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    if (summaryExportAi) {
      summaryExportAi.textContent = copied ? uiText('✓ 已複製並匯出 AI 整理包！') : uiText('✓ 已下載 AI 整理包！');
      setTimeout(() => { summaryExportAi.textContent = origText; }, 2800);
    }
  } catch {}
}
summaryExport?.addEventListener('click', () => exportMeeting(selected));
summaryExportAi?.addEventListener('click', () => { void exportForCustomAi(selected); });
function buildIssueMarkdown() {
  const modeVal = $('audio-mode')?.value || 'unknown';
  const stateVal = $('state')?.textContent || uiText('未知');
  const countVal = $('count')?.textContent || uiText('0 段發言');
  const userDesc = (issueDescInput?.value || '').trim() || '（請在此描述您遇到的問題、操作步驟與預期結果）';
  return [
    '### 📝 問題描述',
    userDesc,
    '',
    '### 📸 畫面截圖（請按 Ctrl+V 直接貼上截圖）',
    '<!-- 請先按 Win + Shift + S 截圖，並在此處按 Ctrl + V 貼上圖片 -->',
    '',
    '### 💻 環境與會議狀態診斷資訊（系統自動帶入）',
    `- **會議 ID**：\`${activeMeetingId || selected || 'none'}\``,
    `- **收音來源模式**：\`${modeVal}\``,
    `- **目前狀態**：${stateVal}（${countVal}）`,
    `- **語言設定**：主要 \`${primaryLang?.value || 'all'}\` / 翻譯 \`${secondaryLang?.value || 'none'}\``,
    `- **時間**：${new Date().toISOString()}`,
  ].join('\n');
}
function syncIssueGithubLink() {
  if (!issueGithubLink) return;
  const baseUrl = 'https://github.com/jaylooloomi/i-want-to-duck-meeting/issues/new';
  const rawTitle = (issueTitleInput?.value || '').trim();
  const title = rawTitle ? `[問題回報] ${rawTitle}` : `[問題回報] 會議記錄異常 (${activeMeetingId || selected || 'live'})`;
  const body = buildIssueMarkdown();
  const u = new URL(baseUrl);
  u.searchParams.set('title', title);
  u.searchParams.set('body', body);
  issueGithubLink.href = u.toString();
}
function openIssueModal() {
  if (!issueModal) return;
  syncIssueGithubLink();
  issueModal.hidden = false;
  issueTitleInput?.focus();
}
function closeIssueModal() {
  if (!issueModal) return;
  issueModal.hidden = true;
}
reportBtn?.addEventListener('click', openIssueModal);
sidebarReportBtn?.addEventListener('click', openIssueModal);
issueClose?.addEventListener('click', closeIssueModal);
issueModal?.addEventListener('click', (e) => { if (e.target === issueModal) closeIssueModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && issueModal && !issueModal.hidden) closeIssueModal(); });
issueTitleInput?.addEventListener('input', syncIssueGithubLink);
issueDescInput?.addEventListener('input', syncIssueGithubLink);
issueCopyBtn?.addEventListener('click', async () => {
  syncIssueGithubLink();
  const text = buildIssueMarkdown();
  const orig = issueCopyBtn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    issueCopyBtn.textContent = uiText('✓ 已複製回報範本！');
    setTimeout(() => { issueCopyBtn.textContent = orig; }, 2200);
  } catch {}
});
summaryRegen?.addEventListener('click', () => {
  summaryCollapsed = false;
  if (summaryToggle) summaryToggle.textContent = uiText('收合');
  void requestSummarize(selected, true);
});
summaryToggle?.addEventListener('click', () => {
  summaryCollapsed = !summaryCollapsed;
  summaryToggle.textContent = summaryCollapsed ? uiText('展開') : uiText('收合');
  if (summaryBody) summaryBody.hidden = summaryCollapsed;
});
function updateSummaryPanel(data) {
  if (!summaryPanel) return;
  const st = data.status?.state;
  const sum = data.summary || { state:'idle', progress:0, stage:'' };
  summaryPanel.hidden = false;
  const nextSig = JSON.stringify([data.id, st, sum.state, sum.progress, sum.stage, sum.updatedAt, summaryCollapsed, data.records?.length || 0]);
  if (nextSig === summarySignature) return;
  summarySignature = nextSig;
  if(sum.state==='waiting_agent'){
    summaryBadge.textContent=uiText('等待 Codex／Claude 接手');summaryBadge.className='summary-badge';summaryProgressWrap.hidden=true;
    summaryRegen.disabled=true;summaryBody.hidden=false;
    const message=document.createElement('div');message.className='empty';message.textContent=uiText('已排入 AI Agent 整理佇列。不使用 Ollama；此對話的背景追蹤啟動後，會由 Agent 親自讀取逐字稿並整理。');summaryBody.replaceChildren(message);return;
  }
  if (st === 'leaving' || st === 'transcribing' || sum.state === 'generating') {
    const pct = sum.state === 'generating' ? Math.max(0, Math.min(100,Number(sum.progress) || 0)) : 0;
    summaryBadge.textContent = uiText('正在整理中');
    summaryBadge.className = 'summary-badge generating';
    summaryProgressWrap.hidden = false;
    summaryStage.textContent = sum.state === 'generating' ? (sum.stage || uiText('正在整理會議記錄…')) : uiText('正在收尾並準備整理會議記錄…');
    summaryPercent.textContent = sum.state==='generating' ? pct+'%' : uiText('收尾中');
    summaryFill.style.width = pct + '%';
    summaryFill.parentElement?.setAttribute('aria-valuenow', String(pct));
    summaryRegen.disabled = true;
    if (!sum.markdown) { summaryBody.replaceChildren(); summaryBody.hidden = true; }
    return;
  }
  summaryRegen.disabled = !data.records?.length || !['done','failed'].includes(st);
  if (summaryExportAi) summaryExportAi.disabled = !data.records?.length;
  if (sum.state === 'ready' && sum.markdown) {
    summaryBadge.textContent = data.status?.summaryJob?.provider==='agent'?uiText('由 Agent 整理'):uiText('已完成整理');
    summaryBadge.className = 'summary-badge ready';
    summaryProgressWrap.hidden = true;
    summaryBody.replaceChildren(renderMarkdownDom(sum.markdown));
    summaryBody.hidden = summaryCollapsed;
    return;
  }
  summaryBadge.textContent = sum.state === 'failed' ? uiText('整理失敗') : (st === 'in_call' ? uiText('會議進行中') : uiText('尚未整理'));
  summaryBadge.className = 'summary-badge';
  summaryProgressWrap.hidden = true;
  const empty = document.createElement('div'); empty.className = 'empty';
  empty.textContent = data.records?.length
    ? (st === 'in_call' ? uiText('會議正在進行中。結束後可在 AI 對話框輸入「會議紀錄整理」交由 Agent 深度整理，或點擊右上角按鈕整理／匯出。') : uiText('此場會議尚未整理。您可以在 AI 對話框輸入「會議紀錄整理」交由 Agent 親自深度整理，或點擊上方「✨ 匯出逐字稿交由自訂 AI 整理」／「重新整理會議記錄」。'))
    : uiText('本場會議尚無有效對話字幕，累積發言後即可產生結構化會議記錄。');
  summaryBody.replaceChildren(empty);
  summaryBody.hidden = summaryCollapsed;
}
function row(record, pending) {
  const renderedMeetingId=currentRecord?.id;
  const card = document.createElement('article'); card.className = 'utterance' + (pending ? ' pending' : '');
  if(record.highlightCount)card.classList.add('important-utterance');
  const name = record.speaker || uiText('未知發言者');
  const hue = [...name].reduce((n, c) => (n * 31 + c.codePointAt(0)) % 360, 0);
  const avatar = document.createElement('div'); avatar.className = 'avatar'; avatar.style.setProperty('--hue', hue); avatar.textContent = name.match(/^講者 ([A-Z]+)$/)?.[1] || (/^[A-Za-z]/.test(name)?name.trim().split(/\s+/).slice(0,2).map(word=>word[0]).join('').toUpperCase():[...name].slice(0,1).join(''));
  const body = document.createElement('div'); body.className = 'body';
  const meta = document.createElement('div'); meta.className = 'meta';
  const speaker = document.createElement('strong'); speaker.textContent = name;
  const time = document.createElement('button'); time.type='button';time.className='transcript-seek';time.textContent=recordingClock(record.t0);time.title=clock(record.t0);time.setAttribute('aria-label',uiText('跳至錄音 ')+recordingClock(record.t0));time.disabled=!currentRecord?.workspace?.audio?.length || !['done','failed','archived'].includes(currentRecord?.status?.state);time.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('seek-recording',{detail:{time:record.t0}})));
  meta.append(speaker,time);
  const mark=document.createElement('button');mark.type='button';mark.className='utterance-highlight';mark.textContent=record.highlighted?'★':'☆';mark.title=record.highlighted?uiText('取消整段重點'):uiText('標記整段重點');mark.setAttribute('aria-label',(record.highlighted?uiText('取消整段重點：'):uiText('標記整段重點：'))+record.text.slice(0,40));mark.setAttribute('aria-pressed',String(!!record.highlighted));mark.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('highlight-utterance',{detail:{meetingId:renderedMeetingId,key:record.highlightKey,action:record.highlighted?'unmark':'mark'}})));meta.append(mark);
  const more=document.createElement('button');more.type='button';more.className='utterance-more';more.textContent='⋯';more.setAttribute('aria-label',uiText('段落操作：')+record.text.slice(0,40));more.addEventListener('click',()=>document.dispatchEvent(new CustomEvent('utterance-menu',{detail:{record,meetingId:renderedMeetingId}})));meta.append(more);
  if(record.highlightCount){const label=document.createElement('small');label.className='important-label';label.textContent='★ '+record.highlightCount+uiText(' 個重點');meta.append(label);}
  if (pending) { const draft = document.createElement('span'); draft.className = 'draft'; draft.textContent = record.source === 'local-audio' || record.source?.startsWith('teams-') ? uiText('語音辨識中') : uiText('字幕更新中'); meta.append(draft); }
  const text = document.createElement('p'); text.className = 'text'; text.textContent = record.text;
  body.append(meta, text);
  const target = secondaryLang ? secondaryLang.value : 'none';
  const exact=target!=='none'?translations.get(target+':'+record.text):'';
  const previous=target!=='none'?draftTranslations.get(draftKey(record,target)):null;
  const translated=exact||previous?.text||'';
  if (translated && translated !== record.text) {
    const sub=document.createElement('p');sub.className='subtext';
    if(pending||!exact){const label=document.createElement('small');label.className='draft-translation-label';label.textContent=uiText('暫譯 · 持續更新');sub.append(label);}
    const copy=document.createElement('span');copy.textContent=translated;sub.append(copy);
    body.append(sub);
  }
  card.append(avatar, body); return card;
}

primaryLang?.addEventListener('change', () => { signature = ''; syncSelection(); syncLanguagePresets(); void pollNow(); });
secondaryLang?.addEventListener('change', () => { signature = ''; syncSelection(); syncLanguagePresets(); void pollNow(); });
async function get(url) { const response = await fetch(url); if (!response.ok) throw new Error(uiText('讀取失敗')); return response.json(); }
async function pollNow() {
  try {
    const meetings = await get('/api/meetings');
    const optionSignature = JSON.stringify(meetings);
    if (meetingOptionsSignature !== optionSignature) {
      meetingOptionsSignature = optionSignature;
      if (selected !== 'latest' && !meetings.some(m=>m.id === selected)) { selected='latest'; syncSelection(); }
      renderSidebar(meetings);
    }
    cachedMeetings = meetings;
    updateRecordControls();
    if (!meetings.length) {
      document.dispatchEvent(new CustomEvent('workspace-empty'));
      currentRecord = null; activeMeetingId = ''; updateRecordControls();
      $('state').textContent = uiText('尚無會議'); $('speaking').textContent = uiText('加入會議後將自動顯示');
      $('transcript').replaceChildren(Object.assign(document.createElement('div'), { className:'empty', textContent:uiText('尚無字幕，開始發言後會自動顯示。') }));
      if (summaryBody) summaryBody.replaceChildren(Object.assign(document.createElement('div'), { className:'empty', textContent:uiText('尚無會議記錄可供整理。') }));
      $('count').textContent = uiText('0 段發言'); if (paneCount) paneCount.textContent = uiText('0 段對話');
      $('meet').hidden = true; $('meet').removeAttribute('href');
      $('updated').textContent = ''; signature = ''; summarySignature = '';
      $('connection').textContent = uiText('● 已連線'); return;
    }
    const requestedId = selected;
    const data = await get('/api/transcript?id=' + encodeURIComponent(requestedId));
    if (selected !== requestedId) return;
    activeMeetingId = data.id || '';
    currentRecord = data; updateRecordControls();
    updateSidebarActive();
    document.dispatchEvent(new CustomEvent('meeting-status', { detail:data }));
    $('state').textContent = uiText(states[data.status?.state] || '未知狀態');
    $('speaking').textContent = data.status?.error?.message || (data.activeSpeakers.length ? (['microphone','teams'].includes(data.status?.source) ? uiText('語音辨識 · ') : uiText('字幕活動 · ')) + data.activeSpeakers.join('、') : (['done','archived','failed'].includes(data.status?.state) ? uiText('記錄已停止') : uiText('等待新的發言…')));
    updateSummaryPanel(data);
    document.dispatchEvent(new CustomEvent('workspace-rendered',{detail:data}));
    const filtered = searchRecords(filterRecords(data.records));
    void requestTranslations(filtered,searchRecords(filterRecords(data.pending)),data.id);
    $('count').textContent = filtered.length + uiText(' 段發言');
    if (paneCount) paneCount.textContent = filtered.length + uiText(' 段對話');
    if (data.status?.source === 'teams' && data.status?.state === 'in_call') {
      const missing = Object.entries(data.status.audioHealth || {}).filter(([,value]) => value === 'no_signal').map(([lane]) => lane === 'mic' ? uiText('本機麥克風') : uiText('會議播放端'));
      if (missing.length) $('speaking').textContent = missing.join('、') + uiText(' 尚無訊號；發言後仍無訊號時請檢查裝置。');
    }
    if (data.status?.source === 'microphone' && data.status?.queuedSegments > 1 && data.status?.state === 'in_call') {
      $('count').textContent += uiText(' · 待辨識 ') + data.status.queuedSegments + uiText(' 段');
    }
    $('meet').hidden = true; $('meet').removeAttribute('href');
    for(const value of [data.status?.url,data.status?.recordingUrl]){
      try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port)continue;
        const label=url.hostname==='meet.google.com'?'進入 Meet ↗':['teams.live.com','teams.microsoft.com','teams.cloud.microsoft'].includes(url.hostname)?'進入 Teams ↗':null;
        if(label){$('meet').href=url.href;$('meet').textContent=uiText(label);$('meet').hidden=false;break;}
      }catch{}
    }
    const target = secondaryLang ? secondaryLang.value : 'none';
    const next = JSON.stringify([data.id, filtered, data.pending, primaryLang?.value, target, filtered.map((r) => translations.get(target + ':' + r.text) || '')]);
    if (next !== signature) {
      const rows = [...filtered.map((r) => row(r, false)), ...searchRecords(filterRecords(data.pending)).map((r) => row(r, true))];
      if (!rows.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = $('transcript-search').value.trim()?uiText('找不到符合的逐字稿'):uiText('尚無字幕，開始發言後會自動顯示。'); rows.push(empty); }
      $('transcript').replaceChildren(...rows); signature = next;
      if ($('follow').checked && data.status?.state === 'in_call' && filtered.length + data.pending.length > 0) { const box = $('transcript'); box.scrollTop = box.scrollHeight; rows.at(-1).scrollIntoView({ block:'nearest' }); }
    }
    $('connection').textContent = uiText('● 已連線 · 自動更新');
    $('updated').textContent = uiText('最後同步 ') + clock(Date.now());
  } catch { $('connection').textContent = uiText('連線中斷 · 正在重試'); $('speaking').textContent = uiText('畫面可能不是最新資料'); }
}
async function poll() {
  await pollNow();
  setTimeout(poll, 750);
}
poll();

function updateRecordControls() {
  const data = currentRecord, st = data?.status || {};
  const active = cachedMeetings.find(m=>recordingStates.has(m.state));
  $('follow-latest').checked = selected === 'latest';
  document.body.dataset.meetingState=st.state||'empty';document.body.dataset.captureSource=st.source||'';
  $('current-meeting-title').textContent = data?.workspace?.title || (data ? (st.source === 'microphone' ? uiText('現場錄音') : st.source === 'teams' ? uiText('電腦會議收音') : 'Google Meet') + ' · ' + (st.code || data.id) : uiText('會議工作台'));
  $('current-meeting-detail').textContent = data ? uiText('狀態：') + (uiText(states[st.state] || '未知狀態')) + (st.source === 'microphone' && st.state === 'in_call' ? uiText(' · 請保持此錄音分頁開啟；關閉分頁會停止收音。') : '') : uiText('從左側選擇會議，或新增記錄。');
  const canStop = data && recordingStates.has(st.state) && !['leaving','transcribing'].includes(st.state);
  $('end-record').hidden = !canStop;
  $('live-audio-health').hidden = st.state !== 'in_call';
  const levels = st.stats?.levels;
  $('record-mic-level').value = levels ? Math.min(1,(levels.mic || 0)/12000) : 0;
  $('record-system-level').value = levels ? Math.min(1,(levels.system || 0)/12000) : 0;
  $('record-system-meter').hidden = st.source !== 'teams';
  $('record-mic-meter').hidden = !['microphone','teams'].includes(st.source);
  $('record-audio-message').textContent = st.source === 'meet' ? uiText('會議字幕與音訊由記錄端擷取；有訊號不代表辨識完成。') : uiText('音量僅代表收到訊號，辨識結果稍後顯示。');
  $('end-record').disabled = endingRecordId === data?.id || stopRequestedFor === data?.id;
  if (data && stopRequestedFor === data.id && ['done','failed'].includes(st.state)) {
    $('record-action-status').textContent = st.state === 'done' ? uiText('記錄已保存') : uiText('記錄收尾失敗，請查看下方錯誤。');
    stopRequestedFor = '';
  }
  $('end-record').title = uiText('只停止這場記錄；線上會議的記錄端會離開，其他與會者不受影響。');
  $('return-record').hidden = !active || active.id === data?.id;
  $('return-record').onclick = ()=>selectMeeting(active.id);
  setupPanel.hidden = !setupOpen;
  $('capture-feedback').hidden = !(setupOpen || (ownedRecordId && ownedRecordId === data?.id));
}
$('follow-latest').addEventListener('change', event=>selectMeeting(event.target.checked ? 'latest' : activeMeetingId));
$('new-record').addEventListener('click', async()=>{
  await pollNow();
  const active = cachedMeetings.find(m=>recordingStates.has(m.state));
  if (active) { selectMeeting(active.id); $('record-action-status').textContent=uiText('已有進行中的記錄，已返回該場。'); return; }
  setupOpen = true; setupPanel.hidden = false; $('capture-feedback').hidden=false; $('record-action-status').textContent='';
  $('audio-mode').focus();
});
$('cancel-record').addEventListener('click',()=>{setupOpen=false;updateRecordControls();});
$('end-record').addEventListener('click',async()=>{
  const id = currentRecord?.id;
  if (!id || endingRecordId === id) return;
  endingRecordId=id; stopRequestedFor=id; updateRecordControls();
  $('record-action-status').textContent=uiText('正在停止並保存記錄…');
  try {
    if (id === ownedRecordId) {
      document.dispatchEvent(new CustomEvent('record-stop',{detail:{id}}));
    } else {
      const response=await fetch('/api/meetings/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,action:'stop'})});
      const result=await response.json(); if (!response.ok) throw new Error(result.error || uiText('停止失敗'));
    }
  } catch(error) { stopRequestedFor=''; $('record-action-status').textContent=uiText('停止失敗：')+error.message; }
  finally { endingRecordId=''; updateRecordControls(); await pollNow(); }
});
document.addEventListener('record-finished',({detail})=>{
  if (ownedRecordId === detail.id) ownedRecordId='';
  if (detail.error) stopRequestedFor='';
  if (currentRecord?.id === detail.id) $('record-action-status').textContent=detail.error || uiText('已停止收音，正在完成剩餘辨識。');
  void pollNow();
});
if (params.get('source') === 'teams') { setupOpen=true; setupPanel.hidden=false; }

document.addEventListener('record-level',({detail})=>{if(currentRecord?.id===detail.id) $('record-mic-level').value=detail.value;});

function syncLanguagePresets() {
  const hint=$('original-language-hint');hint.hidden=!['de','ja','ko'].includes(primaryLang.value);hint.textContent=uiText('依已標註語言篩選；未標註段落保留顯示。此設定不會切換平台字幕辨識語言。');
  $('lang-en-zh').setAttribute('aria-pressed',String(primaryLang.value === 'en' && secondaryLang.value === 'zh-TW'));
  $('lang-zh-en').setAttribute('aria-pressed',String(primaryLang.value === 'zh-TW' && secondaryLang.value === 'en'));
}
for (const [id,primary,secondary] of [['lang-en-zh','en','zh-TW'],['lang-zh-en','zh-TW','en']]) {
  $(id).addEventListener('click',()=>{
    primaryLang.value=primary; secondaryLang.value=secondary;
    signature=''; syncSelection(); syncLanguagePresets(); void pollNow();
  });
}
syncLanguagePresets();

$('meeting-search').addEventListener('input',()=>renderSidebar(cachedMeetings));
$('transcript-search').addEventListener('input',()=>{signature='';void pollNow();});

$('highlights-only').addEventListener('change',()=>{signature='';void pollNow();});

document.addEventListener('ui-language-change',()=>{signature='';summarySignature='';meetingOptionsSignature='';renderSidebar(cachedMeetings);syncLanguagePresets();void pollNow();});
