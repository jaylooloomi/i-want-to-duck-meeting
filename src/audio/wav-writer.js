/**
 * Streaming PCM16 WAV writer (default 16 kHz mono).
 *
 * The 44-byte RIFF/WAVE header is written immediately and its RIFF/data sizes are
 * re-patched every `headerPatchMs` (default 30 s) while recording, so a crash leaves
 * a playable file containing everything up to the last patch (readers ignore the
 * unpatched tail). `close()` writes the final sizes.
 */
import fs from 'node:fs';

const HEADER_BYTES = 44;
const MAX_U32 = 0xffffffff;

/**
 * Build a canonical 44-byte PCM WAV header.
 * @param {{ sampleRate?: number, channels?: number, dataBytes?: number }} [opts]
 * @returns {Buffer}
 */
export function createWavHeader({ sampleRate = 16000, channels = 1, dataBytes = 0 } = {}) {
  const blockAlign = channels * 2;
  const h = Buffer.alloc(HEADER_BYTES);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(Math.min(36 + dataBytes, MAX_U32), 4);
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16); // fmt chunk size
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * blockAlign, 28); // byte rate
  h.writeUInt16LE(blockAlign, 32);
  h.writeUInt16LE(16, 34); // bits per sample
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(Math.min(dataBytes, MAX_U32), 40);
  return h;
}

export class WavWriter {
  /**
   * Opens (truncates) `path` and writes an empty header. Throws if the file cannot be opened.
   * @param {string} path
   * @param {{ sampleRate?: number, channels?: number, headerPatchMs?: number }} [opts]
   *   headerPatchMs: how often sizes are patched while open (default 30 000; tests inject smaller).
   */
  constructor(path, { sampleRate = 16000, channels = 1, headerPatchMs = 30_000 } = {}) {
    this.path = path;
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.headerPatchMs = headerPatchMs;
    /** @private */ this._fd = fs.openSync(path, 'w');
    /** @private */ this._dataBytes = 0;
    /** @private */ this._patchedBytes = 0;
    /** @private */ this._peak = 0;
    /** @private */ this._carry = null; // dangling odd byte from the previous write
    /** @private */ this._closed = false;
    fs.writeSync(this._fd, createWavHeader({ sampleRate, channels, dataBytes: 0 }), 0, HEADER_BYTES, 0);
    /** @private */ this._timer = setInterval(() => this._patchHeader(), headerPatchMs);
    this._timer.unref();
  }

  /**
   * Append Int16LE samples. Odd byte lengths are handled by carrying the extra byte
   * into the next call. Writes after close() are ignored.
   * @param {Buffer|Uint8Array} int16leBuffer
   */
  write(int16leBuffer) {
    if (this._closed || !int16leBuffer || int16leBuffer.length === 0) return;
    let buf = Buffer.isBuffer(int16leBuffer)
      ? int16leBuffer
      : Buffer.from(int16leBuffer.buffer, int16leBuffer.byteOffset, int16leBuffer.byteLength);
    if (this._carry) {
      buf = Buffer.concat([this._carry, buf]);
      this._carry = null;
    }
    if (buf.length % 2 === 1) {
      this._carry = Buffer.from(buf.subarray(buf.length - 1));
      buf = buf.subarray(0, buf.length - 1);
    }
    if (buf.length === 0) return;

    let peak = this._peak;
    for (let i = 0; i < buf.length; i += 2) {
      const s = buf.readInt16LE(i);
      const a = s < 0 ? -s : s;
      if (a > peak) peak = a;
    }
    this._peak = peak > 32767 ? 32767 : peak;

    fs.writeSync(this._fd, buf, 0, buf.length, HEADER_BYTES + this._dataBytes);
    this._dataBytes += buf.length;
  }

  /** Seconds of audio written so far (complete sample frames only). */
  get seconds() {
    return this._dataBytes / (this.sampleRate * this.channels * 2);
  }

  /** Max |sample| seen so far, 0..32767. */
  get peak() {
    return this._peak;
  }

  /** Patch RIFF/data sizes, close the file. Idempotent. A dangling odd byte is dropped. */
  async close() {
    if (this._closed) return;
    this._closed = true;
    clearInterval(this._timer);
    this._carry = null;
    try {
      this._patchHeader(true);
    } finally {
      fs.closeSync(this._fd);
    }
  }

  /** @private */
  _patchHeader(force = false) {
    if (this._fd == null) return;
    if (!force && (this._closed || this._dataBytes === this._patchedBytes)) return;
    const h = createWavHeader({ sampleRate: this.sampleRate, channels: this.channels, dataBytes: this._dataBytes });
    fs.writeSync(this._fd, h, 4, 4, 4); // RIFF size
    fs.writeSync(this._fd, h, 40, 4, 40); // data size
    this._patchedBytes = this._dataBytes;
  }
}
