import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { listMeetings, resolveMeeting, readStatus, writeStatus, isProcessAlive } from './status.js';
import { MicrophoneService } from './microphone.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { sttPython } from './stt.js';

const translationCache = new Map();
import {requestAgentSummary} from './agent-summary.js';
import {readHighlights,highlightKey,updateHighlight,renderHighlightsMarkdown} from './highlights.js';
import {actionItems,setActionItem,storageInfo} from './workspace-actions.js';
import {workspaceData,meetingTitle,meetingPlatform,safeAudioFile,streamAudio} from './workspace-data.js';

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  CRC32_TABLE[i] = c >>> 0;
}
function crc32Chunk(buf, crc = 0xFFFFFFFF) {
  let c = crc >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC32_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return c >>> 0;
}
function dosDateTime(date = new Date()) {
  const y = Math.max(1980, date.getFullYear());
  const dosDate = ((y - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  return { dosDate, dosTime };
}
function collectExportFiles(rootDir, prefix = '') {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(rootDir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name.endsWith('.tmp') || e.name === 'STOP' || e.name === 'worker-env.json') continue;
    const full = path.join(rootDir, e.name);
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...collectExportFiles(full, rel));
    } else if (e.isFile()) {
      try {
        const st = fs.statSync(full);
        if (st.size === 0 && (e.name.endsWith('.log') || e.name.endsWith('.out'))) continue;
        out.push({ full, rel, mtime: st.mtime });
      } catch { /* ignore */ }
    }
  }
  return out;
}
function streamMeetingZip(res, meetingId, meetingDir) {
  const files = collectExportFiles(meetingDir, meetingId);
  const statusFile = path.join(meetingDir, 'status.json');
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${encodeURIComponent(meetingId)}.zip"`,
  });
  const centralEntries = [];
  let offset = 0;
  const writeBuf = (buf) => { res.write(buf); offset += buf.length; };
  for (const f of files) {
    let dataBuf;
    let crc = 0;
    let size = 0;
    if (path.resolve(f.full) === path.resolve(statusFile)) {
      try {
        const rawObj = JSON.parse(fs.readFileSync(f.full, 'utf8'));
        delete rawObj.token;
        delete rawObj.pid;
        dataBuf = Buffer.from(JSON.stringify(rawObj, null, 2) + '\n', 'utf8');
      } catch {
        dataBuf = fs.readFileSync(f.full);
      }
      size = dataBuf.length;
      crc = (crc32Chunk(dataBuf) ^ 0xFFFFFFFF) >>> 0;
    } else {
      let c = 0xFFFFFFFF;
      const fd = fs.openSync(f.full, 'r');
      const chunk = Buffer.allocUnsafe(262144);
      try {
        let bytesRead = 0;
        while ((bytesRead = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) {
          c = crc32Chunk(chunk.subarray(0, bytesRead), c);
          size += bytesRead;
        }
      } finally {
        fs.closeSync(fd);
      }
      crc = (c ^ 0xFFFFFFFF) >>> 0;
    }
    const nameBuf = Buffer.from(f.rel.replace(/\\/g, '/'), 'utf8');
    const { dosDate, dosTime } = dosDateTime(f.mtime || new Date());
    const localHeaderOffset = offset;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(dosTime, 10);
    lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(size, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    writeBuf(lh);
    writeBuf(nameBuf);
    if (dataBuf) {
      writeBuf(dataBuf);
    } else {
      const fd = fs.openSync(f.full, 'r');
      const chunk = Buffer.allocUnsafe(262144);
      let written = 0;
      try {
        let bytesRead = 0;
        while (written < size && (bytesRead = fs.readSync(fd, chunk, 0, Math.min(chunk.length, size - written), null)) > 0) {
          writeBuf(chunk.subarray(0, bytesRead));
          written += bytesRead;
        }
      } finally {
        fs.closeSync(fd);
      }
      if (written < size) writeBuf(Buffer.alloc(size - written));
    }
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(dosTime, 12);
    cd.writeUInt16LE(dosDate, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(size, 20);
    cd.writeUInt32LE(size, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(localHeaderOffset >>> 0, 42);
    centralEntries.push(cd, nameBuf);
  }
  const cdStart = offset;
  for (const b of centralEntries) writeBuf(b);
  const cdSize = offset - cdStart;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize >>> 0, 12);
  eocd.writeUInt32LE(cdStart >>> 0, 16);
  eocd.writeUInt16LE(0, 20);
  writeBuf(eocd);
  res.end();
}

async function translateText(text, target) {
  const key = `${target}:${text}`;
  if (translationCache.has(key)) return translationCache.get(key);
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return '';
    const data = await res.json();
    const out = Array.isArray(data?.[0]) ? data[0].map((part) => part?.[0] || '').join('').trim() : '';
    if (out) {
      if (translationCache.size > 2000) translationCache.clear();
      translationCache.set(key, out);
    }
    return out;
  } catch { return ''; }
}

function formatTimeRange(startedAt, endedAt) {
  const fmtDate = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
  };
  const fmtTime = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' });
  };
  if (!startedAt) return '';
  const dateStr = fmtDate(startedAt);
  const startStr = fmtTime(startedAt);
  const endStr = endedAt ? fmtTime(endedAt) : '';
  const durMin = endedAt && startedAt ? Math.max(1, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 60000)) : null;
  return `${dateStr} ${startStr}${endStr ? ` – ${endStr}` : ''}${durMin ? `（約 ${durMin} 分鐘）` : ''}`;
}

