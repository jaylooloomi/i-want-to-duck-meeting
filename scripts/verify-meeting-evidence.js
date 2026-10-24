#!/usr/bin/env node
// Offline read-only evidence check; never injects markers into ASR or captions.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {evaluateMeetingEvidence} from '../src/verification.js';

const args=process.argv.slice(2);
if(args.length!==2 || args[0]!=='--manifest') {
  console.error('Usage: node scripts/verify-meeting-evidence.js --manifest <local JSON>');process.exit(1);
}
try {
  const manifestPath=path.resolve(args[1]);
  const spec=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  const read=name=>fs.readFileSync(path.resolve(path.dirname(manifestPath),name),'utf8');
  const captions=JSON.parse(read(spec.captionFile));
  if(!Array.isArray(captions))throw new Error('captionFile must contain a JSON array');
  const decoded=JSON.parse(read(spec.audioTranscriptFile));
  const wav=fs.readFileSync(path.resolve(path.dirname(manifestPath),spec.wavFile));
  const audioSha256=createHash('sha256').update(wav).digest('hex');
  if(decoded.audioSha256!==audioSha256)throw new Error('Audio transcript is not bound to this WAV SHA-256');
  if(wav.toString('ascii',0,4)!=='RIFF' || wav.toString('ascii',8,12)!=='WAVE')throw new Error('Not a WAV');
  let rate,channels,data,bits,format;
  for(let i=12;i+8<=wav.length;) {
    const length=wav.readUInt32LE(i+4),end=i+8+length;
    if(end>wav.length)throw new Error('Truncated WAV');
    const type=wav.toString('ascii',i,i+4);
    if(type==='fmt ' && length>=16){format=wav.readUInt16LE(i+8);channels=wav.readUInt16LE(i+10);rate=wav.readUInt32LE(i+12);bits=wav.readUInt16LE(i+22);}
    if(type==='data')data=wav.subarray(i+8,end);
    i=end+(length%2);
  }
  if(format!==1 || bits!==16 || !rate || !channels || !data || data.length%2)throw new Error('Expected PCM16 WAV');
  let peak=0;for(let i=0;i<data.length;i+=2)peak=Math.max(peak,Math.abs(data.readInt16LE(i)));
  const result=evaluateMeetingEvidence({...spec,
    captionText:captions.map(x=>x.text || '').join(' '),recordingText:decoded.decodedText,
    audioSeconds:data.length/(2*channels*rate),audioPeak:peak});
  console.log(JSON.stringify({...result,audioSha256},null,2));
  if(!result.captionsMatch || !result.recordingMatch || !result.signal)process.exitCode=2;
} catch(error){console.error(error.message);process.exitCode=1;}
