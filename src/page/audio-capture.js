/**
 * Browser-side audio capture for the meeting page (spec 5.13).
 *
 * The exports are passed to Playwright (`page.evaluate` / `context.addInitScript`), which
 * serializes them with `Function.prototype.toString`. They MUST stay fully self-contained:
 * no imports, no references to module scope, all inputs as parameters.
 */

/**
 * Install before navigation: mirror WebAudio connections to each context's speaker destination
 * into a MediaStreamDestination. Meet may decode audio in its own worklet, leaving native
 * receiver tracks silent. The page's graph, speaker gain and connection return values stay
 * intact; capture contexts are excluded to prevent recording feedback. Disconnects are mirrored.
 * Self-contained and idempotent; shared streams live in window.__omAudioOutputCapture.outputs.
 */
export function installAudioOutputCapture() {
  if (window.__omAudioOutputCapture || typeof AudioNode === 'undefined') return;
  const state = { outputs: new Map(), ignoredContexts: new WeakSet() };
  Object.defineProperty(window, '__omAudioOutputCapture', { value: state, configurable: true });
  const connect = AudioNode.prototype.connect;
  const disconnect = AudioNode.prototype.disconnect;
  const attached = new WeakMap();
  AudioNode.prototype.connect = function (...args) {
    const result = Reflect.apply(connect, this, args);
    try {
      const ctx = this.context;
      if (args[0] !== ctx.destination || state.ignoredContexts.has(ctx)) return result;
      let tap = state.outputs.get(ctx);
      if (!tap) {
        tap = ctx.createMediaStreamDestination();
        state.outputs.set(ctx, tap);
      }
      const output = args[1] ?? 0;
      let outputs = attached.get(this);
      if (!outputs) { outputs = new Set(); attached.set(this, outputs); }
      if (!outputs.has(output)) {
        Reflect.apply(connect, this, [tap, output, 0]);
        outputs.add(output);
      }
    } catch { /* observing audio must never break Meet's graph */ }
    return result;
  };
  AudioNode.prototype.disconnect = function (...args) {
    const result = Reflect.apply(disconnect, this, args);
    try {
      const outputs = attached.get(this);
      if (outputs && args[0] === this.context.destination) {
        const tap = state.outputs.get(this.context);
        for (const output of [...outputs]) {
          if (args.length > 1 && args[1] !== output) continue;
          Reflect.apply(disconnect, this, [tap, output, 0]);
          outputs.delete(output);
        }
      } else if (!args.length) attached.delete(this);
      else if (typeof args[0] === 'number') outputs?.delete(args[0]);
    } catch { /* preserve the page's original disconnect result */ }
    return result;
  };
}

/**
 * Install (once per page) a silent capture of every live remote audio track rendered by
 * `<audio>` / `<video>` elements with a MediaStream `srcObject`, or the page playback outputs.
 * Playback outputs take precedence over native tracks to avoid duplicate recording.
 *
 * Graph: one `AudioContext({ sampleRate })`; each track -> `createMediaStreamSource` ->
 * shared mono mixer GainNode -> AudioWorkletNode (processor loaded from a Blob URL; falls back
 * to `ScriptProcessorNode(4096, 1, 1)` when `addModule` fails, e.g. under CSP / Trusted Types)
 * -> zero-gain sink -> destination (the sink only exists so the processor is pulled; nothing is
 * ever audible). Float32 blocks are downmixed to mono, converted to Int16LE and buffered.
 *
 * - every `scanMs` (3 s): pick up new live audio tracks (deduped by track id), drop ended ones;
 * - every `flushMs`: `window.__omAudio(base64Int16LE)` if any samples are buffered (samples are
 *   only buffered while at least one track is connected; kept, up to 60 s, until the binding
 *   exists);
 * - every `statusMs` (5 s, and once at start): `window.__omAudioStatus({ tracks, contextState,
 *   mode, sampleRate, contextSampleRate, samples, lastError })` (`samples` = total handed to
 *   __omAudio; `lastError` = last swallowed error message or null, for diagnostics).
 *
 * If Chrome refuses `AudioContext({ sampleRate })`, a default-rate context is used and blocks
 * are resampled to `sampleRate` in JS, so the output rate is always `sampleRate`.
 *
 * Idempotent: `window.__omAudioCapture` holds the state; later calls return the first call's
 * result. The state object also offers `flush()` (hand buffered samples to __omAudio now),
 * `status()`, `scan()` and `stop()` (flush, tear down, delete `window.__omAudioCapture`).
 *
 * @param {{ sampleRate?: number, flushMs?: number, scanMs?: number, statusMs?: number }} [opts]
 * @returns {Promise<{ mode: 'worklet'|'scriptprocessor'|null, sampleRate: number,
 *   contextSampleRate?: number, contextState: string, tracks: number, error?: string }>}
 *   Never rejects; on failure `mode` is null and `error` is set (a later call may retry).
 */
