import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createMeetingDir, newMeetingId, writeStatus } from './status.js';
import { WavWriter } from './audio/wav-writer.js';
import { MultiTrackWriter } from './audio/multi-track-writer.js';
import { TranscriptStore } from './transcript/store.js';
import { sttPython } from './stt.js';
import { audioHealth } from './audio-settings.js';
import { TeamsCaptionRouter } from './teams-captions.js';

export function captureLeaseExpired(session, now = Date.now()) {
  return !session.managed && session.ready && (session.mode !== 'teams' || session.clientReady) && !session.stopping
    && now - (session.mode === 'teams' ? session.lastClient : session.lastAudio) > (session.mode === 'teams' ? 180000 : 15000);
}

/** One local capture owner. Audio can only be submitted using the per-session token. */
export class MicrophoneService {
  constructor({ meetingsDir, home = path.dirname(meetingsDir), repoRoot = fileURLToPath(new URL('..', import.meta.url)) }) {
    this.config = { meetingsDir, home, repoRoot };
    this.current = null;
  }

  async start({ mode = 'microphone', input, output, meetingId, meetingDir, managed = false, nativeCaptions = false } = {}) {
    if (!['microphone', 'teams'].includes(mode)) throw new Error('不支援的收音模式');
    if (mode === 'teams' && (!Number.isInteger(input) || !Number.isInteger(output))) throw new Error('請選擇 Teams 播放裝置與自己的麥克風');
    if (mode === 'teams' && input === output) throw new Error('自己的輸入與會議播放裝置不能是同一路 loopback');
    if (this.current) throw new Error('已有本機收音工作，請先結束');
    const { meetingsDir, home, repoRoot } = this.config;
    const id = meetingId || newMeetingId(mode === 'teams' ? 'teams-audio' : 'local-microphone') + '-' + randomUUID().slice(0, 6);
    const dir = meetingDir || createMeetingDir(meetingsDir, id);
    const startedAt = new Date().toISOString();
    const session = { id, dir, token:randomUUID(), sequence:0, startedAt, audioStart:null, pending:[], stopping:false, ready:false, lastAudio:Date.now(), lastClient:Date.now(), mode, managed, laneFrames:{ mic:0, system:0 }, laneOffsets:{} };
    this.current = session;
    const code = mode === 'teams' ? 'Teams 雙路收音' : '本機麥克風';
    const store = new TranscriptStore(dir, { code, startedAt, sourceLabel:'本機音訊辨識（Paraformer／聲音特徵分群）' });
    const wav = mode === 'teams' ? new MultiTrackWriter(dir) : new WavWriter(path.join(dir, 'audio.wav'));
    session.store = store; session.wav = wav;
    const stats = () => ({ utterances:store.count, speakers:store.speakers, audioSeconds:wav.seconds, audioPeak:wav.peak, captionLang:'zh', captionsOn:!!session.captionRouter?.native.size,
      ...(mode === 'teams' ? { levels:wav.levels, tracks:Object.fromEntries(Object.entries(wav.tracks).map(([name, track]) => [name, { audioSeconds:track.seconds, audioPeak:track.peak }])) } : {}) });
    const status = (patch) => writeStatus(dir, { stats:stats(), ...patch });
    if (mode === 'teams' && nativeCaptions) {
      store.sourceLabel='Teams 原生字幕與 Paraformer 備援';
      session.captionRouter=new TeamsCaptionRouter({dir,store,changed:status});
      session.platformCaption=event=>{if(!session.stopping)session.captionRouter.platform(event);};
    }
    status({ id, code, source:mode, state:'starting', startedAt, pid:process.pid });
    const live = () => {
      const file = path.join(dir, 'live.json');
      fs.writeFileSync(file + '.tmp', JSON.stringify({ pending:session.pending, updatedAt:new Date().toISOString() }));
      fs.renameSync(file + '.tmp', file);
    };
    const child = spawn(sttPython({ home }), [path.join(repoRoot, 'stt/live.py'), '--model-dir', path.join(home, 'models'), '--mode', mode], {
      windowsHide:true, env:{ ...process.env, HF_HUB_OFFLINE:'1', HF_HUB_DISABLE_TELEMETRY:'1', PYTHONIOENCODING:'utf-8' }, stdio:['pipe', 'pipe', 'pipe'],
    });
    session.child = child;
    session.status = status;
    const log = fs.createWriteStream(path.join(dir, 'worker.out'));
    child.stderr.pipe(log, { end:false });
    let failure = null;
    let readyResolve, readyReject;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const timer = setTimeout(() => { failure = '本機模型載入逾時'; readyReject(new Error(failure)); child.kill(); }, 90000);
    child.stdin.on('error', () => {});
    child.on('error', (error) => { failure = error.message; readyReject(error); });
    const lines = createInterface({ input:child.stdout });
    lines.on('line', (line) => {
      log.write(line + '\n');
      try {
        const event = JSON.parse(line);
        const iso = (seconds) => new Date((session.audioStart || Date.parse(startedAt)) + seconds * 1000).toISOString();
        if (event.type === 'ready') {
          clearTimeout(timer); session.ready = true; session.lastAudio = Date.now();
          status({ state:'in_call', joinedAt:new Date().toISOString() }); readyResolve();
        } else if (event.type === 'pending') {
          session.pending = [{ speaker:event.speaker, text:'正在辨識語音…', source:mode === 'teams' ? `teams-${event.lane}` : 'local-audio', t0:iso(event.start), t1:new Date().toISOString() }]; live();
        } else if (event.type === 'record') {
          const record={ speaker:event.speaker, text:event.text, t0:iso(event.start), t1:iso(event.end), source:mode === 'teams' ? `teams-${event.lane}` : 'local-audio' };
          if(session.captionRouter) session.captionRouter.asr(record); else store.append(record);
          status({});
        } else if (event.type === 'clear') { session.pending = []; live(); }
        else if (event.type === 'progress') { status({ queuedSegments:event.queued, processingSeconds:event.processingSeconds }); }
        else if (event.type === 'error') { failure = event.message; readyReject(new Error(failure)); }
      } catch (error) { log.write(`event error: ${error.message}\n`); }
    });
    session.finished = new Promise((resolve) => {
      child.on('close', (code, signal) => {
        clearTimeout(timer); clearInterval(session.watchdog); clearTimeout(session.stopTimer);
        if (!session.ready) readyReject(new Error(failure || '本機辨識程序未能啟動'));
        session.capture?.stdin.end();
        wav.close(); session.pending = []; live();
        const endedAt = new Date().toISOString();
        store.renderMarkdown({ endedAt, captionLang:'zh', extraNote:mode === 'teams'
          ? '來源：Teams 原生字幕（有收到時）與 Windows 雙路 Paraformer 備援；原生字幕時間為接收時間，本機辨識的講者標籤為估計結果。'
          : '來源：本機麥克風、Whisper 與聲音特徵分群；講者標籤為估計結果。' });
        status({ state:code === 0 && !failure ? 'done' : 'failed', endedAt, endReason:session.endReason || 'recognizer_exit', error:failure ? { code:'local_stt_failed', message:failure } : code !== 0 ? { code:'local_stt_failed', message:signal ? `辨識程序被 ${signal} 終止` : `辨識程序結束碼 ${code}` } : null });
        if (this.current === session) this.current = null;
        log.end(resolve);
      });
    });
    session.watchdog = setInterval(() => {
      if (!session.stopping && fs.existsSync(path.join(dir, 'STOP'))) this.stop(session.token, 'user_stop');
      // Background browser tabs may throttle timers to once a minute. Native capture
      // must keep running while the user is speaking in the Teams window.
      if (captureLeaseExpired(session)) this.stop(session.token, 'capture_disconnected');
      if (managed) status({heartbeatAt:new Date().toISOString(), audioHealth:audioHealth(stats())});
    }, 2000);
    await ready;
    // leave can arrive while models are still loading. Never open the devices
    // after that recording has already been stopped or finalized.
    if (session.stopping || this.current !== session) {
      await session.finished;
      return { id, token:session.token };
    }
    if (mode === 'teams') {
      session.audioStart = Date.now();
      session.failCapture = (message) => { failure = message; if (!session.stopping) this.stop(session.token, 'capture_error'); };
      try { await this.startWindowsCapture(session, input, output); }
      catch (error) { session.failCapture(error.message); await session.finished; throw error; }
      session.lastClient = Date.now();
      session.clientReady = true;
    }
    return { id, token:session.token };
  }