function cleanTranscriptForPrompt(dir, records) {
  const mdPath = path.join(dir, 'transcript.md');
  if (fs.existsSync(mdPath)) {
    const raw = fs.readFileSync(mdPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    const cjkCount = lines.filter((l) => /[\u3400-\u9FFF]/.test(l)).length;
    if (cjkCount > 20) {
      return lines
        .filter((l) => !l.startsWith('**[') || /[\u3400-\u9FFF]/.test(l))
        .join('\n')
        .slice(0, 28000);
    }
    return raw.slice(0, 28000);
  }
  return records.map((r) => `[${r.speaker || '未知'}] ${r.text}`).join('\n').slice(0, 28000);
}

function buildFallbackSummary(status, records) {
  const timeRange = formatTimeRange(status?.startedAt, status?.endedAt);
  const location = status?.url || (status?.source === 'teams' ? 'Microsoft Teams 線上會議' : status?.source === 'microphone' ? '現場會議（本機收音）' : 'Google Meet 線上會議');
  const recorder = status?.displayName || 'Arthur Wang';
  const speakers = [...new Set(records.map((r) => r.speaker).filter((s) => s && !s.startsWith('8:')))];
  const sampleTexts = records
    .filter((r) => /[\u3400-\u9FFF]/.test(r.text) || r.source !== 'teams-native')
    .slice(0, 10)
    .map((r) => `- **${r.speaker || '發言者'}**：${r.text}`);

  const lines = [
    '## 1. 基本資訊（會議身分證）',
    `- **會議名稱**：${status?.code || status?.id || '會議記錄'}`,
    ...(timeRange ? [`- **會議時間**：${timeRange}`] : []),
    `- **會議地點**：${location}`,
    `- **記錄人**：${recorder}`,
    ...(speakers.length ? [`- **出席人員**：${speakers.join('、')}`] : []),
    ...(sampleTexts.length ? ['', '## 2. 會議內容（討論精髓）', '- **討論要點摘錄**：', ...sampleTexts] : []),
  ];
  return lines.join('\n') + '\n';
}

export function buildAiPromptPackage(status,transcriptText,highlightText='') {
  const timeRange = formatTimeRange(status?.startedAt, status?.endedAt);
  const location = status?.url || (status?.source === 'teams' ? 'Microsoft Teams 線上會議' : status?.source === 'microphone' ? '現場會議（本機收音）' : 'Google Meet 線上會議');
  const recorder = status?.displayName || 'Arthur Wang';

  const systemPrompt = `你是一位專業的企業會議記錄秘書。請根據提供的「會議狀態資訊」與「會議逐字稿」，用**繁體中文（台灣用語）**整理出一份結構清晰、專業精煉的 Markdown 會議記錄。

【核心原則（極重要）】
1. **如果沒有該項資訊，絕對不要硬寫、不要編造，直接省略該小項或該區塊**（例如：逐字稿中若無「請假/缺席人員」、「臨時動議」、「下次會議預告」，請直接不要列出該項目，不要寫「無」或「未提及」充數）。
2. 逐字稿為語音辨識（ASR）與字幕產生，可能包含同音異字（如：紅絲/紅石/宏斯科技、來意/萊伊/來毅、新購三/Single Sign-On/SSO、發的/FIDO2、歐森全/AuthTron 等），請根據前後文自動修正為正確的專有名詞或於括號內標註。
3. 請直接輸出純 Markdown 內容（以 \`## 1. 基本資訊（會議身分證）\` 開頭），不要加任何開場白或結語，不要用 \`\`\`markdown 包裹，也**絕對不要使用 LaTeX 語法**（例如請直接寫 \`→\` 或 \`->\`，不要寫 \`$\\rightarrow$\`）。
4. 「3. 行動方案」中的「負責人（Owner）」欄位必須指派到具體「個人」（如：Benjamin、艾薇、Steven、技術長），避免只寫模糊的「某公司團隊」或「某部門」。

【會議記錄結構規範（僅列出實際有內容的項目）】

## 1. 基本資訊（會議身分證）
- **會議名稱**：清楚載明本次會議的主題（依討論內容歸納）。
- **會議時間**：${timeRange || '（依紀錄載明）'}
- **會議地點**：${location}
- **主席/召集人**：主持或開場召集會議的人（若無法從對話判斷則省略）。
- **記錄人**：${recorder}
- **出席人員**：實際參與討論的人員名單與角色（從對話中提及的稱呼與單位整理）。
- **請假/缺席人員**：應到而未到或中途離席說明的人員（若無則省略此項）。

## 2. 會議內容（討論精髓）
- **會議目的**：簡述本次會議要解決什麼問題或達成什麼目標。
- **報告事項**：過去進度追蹤、公司/產品背景介紹或例行報告（若無則省略）。
- **討論議題與結論**：採取「**案由** -> **討論要點** -> **最終決議**」的結構撰寫（可分多個議題），略過無意義的重複與寒暄，只留關鍵論點與定案。

## 3. 行動方案（後續執行指標）
（若有明確後續待辦事項，請以 Markdown 表格呈現：包含「待辦事項（Action Items）」、「負責人（Owner，指派到個人）」、「完成時限（Due Date）」；若無則省略）

## 4. 結尾與附錄
（僅在會議中有提及時才列出對應子項，沒有的子項直接省略；若三項皆無則整個第 4 節省略）
- **臨時動議**：會議中臨時提出討論的其他事項。
- **下次會議預告**：下次會議的時間、地點與預計討論主題。
- **相關附件**：會議中展示或提及的簡報、系統畫面、參考資料。`;

  const userPrompt = `【會議基本資料】
- 會議 ID：${status?.id || ''}
- 會議時間：${timeRange}
- 會議地點/連結：${location}
- 記錄人：${recorder}

【會議逐字稿內容】
${transcriptText}${highlightText?'\n\n【使用者標記重點：請優先核對上下文，不等同正式決議】\n'+highlightText:''}`;

  const combined = `${systemPrompt}\n\n---\n\n${userPrompt}\n`;
  return { systemPrompt, userPrompt, combined };
}

export function getMeetingSummaryState(dir, status, records = []) {
  const summaryPath = path.join(dir, 'summary.md');
  const job = readStatus(dir)?.summaryJob || null;
  if(job?.state==='failed')return {state:'failed',progress:0,stage:job.error || 'Agent 整理未完成',markdown:null,updatedAt:job.updatedAt};
  if(job && (job.state === 'waiting_agent' || (job.state === 'generating' && job.provider !== 'agent')))return {state:'waiting_agent',progress:0,stage:'等待 AI Agent 接手整理（不使用 Ollama）',markdown:null,updatedAt:job.requestedAt || job.updatedAt};
  if (job && job.state === 'generating') {
    return {
      state: 'generating',
      progress: job.progress,
      stage: job.stage,
      markdown: null,
      updatedAt: job.updatedAt,
    };
  }
  if (fs.existsSync(summaryPath)) {
    try {
      const markdown = fs.readFileSync(summaryPath, 'utf8').trim();
      if (markdown) {
        const stat = fs.statSync(summaryPath);
        return {
          state: 'ready',
          progress: 100,
          stage: '會議記錄整理完成',
          markdown,
          updatedAt: stat.mtime.toISOString(),
        };
      }
    } catch { /* ignore */ }
  }
  if (job && job.state === 'failed') {
    return {
      state: 'failed',
      progress: 0,
      stage: job.error || '整理失敗',
      markdown: null,
      updatedAt: job.updatedAt,
    };
  }
  return {
    state: 'idle',
    progress: 0,
    stage: status?.state === 'done' && records.length > 0 ? '等待 AI Agent 整理' : '會議結束後交由 AI Agent 整理',
    markdown: null,
    updatedAt: null,
  };
}

export function triggerMeetingSummary(dir, status, records = [], { force = false } = {}) {
  requestAgentSummary(dir,{force});
  return getMeetingSummaryState(dir,readStatus(dir) || status,records);
}

async function body(req, limit = 65536) {
  const parts = []; let length = 0;
  for await (const part of req) {
    length += part.length;
    if (length > limit) throw new Error('請求超過大小限制');
    parts.push(part);
  }
  return Buffer.concat(parts);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function readLiveMeeting(meetingsDir, id = 'latest') {
  const meeting = resolveMeeting(meetingsDir, id);
  if (!meeting) return null;
  const status = readStatus(meeting.dir);
  let records = [];
  try {
    records = fs.readFileSync(path.join(meeting.dir, 'transcript.jsonl'), 'utf8')
      .split(/\r?\n/).flatMap((line) => {
        try { const r = JSON.parse(line); return typeof r.text === 'string' && r.text.trim() ? [r] : []; }
        catch { return []; }
      });
  } catch { /* not created yet */ }
  const live = readJson(path.join(meeting.dir, 'live.json'), {});
  const terminal = ['done', 'failed','archived'].includes(status?.state);
  const pending = !terminal && Array.isArray(live.pending) ? live.pending : [];
  const highlights=readHighlights(meeting.dir);
  const timeCounts=new Map();for(const record of [...records,...pending])timeCounts.set(record.t0,(timeCounts.get(record.t0)||0)+1);
  const decorate=record=>{
    const key=highlightKey(record);
    const markers=highlights.filter(m=>m.anchorKey===key || (m.pending && m.quoteAt===record.t0 && timeCounts.get(record.t0)===1));
    const whole=markers.find(m=>m.kind==='utterance');
    return {...record,highlightKey:whole?.key||key,highlighted:!!whole,highlightCount:markers.length};
  };
  // Recent text changes indicate caption activity, not an audio-based speaker detector.
  const activeSpeakers = status?.state === 'in_call'
    ? [...new Set(pending.filter((r) => Date.now() - Date.parse(r.t1) < 6000).map((r) => r.speaker || '未知發言者'))] : [];
  records.sort((a, b) => Date.parse(a.t0) - Date.parse(b.t0));
  const summary = getMeetingSummaryState(meeting.dir, status, records);
  return { id: meeting.id, status, records:records.map(decorate), pending:pending.map(decorate), highlights, activeSpeakers, summary, workspace:{...workspaceData(meeting.dir,status,records),actions:actionItems(meeting.dir,summary.markdown||'')} };
}

export async function startLiveServer({ meetingsDir, port = 8791, microphone = new MicrophoneService({ meetingsDir }) }) {
  const assets = new URL('./live/', import.meta.url);
  const server = http.createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self'; connect-src 'self'; frame-ancestors 'none'");
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) {
      res.writeHead(403).end(); return;
    }
    const url = new URL(req.url, origin);
    const json = (data, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      if (req.method === 'POST' && url.pathname === '/api/translate') {
        if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') { res.writeHead(403).end(); return; }
        const input = JSON.parse((await body(req)).toString() || '{}');
        const texts = Array.isArray(input?.texts) ? input.texts.slice(0, 12).map((t) => String(t ?? '').trim()).filter(Boolean) : [];
        const target = ['zh-TW','zh-CN','en','ja','de','fr','es','ko','it','pt','vi','th'].includes(input?.target) ? input.target : 'zh-TW';
        const translations = await Promise.all(texts.map((t) => translateText(t, target)));
        json({ translations }); return;
      }
      if(req.method==='GET'&&url.pathname==='/api/storage'){json(storageInfo(meetingsDir));return;}
      if(req.method==='POST'&&url.pathname==='/api/action-items'){
        if(req.headers.origin!==origin||req.headers['content-type']!=='application/json'){res.writeHead(403).end();return;}
        const input=JSON.parse((await body(req)).toString()||'{}');
        if(!input||typeof input.id!=='string'||input.id==='latest'){json({error:'請指定確切會議'},400);return;}
        if(typeof input.completed!=='boolean'||typeof input.key!=='string'||!(/^[a-f0-9]{64}$/).test(input.key)||typeof input.revision!=='string'||!(/^[a-f0-9]{64}$/).test(input.revision)){json({error:'待辦狀態或版本格式不正確'},400);return;}
        const meeting=resolveMeeting(meetingsDir,input.id);
        if(!meeting||meeting.id!==input.id){json({error:'找不到會議'},404);return;}
        const data=readLiveMeeting(meetingsDir,meeting.id);
        if(data.summary.state!=='ready'){json({error:'請等候會議紀錄整理完成'},409);return;}
        try{json({id:meeting.id,actions:setActionItem(meeting.dir,data.summary.markdown,input)});}catch(error){json({error:error.message},409);}return;
      }
      if (req.method === 'POST' && url.pathname === '/api/highlights') {
        if(req.headers.origin!==origin || req.headers['content-type']!=='application/json'){res.writeHead(403).end();return;}
        const input=JSON.parse((await body(req)).toString()||'{}');
        if(!input || typeof input.id!=='string' || input.id==='latest'){json({error:'請指定確切會議'},400);return;}
        const meeting=resolveMeeting(meetingsDir,input.id);
        if(!meeting || meeting.id!==input.id){json({error:'找不到會議'},404);return;}
        const data=readLiveMeeting(meetingsDir,meeting.id);
        const highlights=updateHighlight(meeting.dir,data,input);json({id:meeting.id,highlights});return;
      }
      if (req.method === 'POST' && url.pathname === '/api/summarize') {
        if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') { res.writeHead(403).end(); return; }
        const input = JSON.parse((await body(req)).toString() || '{}');
        const meeting = resolveMeeting(meetingsDir, input?.id || 'latest');
        if (!meeting) { json({ error: '找不到會議' }, 404); return; }
        const data = readLiveMeeting(meetingsDir, meeting.id);
        const summary = triggerMeetingSummary(meeting.dir, data?.status, data?.records || [], { force: !!input?.force });
        json({ id: meeting.id, summary }); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/meetings/action') {
        if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') { res.writeHead(403).end(); return; }
        const input = JSON.parse((await body(req)).toString() || '{}');
        const wantedId = String(input?.id || '').trim();
        const action = String(input?.action || '').trim();
        if (!wantedId || wantedId === 'latest') { json({ error: '請指定要操作的會議 ID' }, 400); return; }
        const meeting = resolveMeeting(meetingsDir, wantedId);
        if (!meeting || meeting.id !== wantedId) { json({ error: '找不到該會議' }, 404); return; }
        const st = readStatus(meeting.dir) || {};
        if (action === 'rename') {
          if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 100) { json({error:'會議名稱須為 1–100 個字元'},400); return; }
          const title=input.title.trim();writeStatus(meeting.dir,{title});json({ok:true,id:meeting.id,title});return;
        }
        if (action === 'stop') {
          if (!['starting','launching','joining','waiting_login','selecting_account','waiting_admission','in_call'].includes(st.state)) { json({ error:'這場記錄已結束或正在收尾' },409); return; }
          if (microphone.current?.id === meeting.id) microphone.stop(microphone.current.token);
          else if (st.pid && isProcessAlive(st.pid)) fs.writeFileSync(path.join(meeting.dir,'STOP'),new Date().toISOString()+'\n');
          else { json({ error:'找不到仍在執行的記錄程序' },409); return; }
          json({ok:true,id:meeting.id,state:'leaving'}); return;
        }
        if (['archive','delete'].includes(action) && (!['done','failed','archived'].includes(st.state) || ['waiting_agent','generating'].includes(st.summaryJob?.state))) {json({error:'請先等候記錄收尾與會議整理完成'},409);return;}
        if (action === 'archive') {
          writeStatus(meeting.dir, { prevState: st.state && st.state !== 'archived' ? st.state : (st.prevState || 'done'), state: 'archived', archivedAt: new Date().toISOString() });
          json({ ok: true, id: meeting.id, state: 'archived' }); return;
        }
        if (action === 'unarchive') {
          const restored = st.prevState && st.prevState !== 'archived' ? st.prevState : 'done';
          writeStatus(meeting.dir, { state: restored, archivedAt: null });
          json({ ok: true, id: meeting.id, state: restored }); return;
        }
        if (action === 'delete') {
          if (microphone.current?.id === meeting.id) {
            microphone.stop(microphone.current.token, 'user_delete');
          } else if (st.pid && isProcessAlive(st.pid)) {
            try { process.kill(st.pid); } catch { /* ignore */ }
          }

          fs.rmSync(meeting.dir, { recursive: true, force: true });
          json({ ok: true, id: meeting.id, deleted: true }); return;
        }
        json({ error: '不支援的操作類型' }, 400); return;
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/microphone/')) {
        if (req.headers.origin !== origin) { res.writeHead(403).end(); return; }
        if (url.pathname === '/api/microphone/start' && req.headers['content-type'] === 'application/json') {
          const options = JSON.parse((await body(req)).toString() || '{}');
          if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('收音設定必須為 JSON 物件');
          // Worker-owned identity and lifetime are internal; HTTP callers may only
          // choose the capture mode and device IDs, never filesystem paths or leases.
          const { mode, input, output } = options;
          const active = listMeetings(meetingsDir).find(m=>!['done','failed','archived'].includes(m.status?.state) && (microphone.current?.id === m.id || (m.status?.pid && isProcessAlive(m.status.pid))));
          if (active) { json({error:'已有進行中的記錄，請先返回該場。',id:active.id},409); return; }
          json(await microphone.start({ mode, input, output })); return;
        }
        if (url.pathname === '/api/microphone/audio' && req.headers['content-type'] === 'application/octet-stream') {
          const audio = await body(req);
          microphone.audio(req.headers['x-session-token'], Number(req.headers['x-audio-sequence']), audio);
          json({ ok:true }); return;
        }
        if (url.pathname === '/api/microphone/stop' && req.headers['content-type'] === 'application/json') {
          const input = JSON.parse((await body(req)).toString());
          json(microphone.stop(input.token)); return;
        }
        if (url.pathname === '/api/microphone/heartbeat' && req.headers['content-type'] === 'application/json') {
          const input = JSON.parse((await body(req)).toString()); json(microphone.heartbeat(input.token)); return;
        }
        res.writeHead(400).end(); return;
      }
      if (req.method !== 'GET') { res.writeHead(405).end(); return; }
      if (url.pathname === '/api/audio-devices') {
        const result = await promisify(execFile)(sttPython({ home:microphone.config?.home || path.dirname(meetingsDir) }), [fileURLToPath(new URL('../stt/windows_audio.py', import.meta.url)), '--list'],
          { windowsHide:true, timeout:10000, encoding:'utf8', env:{ ...process.env, PYTHONIOENCODING:'utf-8' } });
        json(JSON.parse(result.stdout)); return;
      }
      if (url.pathname === '/api/meetings') {
        json(listMeetings(meetingsDir).map(({ id,dir,status }) => ({id,state:status?.state,source:status?.source,platform:meetingPlatform(status),code:status?.code,title:meetingTitle(dir,status),canArchive:['done','failed','archived'].includes(status?.state)&&!['waiting_agent','generating'].includes(status?.summaryJob?.state),startedAt:status?.startedAt || null,endedAt:status?.endedAt || null}))); return;
      }
      if (url.pathname === '/api/audio') {
        const meeting=resolveMeeting(meetingsDir,url.searchParams.get('id'));
        if(!meeting || meeting.id !== url.searchParams.get('id')){json({error:'找不到會議'},404);return;}
        const file=safeAudioFile(meeting.dir,url.searchParams.get('file') || 'audio.wav');
        if(!file){json({error:'找不到錄音'},404);return;}
        streamAudio(req,res,file);return;
      }
      if (url.pathname === '/api/transcript') {
        const data = readLiveMeeting(meetingsDir, url.searchParams.get('id') || 'latest');
        json(data || { error: '找不到會議' }, data ? 200 : 404); return;
      }
      if (url.pathname === '/api/export') {
        const meeting = resolveMeeting(meetingsDir, url.searchParams.get('id') || 'latest');
        if (!meeting) { json({ error: '找不到會議' }, 404); return; }
        streamMeetingZip(res, meeting.id, meeting.dir); return;
      }
      if (url.pathname === '/api/export-prompt') {
        const meeting = resolveMeeting(meetingsDir, url.searchParams.get('id') || 'latest');
        if (!meeting) { json({ error: '找不到會議' }, 404); return; }
        const data = readLiveMeeting(meetingsDir, meeting.id);
        const transcriptText = cleanTranscriptForPrompt(meeting.dir, data?.records || []);
        const { combined } = buildAiPromptPackage(data?.status || { id: meeting.id },transcriptText,renderHighlightsMarkdown(data?.highlights || []));
        if (url.searchParams.get('download') === '1') {
          res.writeHead(200, {
            'Content-Type': 'text/markdown; charset=utf-8',
            'Content-Disposition': `attachment; filename="${encodeURIComponent(meeting.id)}-ai-prompt.md"`,
          });
          res.end(combined);
          return;
        }
        json({ id: meeting.id, filename: `${meeting.id}-ai-prompt.md`, content: combined }); return;
      }
      const routes = { '/locales.js':['locales.js','text/javascript'], '/i18n.js':['i18n.js','text/javascript'], '/theme.js':['theme.js','text/javascript'], '/emerald.css':['emerald.css','text/css'], '/assets/duck.svg':['assets/duck.svg','image/svg+xml'], '/assets/chevron.svg':['assets/chevron.svg','image/svg+xml'], '/fonts/roboto-variable.ttf':['fonts/roboto-variable.ttf','font/ttf'], '/fonts/inter-variable.ttf':['fonts/inter-variable.ttf','font/ttf'], '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/microphone.js': ['microphone.js', 'text/javascript'], '/workspace.js':['workspace.js','text/javascript'], '/pcm-worklet.js': ['pcm-worklet.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      const asset = routes[url.pathname];
      if (!asset) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` });
      res.end(fs.readFileSync(new URL(asset[0], assets)));
    } catch (error) { json({ error: req.method === 'POST' || url.pathname === '/api/audio-devices' ? error.message : '暫時無法讀取會議資料，稍後將重試' }, req.method === 'POST' ? 400 : 500); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return {
    server, url:`http://127.0.0.1:${server.address().port}`,
    async shutdown() {
      const session = microphone.current;
      if (session) { microphone.stop(session.token, 'server_stop'); await session.finished; }
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
