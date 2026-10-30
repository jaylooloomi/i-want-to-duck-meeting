import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {audioInfo,safeAudioFile,meetingTitle,meetingPlatform,compareSources} from '../../src/workspace-data.js';
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

test('platform identity distinguishes real meeting links from the capture engine',()=>{
 assert.equal(meetingPlatform({url:'https://meet.google.com/abc-defg-hij'}),'meet');
 assert.equal(meetingPlatform({source:'teams',url:'https://meet.google.com/abc-defg-hij'}),'meet');
 for(const host of ['teams.live.com','teams.microsoft.com','teams.cloud.microsoft'])assert.equal(meetingPlatform({recordingUrl:'https://'+host+'/meet/12345?p=secret'}),'teams');
 assert.equal(meetingPlatform({source:'teams'}),'desktop');assert.equal(meetingPlatform({source:'microphone'}),'microphone');assert.equal(meetingPlatform({source:'meet'}),'meet');
 assert.equal(meetingPlatform({code:'abc-defg-hij'}),'meet');assert.equal(meetingPlatform({}),'unknown');
 for(const url of ['https://meet.google.com.evil.example/abc-defg-hij','https://teams.live.com@evil.example/meet/1','http://meet.google.com/abc-defg-hij','https://meet.google.com:444/abc-defg-hij','javascript:alert(1)'])assert.equal(meetingPlatform({url}),'unknown');
});
