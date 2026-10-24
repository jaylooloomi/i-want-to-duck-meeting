"""Windows WASAPI microphone + playback loopback. PCM stays on local stdio.

No default device/settings changes. Captures only explicitly selected input and
render endpoint; loopback includes all apps playing through that endpoint.
"""
import argparse
import base64
import json
import queue
import sys
import threading
import time
import os
import numpy as np


def emit(**event):
    print(json.dumps(event, ensure_ascii=False), flush=True)


def devices(audio, module):
    api = audio.get_host_api_info_by_type(module.paWASAPI)
    inputs = [audio.get_device_info_by_index(i) for i in range(audio.get_device_count())]
    inputs = [d for d in inputs if d['hostApi'] == api['index'] and d['maxInputChannels'] > 0 and not d.get('isLoopbackDevice')]
    outputs = list(audio.get_loopback_device_info_generator())
    default_output = audio.get_default_wasapi_loopback()['index']
    def item(d):
        return dict(id=int(d['index']), name=d['name'], channels=d['maxInputChannels'], sampleRate=int(d['defaultSampleRate']))
    virtual_inputs = [dict(item(d), name='虛擬音訊輸入：' + d['name'], virtual=True) for d in outputs]
    return dict(inputs=[item(d) for d in inputs] + virtual_inputs, outputs=[item(d) for d in outputs],
                defaultInput=int(api['defaultInputDevice']), defaultOutput=int(default_output))


def capture(audio, module, input_id, output_id):
    import av
    available = devices(audio, module)
    if input_id not in [d['id'] for d in available['inputs']]:
        raise ValueError('所選麥克風不存在，請更新裝置清單')
    if output_id not in [d['id'] for d in available['outputs']]:
        raise ValueError('所選播放裝置不是 WASAPI loopback，請更新裝置清單')
    if input_id == output_id:
        raise ValueError('自己的輸入與會議播放裝置不能是同一路 loopback，否則會重複記錄')
    events = queue.Queue(maxsize=1024)
    stop = threading.Event()
    overflow = threading.Event()
    def watch_control():
        # Raw OS reads avoid a buffered stdin lock during Python's shutdown on startup errors.
        while os.read(sys.stdin.fileno(), 4096):
            pass
        stop.set()
    threading.Thread(target=watch_control, daemon=True).start()
    states = {}
    streams = []
    try:
        for lane, device_id in [('mic', input_id), ('system', output_id)]:
            device = audio.get_device_info_by_index(device_id)
            channels = min(int(device['maxInputChannels']), 2)
            rate = int(device['defaultSampleRate'])
            states[lane] = dict(buffer=np.empty(0, dtype='<i2'), channels=channels, rate=rate,
                                resampler=av.AudioResampler(format='s16', layout='mono', rate=16000), statuses=0)
            def callback(data, count, timing, flags, lane=lane):
                try:
                    events.put_nowait(('audio', lane, data, flags))
                except queue.Full:
                    overflow.set()
                return None, module.paComplete if stop.is_set() else module.paContinue
            streams.append(audio.open(format=module.paInt16, channels=channels, rate=rate,
                                      input=True, input_device_index=device_id, frames_per_buffer=1024,
                                      stream_callback=callback, start=False))
        epoch = time.time()
        for stream in streams:
            stream.start_stream()
        emit(type='ready', input=input_id, output=output_id, startedAt=epoch,
             devices={'mic':next(d for d in available['inputs'] if d['id'] == input_id),
                      'system':next(d for d in available['outputs'] if d['id'] == output_id)})
        tick = 0
        def ingest(lane, data):
            state = states[lane]
            frame = av.AudioFrame.from_ndarray(np.frombuffer(data, dtype='<i2').reshape(1, -1),
                                               format='s16', layout='mono' if state['channels'] == 1 else 'stereo')
            frame.sample_rate = state['rate']
            for result in state['resampler'].resample(frame):
                state['buffer'] = np.concatenate((state['buffer'], result.to_ndarray().reshape(-1)))
        def packet(final=False):
            nonlocal tick
            size = max((len(s['buffer']) for s in states.values()), default=0) if final else 4000
            size = min(size, 4000)
            if not size:
                return False
            for lane, state in states.items():
                chunk = state['buffer'][:size]
                state['buffer'] = state['buffer'][size:]
                if len(chunk) < size:
                    chunk = np.pad(chunk, (0, size - len(chunk)))
                emit(type='audio', lane=lane, at=epoch + tick / 16000,
                     pcm=base64.b64encode(chunk.astype('<i2').tobytes()).decode('ascii'),
                     peak=int(np.max(np.abs(chunk.astype(np.int32)))) if len(chunk) else 0)
            tick += size
            return True
        while not stop.is_set():
            try:
                kind, lane, data, flags = events.get(timeout=0.01)
                if kind == 'error':
                    raise RuntimeError(data)
                if kind == 'audio':
                    if flags:
                        states[lane]['statuses'] += 1
                    ingest(lane, data)
            except queue.Empty:
                pass
            if not all(stream.is_active() for stream in streams) and not stop.is_set():
                raise RuntimeError('Windows 收音裝置已中斷，請重新選擇裝置後開始')
            if overflow.is_set() or any(s['statuses'] > 2 for s in states.values()):
                raise RuntimeError('Windows 收音緩衝區溢位，已停止；請降低系統負載後重試')
            while time.time() >= epoch + (tick + 4000) / 16000 + 0.10:
                packet()
            if any(len(s['buffer']) > 16000 * 3 for s in states.values()):
                raise RuntimeError('Windows 音訊時鐘失同步，已停止以免錄音時間錯位')
        for stream in streams:
            stream.stop_stream()
        while not events.empty():
            kind, lane, data, flags = events.get_nowait()
            if kind == 'error':
                raise RuntimeError(data)
            if kind == 'audio':
                ingest(lane, data)
        for state in states.values():
            for result in state['resampler'].resample(None):
                state['buffer'] = np.concatenate((state['buffer'], result.to_ndarray().reshape(-1)))
        while packet(final=True):
            pass
        emit(type='done')
    finally:
        stop.set()
        for stream in streams:
            stream.close()


def main():
    import pyaudiowpatch as module
    parser = argparse.ArgumentParser()
    parser.add_argument('--list', action='store_true')
    parser.add_argument('--input', type=int)
    parser.add_argument('--output', type=int)
    args = parser.parse_args()
    with module.PyAudio() as audio:
        if args.list:
            print(json.dumps(devices(audio, module), ensure_ascii=False), flush=True)
        else:
            capture(audio, module, args.input, args.output)


if __name__ == '__main__':
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding='utf-8', errors='replace')
    try:
        main()
    except Exception as error:
        emit(type='error', message=str(error))
        sys.exit(1)
