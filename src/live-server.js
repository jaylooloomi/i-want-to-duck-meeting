import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { listMeetings, resolveMeeting, readStatus } from './status.js';
import { MicrophoneService } from './microphone.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { sttPython } from './stt.js';

const translationCache = new Map();
const summaryJobs = new Map();

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

async function generateWithLlm(status, transcriptText) {
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
${transcriptText}`;

  const models = [
    process.env.OPENMEETING_SUMMARY_MODEL,
    'gemma4:31b-cloud',
    'qwen3-chat:latest',
    'qwen3:8b',
  ].filter(Boolean);

  for (const model of models) {
    try {
      const res = await fetch('http://127.0.0.1:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify({
          model,
          stream: false,
          think: false,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      let content = String(data?.message?.content || '').trim();
      content = content
        .replace(/^```(?:markdown|md)?\r?\n/i, '')
        .replace(/\r?\n```$/, '')
        .replace(/\$\\rightarrow\$/g, '→')
        .replace(/\\rightarrow/g, '→')
        .trim();
      if (content && content.length > 60) return content + '\n';
    } catch {
      /* try next model */
    }
  }
  return null;
}

export function getMeetingSummaryState(dir, status, records = []) {
  const summaryPath = path.join(dir, 'summary.md');
  const job = summaryJobs.get(dir);
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
    stage: status?.state === 'done' && records.length > 0 ? '尚待整理會議記錄' : '等待會議結束後自動整理',
    markdown: null,
    updatedAt: null,
  };
}

export function triggerMeetingSummary(dir, status, records = [], { force = false } = {}) {
  const existing = summaryJobs.get(dir);
  if (existing && existing.state === 'generating') return getMeetingSummaryState(dir, status, records);
  const summaryPath = path.join(dir, 'summary.md');
  if (!force && fs.existsSync(summaryPath)) {
    try {
      if (fs.readFileSync(summaryPath, 'utf8').trim()) return getMeetingSummaryState(dir, status, records);
    } catch { /* ignore */ }
  }

  const job = {
    state: 'generating',
    progress: 8,
    stage: '正在讀取會議逐字稿與基本資訊…',
    updatedAt: new Date().toISOString(),
    error: null,
  };
  summaryJobs.set(dir, job);

  const stages = [
    { at: 22, text: '正在過濾語音雜訊與辨識出席人員…' },
    { at: 45, text: '正在分析討論議題（案由 → 討論要點 → 最終決議）…' },
    { at: 68, text: '正在提取行動方案（待辦事項、負責人、完成時限）…' },
    { at: 86, text: '正在排版與校對會議記錄結構…' },
  ];
  let stageIdx = 0;
  const timer = setInterval(() => {
    if (job.state !== 'generating') { clearInterval(timer); return; }
    if (stageIdx < stages.length && job.progress >= stages[stageIdx].at - 6) {
      job.stage = stages[stageIdx].text;
      stageIdx++;
    }
    if (job.progress < 94) {
      job.progress = Math.min(94, job.progress + Math.max(1, Math.round((95 - job.progress) * 0.14)));
      job.updatedAt = new Date().toISOString();
    }
  }, 600);
  timer.unref?.();

  (async () => {
    try {
      const minAnimPromise = new Promise((r) => setTimeout(r, 2600));
      const currentStatus = readStatus(dir) || status || {};
      const transcriptText = cleanTranscriptForPrompt(dir, records);
      let markdown = await generateWithLlm(currentStatus, transcriptText);
      if (!markdown) {
        markdown = buildFallbackSummary(currentStatus, records);
      }
      await minAnimPromise;
      if (!fs.existsSync(dir)) {
        job.state = 'failed';
        job.error = '會議資料夾已不存在';
        return;
      }
      const tmp = `${summaryPath}.tmp`;
      fs.writeFileSync(tmp, markdown, 'utf8');
      fs.renameSync(tmp, summaryPath);
      job.state = 'ready';
      job.progress = 100;
      job.stage = '會議記錄整理完成';
      job.updatedAt = new Date().toISOString();
    } catch (err) {
      job.state = 'failed';
      job.error = err?.message || '整理會議記錄時發生錯誤';
      job.updatedAt = new Date().toISOString();
    } finally {
      clearInterval(timer);
    }
  })();

  return getMeetingSummaryState(dir, status, records);
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
  const terminal = ['done', 'failed'].includes(status?.state);
  const pending = !terminal && Array.isArray(live.pending) ? live.pending : [];
  // Recent text changes indicate caption activity, not an audio-based speaker detector.
  const activeSpeakers = status?.state === 'in_call'
    ? [...new Set(pending.filter((r) => Date.now() - Date.parse(r.t1) < 6000).map((r) => r.speaker || '未知發言者'))] : [];
  records.sort((a, b) => Date.parse(a.t0) - Date.parse(b.t0));
  const summary = getMeetingSummaryState(meeting.dir, status, records);
  return { id: meeting.id, status, records, pending, activeSpeakers, summary };
}

export async function startLiveServer({ meetingsDir, port = 8791, microphone = new MicrophoneService({ meetingsDir }) }) {
  const assets = new URL('./live/', import.meta.url);
  const server = http.createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'");
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
        const target = ['zh-TW', 'en', 'ja'].includes(input?.target) ? input.target : 'zh-TW';
        const translations = await Promise.all(texts.map((t) => translateText(t, target)));
        json({ translations }); return;
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
      if (req.method === 'POST' && url.pathname.startsWith('/api/microphone/')) {
        if (req.headers.origin !== origin) { res.writeHead(403).end(); return; }
        if (url.pathname === '/api/microphone/start' && req.headers['content-type'] === 'application/json') {
          const options = JSON.parse((await body(req)).toString() || '{}');
          if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('收音設定必須為 JSON 物件');
          // Worker-owned identity and lifetime are internal; HTTP callers may only
          // choose the capture mode and device IDs, never filesystem paths or leases.
          const { mode, input, output } = options;
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
        json(listMeetings(meetingsDir).map(({ id, status }) => ({ id, state: status?.state, code: status?.code }))); return;
      }
      if (url.pathname === '/api/transcript') {
        const data = readLiveMeeting(meetingsDir, url.searchParams.get('id') || 'latest');
        json(data || { error: '找不到會議' }, data ? 200 : 404); return;
      }
      const routes = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/microphone.js': ['microphone.js', 'text/javascript'], '/pcm-worklet.js': ['pcm-worklet.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
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
