from pathlib import Path
import wave,json,array,math
root=Path('docs/design/tutorial-visual-v2/animation/narration');entries=json.loads((root/'script.json').read_text(encoding='utf-8'));rate=16000;total=entries[-1]['end'];timeline=array.array('h',[0])*(total*rate);stats=[]
for e in entries:
 with wave.open(str(root/f'scene-{e["scene"]:02}.wav'),'rb') as f:
  assert (f.getframerate(),f.getnchannels(),f.getsampwidth())==(rate,1,2);pcm=array.array('h');pcm.frombytes(f.readframes(f.getnframes()))
 offset=int((e['start']+.6)*rate);assert offset+len(pcm)<int(e['end']*rate),e
 for i in range(min(160,len(pcm)//2)):pcm[i]=int(pcm[i]*i/160);pcm[-i-1]=int(pcm[-i-1]*i/160)
 timeline[offset:offset+len(pcm)]=pcm;stats.append({'scene':e['scene'],'offset':e['start']+.6,'seconds':len(pcm)/rate,'rms':math.sqrt(sum(v*v for v in pcm)/len(pcm)),'voice':'zh-TW-HsiaoChenNeural','engine':'Microsoft Edge online TTS via edge-tts'})
with wave.open(str(root/'tutorial-narration.wav'),'wb') as f:f.setparams((1,2,rate,0,'NONE','not compressed'));f.writeframes(timeline.tobytes())
(root/'audio-validation.json').write_text(json.dumps({'duration':total,'sampleRate':rate,'scenes':stats},indent=2),encoding='utf-8')
def stamp(t):
 ms=round(t*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02}.{ms%1000:03}'
(root/'tutorial-captions.vtt').write_text('WEBVTT\n\n'+'\n\n'.join(f'{e["scene"]}\n{stamp(e["start"])} --> {stamp(e["end"])}\n{e["caption"]}' for e in entries)+'\n',encoding='utf-8')

(root/"tutorial-narration.vtt").write_text("WEBVTT\n\n"+"\n\n".join(f'{e["scene"]}\n{stamp(c["offset"])} --> {stamp(c["offset"]+c["seconds"])}\n{e["voice"]}' for e,c in zip(entries,stats))+"\n",encoding="utf-8")
