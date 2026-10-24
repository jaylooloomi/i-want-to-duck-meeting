import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { listMeetings, resolveMeeting, readStatus } from './status.js';
import { MicrophoneService } from './microphone.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { sttPython } from './stt.js';

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
  return { id: meeting.id, status, records, pending, activeSpeakers };
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
      if (req.method === 'POST' && url.pathname.startsWith('/api/microphone/')) {
        if (req.headers.origin !== origin) { res.writeHead(403).end(); return; }
        if (url.pathname === '/api/microphone/start' && req.headers['content-type'] === 'application/json') {
          const options = JSON.parse((await body(req)).toString() || '{}');
          json(await microphone.start(options)); return;
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
