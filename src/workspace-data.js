import fs from 'node:fs';
import path from 'node:path';

export const AUDIO_FILES = ['audio.wav', 'audio-microphone.wav', 'audio-system.wav'];
const waveCache = new Map();
const normalize = text => String(text || '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\p{Z}\s]/gu, '');

export function safeAudioFile(dir, name) {
  if (!AUDIO_FILES.includes(name)) return null;
  try {
    const file = fs.realpathSync(path.join(dir, name));
    if (path.dirname(file) !== fs.realpathSync(dir) || !fs.statSync(file).isFile()) return null;
    return file;
  } catch { return null; }
}

export function audioInfo(dir, name) {
  const file = safeAudioFile(dir, name);
  if (!file) return null;
  const stat = fs.statSync(file), key = `${file}:${stat.size}:${stat.mtimeMs}`;
  if (waveCache.has(key)) return waveCache.get(key);
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const header = Buffer.alloc(44);
    if (fs.readSync(fd, header, 0, 44, 0) !== 44 || header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE' || header.readUInt16LE(20) !== 1 || header.readUInt16LE(34) !== 16 || header.toString('ascii', 36, 40) !== 'data') return null;
    const rate = header.readUInt32LE(28), bytes = Math.min(header.readUInt32LE(40), stat.size - 44);
    if (!rate || bytes < 2) return null;
    const waveform = [], count = 64;
    for (let i = 0; i < count; i++) {
      const start = 44 + Math.floor((bytes / 2 - 1) * i / count) * 2;
      const chunk = Buffer.alloc(Math.min(2048, 44 + bytes - start));
      const read = fs.readSync(fd, chunk, 0, chunk.length, start);
      let peak = 0;
      for (let j = 0; j + 1 < read; j += 2) peak = Math.max(peak, Math.abs(chunk.readInt16LE(j)));
      waveform.push(peak / 32768);
    }
    const result = { name, seconds: bytes / rate, bytes: stat.size, waveform };
    if (waveCache.size > 128) waveCache.clear();
    waveCache.set(key, result);
    return result;
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

export function meetingTitle(dir, status) {
  if (typeof status?.title === 'string' && status.title.trim()) return status.title.trim();
  try {
    const first = fs.readFileSync(path.join(dir, 'summary.md'), 'utf8').match(/^#\s+([^\n]+)$/m)?.[1]?.trim();
    if (first) return first;
  } catch { /* no summary yet */ }
  return `${status?.source === 'microphone' ? '現場錄音' : status?.source === 'teams' ? '電腦會議收音' : 'Google Meet'} · ${status?.code || status?.id || path.basename(dir)}`;
}

/** Advisory alignment: CC timestamps are reception time, not exact phoneme timing. */
export function compareSources(status, records, transcription) {
  const segments = Array.isArray(transcription?.segments) ? transcription.segments.filter(s => typeof s.text === 'string' && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end >= s.start) : [];
  const native = records.filter(r => !['whisper', 'paraformer', 'local-audio', 'teams-mic', 'teams-system'].includes(r.source));
  const base = Date.parse(status?.joinedAt || status?.startedAt);
  if (!segments.length || !native.length) return { state: 'unavailable', reason: !segments.length ? '尚無錄音轉錄，無法與字幕交叉核對。' : '尚無獨立平台字幕可供比對。', pairs: [], unmatched: segments.length };
  if (!Number.isFinite(base)) return { state: 'unavailable', reason: '缺少錄音起始時間，不能可靠對齊。', pairs: [], unmatched: segments.length };
  const used = new Set(), pairs = [];
  for (const caption of native) {
    const start = (Date.parse(caption.t0) - base) / 1000, end = (Date.parse(caption.t1 || caption.t0) - base) / 1000;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const indices = segments.flatMap((s, i) => s.end >= start - 2 && s.start <= end + 2 ? [i] : []);
    if (!indices.length) continue;
    indices.forEach(i => used.add(i));
    const audioText = indices.map(i => segments[i].text).join(' ').trim();
    const digits = value => (String(value).normalize('NFKC').match(/\d+(?:[.,]\d+)*/g) || []).join('|');
    if (normalize(caption.text) === normalize(audioText) && digits(caption.text) === digits(audioText)) continue;
    pairs.push({ caption: caption.text, recording: audioText, start: Math.max(0, segments[indices[0]].start), speaker: caption.speaker || '未知發言者', important: digits(caption.text) !== digits(audioText), kind: digits(caption.text) !== digits(audioText) ? '數字差異' : '文字／分段差異' });
  }
  const aligned = used.size;
  return { state: aligned ? 'compared' : 'unaligned', reason: '依會議入會時間估計對齊；字幕可能延遲、兩來源可能分段不同，差異須人工確認，不代表任一來源必然正確。', pairs, unmatched: segments.length - aligned, aligned };
}

export function workspaceData(dir, status, records) {
  const audio = AUDIO_FILES.map(name => audioInfo(dir, name)).filter(Boolean);
  let transcription;
  try { transcription = JSON.parse(fs.readFileSync(path.join(dir, 'transcript-whisper.json'), 'utf8')); } catch { /* no local transcription */ }
  return { title: meetingTitle(dir, status), audio, comparison: compareSources(status, records, transcription), speakerCount: new Set(records.map(r => r.speaker).filter(s => s && s !== '未知發言者' && s !== '講者未確認')).size };
}

export function streamAudio(req, res, file) {
  const size = fs.statSync(file).size;
  let start = 0, end = size - 1, code = 200;
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
    if (!match[1]) start = Math.max(0, size - Number(match[2]));
    else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
    code = 206;
  }
  res.writeHead(code, { 'Content-Type': 'audio/wav', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ...(code === 206 ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
  const stream = fs.createReadStream(file, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}
