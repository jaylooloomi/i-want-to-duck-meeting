// "Remote participant" audio: a speech-like tone played through an <audio> element whose
// srcObject is a WebAudio MediaStream, the way Meet renders remote WebRTC audio.

/**
 * Start the remote audio. 300 Hz tone, amplitude modulated at ~4 Hz between 0 and 0.5.
 * @param {(state: string) => void} onState AudioContext state changes ('running', ...)
 * @returns {{ audio: HTMLAudioElement, stop: () => void }}
 */
export function startRemoteAudio(onState) {
  const ctx = new AudioContext();
  const tone = ctx.createOscillator();
  tone.frequency.value = 300;
  const envelope = ctx.createGain();
  envelope.gain.value = 0.25; // base level; the LFO below adds ±0.25 → 0 … 0.5
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 4;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 0.25;
  lfo.connect(lfoDepth).connect(envelope.gain);

  const destination = ctx.createMediaStreamDestination();
  tone.connect(envelope).connect(destination);
  tone.start();
  lfo.start();

  const audio = document.createElement('audio');
  audio.autoplay = true;
  audio.dataset.mockRemoteAudio = '';
  audio.srcObject = destination.stream;
  document.body.append(audio);

  ctx.onstatechange = () => onState(ctx.state);
  onState(ctx.state);
  ctx.resume().catch(() => {});
  audio.play().catch(() => {});

  return {
    audio,
    stop() {
      try {
        tone.stop();
        lfo.stop();
      } catch {
        // already stopped
      }
      destination.stream.getTracks().forEach((t) => t.stop());
      audio.srcObject = null;
      audio.remove();
      ctx.close().catch(() => {});
    },
  };
}
