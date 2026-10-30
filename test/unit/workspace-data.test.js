import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {audioInfo,safeAudioFile,meetingTitle,compareSources} from '../../src/workspace-data.js';
import {createWavHeader} from '../../src/audio/wav-writer.js';

test('workspace reads only known valid PCM audio and derives waveform from samples',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-unit-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 assert.equal(audioInfo(dir,'audio.wav'),null);fs.writeFileSync(path.join(dir,'audio.wav'),'invalid');assert.equal(audioInfo(dir,'audio.wav'),null);
 assert.equal(safeAudioFile(dir,'../audio.wav'),null);assert.equal(safeAudioFile(dir,'status.json'),null);
 const samples=Buffer.alloc(32000);samples.writeInt16LE(1000,0);fs.writeFileSync(path.join(dir,'audio.wav'),Buffer.concat([createWavHeader({dataBytes:samples.length}),samples]));
 const info=audioInfo(dir,'audio.wav');assert.equal(info.seconds,1);assert.equal(info.waveform.length,64);assert.equal(info.waveform[0],1000/32768);
 fs.writeFileSync(path.join(dir,'summary.md'),'# Existing title\n');assert.equal(meetingTitle(dir,{}),'Existing title');assert.equal(meetingTitle(dir,{title:' User title '}),'User title');
});
test('advisory comparison never treats missing or unaligned evidence as verified',()=>{
 const status={joinedAt:'2026-01-01T00:00:00Z'};
 const records=[{text:'Budget 1357',t0:'2026-01-01T00:00:05Z',t1:'2026-01-01T00:00:10Z',source:'captions'}];
 assert.equal(compareSources(status,records,{}).state,'unavailable');assert.equal(compareSources({},records,{segments:[{start:5,end:10,text:'Budget 1357'}]}).state,'unavailable');
 let compared=compareSources(status,records,{segments:[{start:50,end:51,text:'Budget 1357'}]});assert.equal(compared.state,'unaligned');assert.equal(compared.unmatched,1);
 compared=compareSources(status,records,{segments:[{start:5,end:10,text:'Budget 1357!'}]});assert.equal(compared.state,'compared');assert.equal(compared.pairs.length,0);
 compared=compareSources(status,records,{segments:[{start:5,end:10,text:'Budget 1537'}]});assert.equal(compared.pairs[0].important,true);assert.equal(compared.pairs[0].caption,'Budget 1357');
 compared=compareSources(status,[{...records[0],text:'Cost 1.35'}],{segments:[{start:5,end:10,text:'Cost 135'}]});assert.equal(compared.pairs[0].important,true);
 assert.equal(compareSources(status,[{...records[0],source:'local-audio'}],{segments:[{start:5,end:10,text:'Budget 1537'}]}).state,'unavailable');
});