export function installAudioCapture(opts) {
  const o = opts || {};
  const existing = window.__omAudioCapture;
  if (existing && existing.ready) return existing.ready;

  const targetRate = o.sampleRate || 16000;
  const flushMs = o.flushMs || 1000;
  const scanMs = o.scanMs || 3000;
  const statusMs = o.statusMs || 5000;
  const maxBufferedSamples = targetRate * 60;

  const st = {
    ctx: null,
    mode: null,
    tracks: new Map(), // track id -> { track, source }
    pending: [], // Int16Array blocks
    pendingSamples: 0,
    samples: 0, // total samples handed to __omAudio
    timers: [],
    stopped: false,
    lastError: null,
    ready: null,
    flush: () => 0,
    status: () => ({
      tracks: 0, contextState: 'none', mode: null, sampleRate: targetRate,
      contextSampleRate: null, samples: 0, lastError: st.lastError,
    }),
    scan: () => 0,
    stop: async () => {},
  };
  Object.defineProperty(window, '__omAudioCapture', {
    value: st, configurable: true, enumerable: false, writable: true,
  });

  const errText = (e) => String((e && e.message) || e);

  /** Linear-interpolation resampler (only used if the context could not run at targetRate). */
  const makeResampler = (fromRate, toRate) => {
    if (fromRate === toRate) return (x) => x;
    const step = fromRate / toRate;
    let t = 0; // position of the next output sample; -1 refers to `prev`
    let prev = 0;
    return (x) => {
      const n = x.length;
      const out = new Float32Array(Math.ceil((n + 1) / step) + 1);
      let k = 0;
      while (t < n - 1) {
        const i = Math.floor(t);
        const frac = t - i;
        const a = i < 0 ? prev : x[i];
        out[k++] = a + (x[i + 1] - a) * frac;
        t += step;
      }
      t -= n;
      if (n) prev = x[n - 1];
      return out.subarray(0, k);
    };
  };

  const toInt16 = (f) => {
    const out = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) {
      let s = f[i];
      if (!(s === s)) s = 0; // NaN
      s = s < -1 ? -1 : s > 1 ? 1 : s;
      out[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
    }
    return out;
  };

  const callSafe = (fn, arg) => {
    try {
      const p = fn(arg);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) {
      st.lastError = errText(e);
    }
  };

  const PROCESSOR = `
class OmCaptureProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.size = 2048; this.buf = new Float32Array(this.size); this.n = 0; }
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const nch = input.length;
      const len = input[0].length;
      for (let i = 0; i < len; i++) {
        let s = 0;
        for (let c = 0; c < nch; c++) s += input[c][i];
        this.buf[this.n++] = s / nch;
        if (this.n === this.size) {
          this.port.postMessage(this.buf, [this.buf.buffer]);
          this.buf = new Float32Array(this.size);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('om-capture-processor', OmCaptureProcessor);
`;

  st.ready = (async () => {
    let ctx;
    try {
      ctx = new AudioContext({ sampleRate: targetRate });
    } catch (e) {
      st.lastError = errText(e);
      ctx = new AudioContext();
    }
    st.ctx = ctx;
    window.__omAudioOutputCapture?.ignoredContexts.add(ctx);
    ctx.resume().catch(() => {});
    const resample = makeResampler(ctx.sampleRate, targetRate);

    const mixer = ctx.createGain();
    mixer.gain.value = 1;
    mixer.channelCount = 1;
    mixer.channelCountMode = 'explicit';
    mixer.channelInterpretation = 'speakers';
    const sink = ctx.createGain();
    sink.gain.value = 0;
    sink.connect(ctx.destination);

    const onBlock = (f32) => {
      if (st.stopped || st.tracks.size === 0 || !f32 || !f32.length) return;
      const mono = resample(f32);
      if (!mono.length) return;
      const i16 = toInt16(mono);
      st.pending.push(i16);
      st.pendingSamples += i16.length;
      while (st.pendingSamples > maxBufferedSamples && st.pending.length > 1) {
        st.pendingSamples -= st.pending.shift().length;
      }
    };

    let node = null;
    if (ctx.audioWorklet && typeof AudioWorkletNode === 'function') {
      let url = null;
      try {
        url = URL.createObjectURL(new Blob([PROCESSOR], { type: 'application/javascript' }));
        await ctx.audioWorklet.addModule(url);
        node = new AudioWorkletNode(ctx, 'om-capture-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          channelCount: 1,
          channelCountMode: 'explicit',
          channelInterpretation: 'speakers',
        });
        node.port.onmessage = (e) => onBlock(e.data);
        st.mode = 'worklet';
      } catch (e) {
        st.lastError = errText(e);
        node = null;
      } finally {
        if (url) try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
      }
    }
    if (!node) {
      node = ctx.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = (e) => onBlock(new Float32Array(e.inputBuffer.getChannelData(0)));
      st.mode = 'scriptprocessor';
    }
    mixer.connect(node);
    node.connect(sink);
    st.node = node;

    st.scan = () => {
      if (st.stopped) return st.tracks.size;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      for (const [id, t] of st.tracks) {
        if (t.track.readyState !== 'live') {
          try { t.source.disconnect(); } catch (e) { /* ignore */ }
          st.tracks.delete(id);
        }
      }
      const outputStreams = [];
      const outputCapture = window.__omAudioOutputCapture;
      if (outputCapture) {
        for (const [outputContext, output] of outputCapture.outputs) {
          if (outputContext.state === 'closed') {
            for (const track of output.stream.getTracks()) track.stop();
            outputCapture.outputs.delete(outputContext);
          } else outputStreams.push(output.stream);
        }
      }
      const preferredTracks = new Set(outputStreams.flatMap((s) => s.getAudioTracks().map((t) => t.id)));
      if (outputStreams.length) {
        for (const [id, item] of st.tracks) {
          if (!preferredTracks.has(id)) { item.source.disconnect(); st.tracks.delete(id); }
        }
      }
      let els = [];
      try { els = document.querySelectorAll('audio, video'); } catch (e) { /* ignore */ }
      const streams = outputStreams.length ? outputStreams : Array.from(els, (el) => el.srcObject);
      for (const so of streams) {
        if (!(so instanceof MediaStream)) continue;
        for (const track of so.getAudioTracks()) {
          if (track.readyState !== 'live' || st.tracks.has(track.id)) continue;
          try {
            const source = ctx.createMediaStreamSource(new MediaStream([track]));
            source.connect(mixer);
            st.tracks.set(track.id, { track, source });
          } catch (e) {
            st.lastError = errText(e);
          }
        }
      }
      return st.tracks.size;
    };

    st.flush = () => {
      if (!st.pendingSamples) return 0;
      const fn = window.__omAudio;
      if (typeof fn !== 'function') return 0;
      const n = st.pendingSamples;
      const bytes = new Uint8Array(n * 2);
      const dv = new DataView(bytes.buffer);
      let off = 0;
      for (const block of st.pending) {
        for (let i = 0; i < block.length; i++, off += 2) dv.setInt16(off, block[i], true);
      }
      st.pending = [];
      st.pendingSamples = 0;
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      }
      st.samples += n;
      callSafe(fn, btoa(bin));
      return n;
    };

    st.status = () => ({
      tracks: st.tracks.size,
      contextState: ctx.state,
      mode: st.mode,
      sampleRate: targetRate,
      contextSampleRate: ctx.sampleRate,
      samples: st.samples,
      lastError: st.lastError,
    });

    const report = () => {
      const fn = window.__omAudioStatus;
      if (typeof fn === 'function') callSafe(fn, st.status());
    };

    st.stop = async () => {
      if (st.stopped) return;
      st.stopped = true;
      for (const id of st.timers) clearInterval(id);
      st.timers = [];
      st.flush(); // hand over what is buffered (flush is not gated by `stopped`)
      for (const t of st.tracks.values()) {
        try { t.source.disconnect(); } catch (e) { /* ignore */ }
      }
      st.tracks.clear();
      try { node.disconnect(); } catch (e) { /* ignore */ }
      try { await ctx.close(); } catch (e) { /* ignore */ }
      if (window.__omAudioCapture === st) delete window.__omAudioCapture;
    };

    st.scan();
    report();
    st.timers.push(setInterval(st.scan, scanMs), setInterval(st.flush, flushMs), setInterval(report, statusMs));
    return {
      mode: st.mode, sampleRate: targetRate, contextSampleRate: ctx.sampleRate,
      contextState: ctx.state, tracks: st.tracks.size,
    };
  })().catch((e) => {
    // leave nothing half-installed so a later call can retry
    if (window.__omAudioCapture === st) delete window.__omAudioCapture;
    for (const id of st.timers) clearInterval(id);
    try { if (st.ctx) st.ctx.close(); } catch (e2) { /* ignore */ }
    return { mode: null, sampleRate: targetRate, contextState: 'failed', tracks: 0, error: errText(e) };
  });

  return st.ready;
}

