from pathlib import Path
import sys,asyncio,json,wave,array
sys.path.insert(0,str(Path('test/.tmp/voice-tools').resolve()))
import edge_tts,av
root=Path('docs/design/tutorial-visual-v2/animation/narration')
entries=json.loads((root/'script.json').read_text(encoding='utf-8'))
async def main():
 for e in entries:
  stem=root/f'scene-{e["scene"]:02}'
  for speed in [-5,0,10,20,30,40]:
   await edge_tts.Communicate(e['voice'],'zh-TW-HsiaoChenNeural',rate=f'{speed:+}%').save(str(stem.with_suffix('.mp3')))
   pcm=array.array('h')
   with av.open(str(stem.with_suffix('.mp3'))) as container:
    resampler=av.AudioResampler(format='s16',layout='mono',rate=16000)
    for frame in container.decode(audio=0):
     for chunk in resampler.resample(frame):pcm.frombytes(chunk.to_ndarray().tobytes())
    for chunk in resampler.resample(None):pcm.frombytes(chunk.to_ndarray().tobytes())
   duration=len(pcm)/16000
   if duration < e['end']-e['start']-.9:break
  else:raise RuntimeError(f'Voice exceeds scene {e["scene"]}')
  with wave.open(str(stem.with_suffix('.wav')),'wb') as f:
   f.setparams((1,2,16000,0,'NONE','not compressed'));f.writeframes(pcm.tobytes())
  print(e['scene'],round(duration,2),speed,flush=True)
 (root/'voice-engine.json').write_text(json.dumps({'voice':'zh-TW-HsiaoChenNeural','engine':'Microsoft Edge online TTS via edge-tts','sampleRate':16000},indent=2),encoding='utf-8')
asyncio.run(main())