  audio(token, sequence, buffer, lane = 'mic', at = null) {
    const s = this.current;
    if (!s || s.token !== token || !s.ready || s.stopping) throw new Error('收音工作已結束或不屬於這個分頁');
    if (!['mic','system'].includes(lane) || (s.mode !== 'teams' && lane !== 'mic')) throw new Error('音訊軌道不正確');
    if (sequence !== s.sequence) throw new Error('音訊順序不一致，請結束後重新開始');
    if (!buffer.length || buffer.length % 2 || buffer.length > 32000) throw new Error('音訊格式不正確');
    if (s.child.stdin.writableLength > 1024 * 1024) throw new Error('辨識程序忙碌，請停止收音');
    s.audioStart ??= Date.now() - buffer.length / 32;
    s.sequence++; s.lastAudio = Date.now();
    if (s.laneOffsets[lane] === undefined) s.laneOffsets[lane] = Math.max(0, Math.round(((at ?? (Date.now() - buffer.length / 32)) - s.audioStart) * 16));
    const offset = s.laneOffsets[lane] + s.laneFrames[lane];
    if (s.mode === 'teams') s.wav.write(lane, buffer, offset); else s.wav.write(buffer);
    s.laneFrames[lane] += buffer.length / 2;
    s.child.stdin.write(JSON.stringify({ pcm:buffer.toString('base64'), lane, offset:s.laneOffsets[lane] }) + '\n');
    s.status({});
  }

