import fs from 'node:fs';
import path from 'node:path';
import { WavWriter, createWavHeader } from './wav-writer.js';

/** Aligned two-lane recording. Appending lanes must not double the duration. */
export class MultiTrackWriter {
  constructor(dir) {
    this.fd = fs.openSync(path.join(dir, 'audio.wav'), 'w+');
    fs.writeSync(this.fd, createWavHeader());
    this.tracks = { mic:new WavWriter(path.join(dir, 'audio-microphone.wav')), system:new WavWriter(path.join(dir, 'audio-system.wav')) };
    this.frames = 0; this.peak = 0; this.closed = false;
    this.levels = { mic:0, system:0 };
  }
  write(lane, pcm, offset) {
    if (this.closed || !this.tracks[lane]) throw new Error('錄音軌道已關閉');
    this.tracks[lane].write(pcm);
    let peak = 0;
    const mixed = Buffer.alloc(pcm.length);
    const position = 44 + offset * 2;
    const existing = Math.max(0, Math.min(pcm.length, this.frames * 2 - offset * 2));
    if (existing) fs.readSync(this.fd, mixed, 0, existing, position);
    for (let i = 0; i < pcm.length; i += 2) {
      const value = pcm.readInt16LE(i);
      peak = Math.max(peak, Math.abs(value));
      const combined = Math.max(-32768, Math.min(32767, mixed.readInt16LE(i) + Math.round(value * 0.5)));
      mixed.writeInt16LE(combined, i); this.peak = Math.max(this.peak, Math.abs(combined));
    }
    this.levels[lane] = peak;
    fs.writeSync(this.fd, mixed, 0, mixed.length, position);
    this.frames = Math.max(this.frames, offset + pcm.length / 2);
    fs.writeSync(this.fd, createWavHeader({ dataBytes:this.frames * 2 }), 0, 44, 0);
  }
  get seconds() { return this.frames / 16000; }
  close() {
    if (this.closed) return;
    this.closed = true;
    Object.values(this.tracks).forEach((track) => track.close());
    fs.closeSync(this.fd);
  }
}