/**
 * For `context.addInitScript(installTrackMirror)`: wraps `window.RTCPeerConnection` in a
 * transparent Proxy (same prototype, statics, name, `instanceof`, subclassing; calling
 * without `new` still throws) that adds one `track` listener per connection. Every remote
 * audio track (once per track id) is mirrored into a hidden
 * `<audio autoplay data-om-mirror="<track id>">` with `srcObject = new MediaStream([track])`,
 * so audio capture can find tracks even when the page renders no media elements (e.g. plays
 * them through WebAudio). Mirrors are silent locally (volume 0) — capture taps the track,
 * not the element output. Never touches the page's own handlers. Idempotent
 * (`window.__omTrackMirror`).
 */
export function installTrackMirror() {
  try {
    if (typeof window === 'undefined' || window.__omTrackMirror) return;
    const Native = window.RTCPeerConnection;
    if (typeof Native !== 'function') return;

    const state = { mirrored: new Set(), elements: new Map(), Native };
    Object.defineProperty(window, '__omTrackMirror', {
      value: state, configurable: true, enumerable: false, writable: true,
    });

    const attach = (track) => {
      const parent = document.documentElement || document.body;
      if (!parent) {
        document.addEventListener('DOMContentLoaded', () => attach(track), { once: true });
        return;
      }
      const el = document.createElement('audio');
      el.autoplay = true;
      el.muted = false;
      el.volume = 0;
      el.style.display = 'none';
      el.setAttribute('data-om-mirror', track.id);
      el.srcObject = new MediaStream([track]);
      parent.appendChild(el);
      state.elements.set(track.id, el);
      try {
        const p = el.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (e) { /* ignore */ }
      track.addEventListener('ended', () => {
        try {
          el.srcObject = null;
          el.remove();
        } catch (e) { /* ignore */ }
        state.elements.delete(track.id);
      });
    };

    const onTrack = (ev) => {
      try {
        const track = ev && ev.track;
        if (!track || track.kind !== 'audio' || state.mirrored.has(track.id)) return;
        state.mirrored.add(track.id);
        attach(track);
      } catch (e) { /* never break the page */ }
    };

    const addListener = EventTarget.prototype.addEventListener;
    const Wrapped = new Proxy(Native, {
      construct(target, args, newTarget) {
        const pc = Reflect.construct(target, args, newTarget);
        try { addListener.call(pc, 'track', onTrack); } catch (e) { /* ignore */ }
        return pc;
      },
    });

    const replace = (obj, key, from, to) => {
      const d = Object.getOwnPropertyDescriptor(obj, key);
      if (!d || d.value !== from) return;
      Object.defineProperty(obj, key, { ...d, value: to });
    };
    replace(window, 'RTCPeerConnection', Native, Wrapped);
    replace(window, 'webkitRTCPeerConnection', Native, Wrapped);
    // so `pc.constructor === RTCPeerConnection` keeps holding
    replace(Native.prototype, 'constructor', Native, Wrapped);
  } catch (e) {
    /* never break the page */
  }
}