  stop(token, reason = 'user_stop') {
    const s = this.current;
    if (!s || s.token !== token) throw new Error('找不到這個收音工作');
    if (s.stopping) return { id:s.id, state:'leaving' };
    s.stopping = true; s.endReason = reason;
    s.status({ state:'leaving' });
    if (s.capture) {
      s.drainingCapture = true; s.capture.stdin.end();
      s.captureStopTimer = setTimeout(() => { s.failCapture('Windows 收音收尾逾時，已保留收到的錄音'); s.capture.kill(); }, 10000);
    }
    else { s.wav.close(); s.child.stdin.end(); }
    s.stopTimer = setTimeout(() => s.child.kill(), 120000);
    return { id:s.id, state:'leaving' };
  }

  heartbeat(token) {
    if (!this.current || this.current.token !== token || this.current.stopping) throw new Error('收音工作已結束');
    this.current.lastClient = Date.now(); return { ok:true };
  }

  async startWindowsCapture(session, input, output) {
    const { home, repoRoot } = this.config;
    const child = spawn(sttPython({ home }), [path.join(repoRoot, 'stt/windows_audio.py'), '--input', String(input), '--output', String(output)], {
      windowsHide:true, env:{ ...process.env, PYTHONIOENCODING:'utf-8' }, stdio:['pipe', 'pipe', 'pipe'],
    });
    session.capture = child;
    child.stdin.on('error', () => {});
    const captureLog = fs.createWriteStream(path.join(session.dir, 'capture.log'));
    child.stderr.pipe(captureLog, { end:false });
    let captureFailure = null;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('Windows 收音裝置啟動逾時')); }, 15000);
      createInterface({ input:child.stdout }).on('line', (line) => {
        try {
          const event = JSON.parse(line);
          if (event.type === 'ready') { session.captureReady = true; session.status({ captureDevices:event.devices }); clearTimeout(timer); resolve(); }
          else if (event.type === 'audio' && (!session.stopping || session.drainingCapture)) {
            // Stop accepting browser audio before native drain, but keep final native packets.
            const wasStopping = session.stopping; session.stopping = false;
            try { this.audio(session.token, session.sequence, Buffer.from(event.pcm, 'base64'), event.lane, event.at * 1000); }
            finally { session.stopping = wasStopping; }
          } else if (event.type === 'error') { captureFailure = event.message; reject(new Error(event.message)); session.failCapture(event.message); }
        } catch (error) { captureFailure = error.message; session.failCapture(error.message); }
      });
      child.on('error', (error) => { clearTimeout(timer); captureFailure = error.message; reject(error); });
      child.on('close', (code) => {
        clearTimeout(timer); clearTimeout(session.captureStopTimer); captureLog.end(); session.drainingCapture = false;
        if (!session.stopping) session.failCapture(captureFailure || `Windows 收音程序意外結束 (${code})`);
        if (code && !captureFailure) session.failCapture(`Windows 收音失敗 (${code})`);
        session.wav.close(); session.child.stdin.end();
        if (!session.captureReady) reject(new Error(captureFailure || 'Windows 收音未能啟動'));
      });
    });
  }
}
