import fs from 'node:fs';
import path from 'node:path';
import {joinMeeting} from '../src/meet/join.js';
import {prepareInCall,leaveCall} from '../src/meet/incall.js';
import {installAudioOutputCapture,installAudioCapture} from '../src/page/audio-capture.js';
import {installCaptionObserver} from '../src/page/caption-observer.js';
import {serializableSel} from '../src/meet/selectors.js';
import {CaptionAssembler} from '../src/captions/assembler.js';
import {WavWriter} from '../src/audio/wav-writer.js';

/** Test-only authenticated extra page. No input is injected into the receiving page. */
export async function receiveLiveTest({context,url,dir,seconds,shouldStop=()=>false},deps={}) {
  if(new URL(url).hostname!=='meet.google.com')throw new Error('Expected Google Meet test host');
  const page=await context.newPage();let wav;
  const assembler=new CaptionAssembler(),records=[];
  const result={state:'starting',joined:false,captureRoute:'remote-received',sharedAuthenticatedContext:true};
  const started=Date.now();
  try {
    await page.addInitScript(installAudioOutputCapture);
    await (deps.join || joinMeeting)(page,{url,displayName:'Synthetic test receiver',pollMs:700,
      prejoinTimeoutMs:25000,lobbyTimeoutMs:30000,maxAttempts:1,
      shouldStop:()=>shouldStop() || Date.now()-started>65000+seconds*1000?'test_timeout':null});
    result.joined=true;
    result.prepared=await (deps.prepare || prepareInCall)(page,{captionLang:'cmn-Hant-TW'});
    wav=new WavWriter(path.join(dir,'remote.wav'));
    await page.exposeBinding('__omAudio',(_,data)=>wav.write(Buffer.from(data,'base64')));
    await page.exposeBinding('__omCaptions',(_,data)=>{
      records.push(...assembler.update(data.blocks,data.ts));
      fs.appendFileSync(path.join(dir,'receiver-caption-events.jsonl'),JSON.stringify(data)+'\n');
    });
    await page.evaluate(installCaptionObserver,serializableSel());
    result.capture=await page.evaluate(installAudioCapture,{flushMs:250});
    const until=Date.now()+seconds*1000;
    while(Date.now()<until && !shouldStop())await page.waitForTimeout(500);
    await page.evaluate(()=>window.__omAudioCapture?.stop());await page.waitForTimeout(300);
    if(shouldStop())throw new Error('Test cancelled');
    result.state='completed';
  } catch(error) {result.state='failed';result.error=error.message;}
  finally {
    try {
    records.push(...assembler.flush(Date.now()));wav?.close();
    result.audioSeconds=wav?.seconds || 0;result.audioPeak=wav?.peak || 0;
    fs.writeFileSync(path.join(dir,'receiver-captions.json'),JSON.stringify(records,null,2)+'\n');
    fs.writeFileSync(path.join(dir,'receiver-result.json'),JSON.stringify(result,null,2)+'\n');
    } finally {
    if(result.joined)await leaveCall(page).catch(()=>{});
    await page.close().catch(()=>{});
    }
  }
  return result;
}
