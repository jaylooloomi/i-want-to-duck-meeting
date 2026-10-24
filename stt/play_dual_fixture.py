"""Local validation helper: play two WAVs to two explicitly selected render devices.

Does not change Windows/Teams default audio devices. No network access.
"""
import argparse
import sys
import threading
import wave
import av
import numpy as np
import pyaudiowpatch as pa


def pcm(filename, rate, channels):
    with wave.open(filename) as audio:
        frame = av.AudioFrame.from_ndarray(np.frombuffer(audio.readframes(audio.getnframes()), dtype='<i2').reshape(1, -1), format='s16', layout='mono')
        frame.sample_rate = audio.getframerate()
    resampler = av.AudioResampler(format='s16', layout='mono' if channels == 1 else 'stereo', rate=rate)
    frames = resampler.resample(frame) + resampler.resample(None)
    return b''.join(frame.to_ndarray().tobytes() for frame in frames)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mic-audio', required=True)
    parser.add_argument('--mic-output', required=True, type=int)
    parser.add_argument('--system-audio', required=True)
    parser.add_argument('--system-output', required=True, type=int)
    args = parser.parse_args()
    gate = threading.Event()
    errors = []
    with pa.PyAudio() as audio:
        def play(filename, device_id):
            try:
                device = audio.get_device_info_by_index(device_id)
                channels = min(2, device['maxOutputChannels'])
                rate = int(device['defaultSampleRate'])
                data = pcm(filename, rate, channels)
                with audio.open(format=pa.paInt16, channels=channels, rate=rate, output=True,
                                output_device_index=device_id, frames_per_buffer=1024) as stream:
                    gate.wait()
                    for offset in range(0, len(data), 1024 * channels * 2):
                        stream.write(data[offset:offset + 1024 * channels * 2])
            except Exception as error:
                errors.append(str(error))
        threads = [threading.Thread(target=play, args=(args.mic_audio, args.mic_output)),
                   threading.Thread(target=play, args=(args.system_audio, args.system_output))]
        for thread in threads:
            thread.start()
        gate.set()
        for thread in threads:
            thread.join()
    if errors:
        raise RuntimeError('; '.join(errors))


if __name__ == '__main__':
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    main()
