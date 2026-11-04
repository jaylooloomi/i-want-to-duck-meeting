import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {VideoService,videoArgs,segmentTimeline,safeVideoFile,videoRuntime,readVideo} from '../../src/video-recording.js';
import {writeStatus} from '../../src/status.js';

test('VIDEO bounded native argv, no shell or arbitrary desktop source',()=>{
 const args=videoArgs('123','C:/space & safe');assert.ok(args.includes('hwnd=123'));assert.ok(args.includes('-an'));assert.ok(!args.includes('desktop'));assert.ok(!args.includes('24'));assert.ok(args.includes('14400'));
 for(const target of ['0','desktop','123 & calc','-i','../x'])assert.throws(()=>videoArgs(target,'out'));
 assert.throws(()=>videoArgs('123','out',{maxSeconds:Infinity}));
 const parts=segmentTimeline('part-00000.webm,0,2\npart-00001.webm,2,4',10);
 assert.equal(parts[1].meetingStartSeconds,12);assert.equal(parts[1].meetingEndSeconds,14);
 assert.throws(()=>segmentTimeline('../outside.webm,0,2',0));
});
test('VIDEO media path allowlist rejects traversal and symlinks',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duck-video-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.mkdirSync(path.join(dir,'video'));fs.writeFileSync(path.join(dir,'video/part-00000.webm'),'safe');
 assert.ok(safeVideoFile(dir,'part-00000.webm'));assert.equal(safeVideoFile(dir,'../status.json'),null);assert.equal(safeVideoFile(dir,'segments.csv'),null);
});
test('VIDEO reserves cross-server capture before async selection and releases on failure',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'duck-video-lock-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const dir=path.join(root,'meeting');fs.mkdirSync(dir);writeStatus(dir,{id:'lock',state:'in_call',startedAt:new Date().toISOString()});
 let release;const gate=new Promise(resolve=>{release=resolve;});const options={home:root,python:process.execPath,executable:process.execPath,enumerate:()=>gate};
 const first=new VideoService(options),second=new VideoService(options);const pending=first.start({id:'lock',dir,windowId:'123'});const failed=assert.rejects(pending,/視窗已關閉/);
 await assert.rejects(first.start({id:'lock',dir,windowId:'123'}),/已有錄影/);await assert.rejects(second.start({id:'lock',dir,windowId:'123'}),/另一個站台/);
 release([]);await failed;assert.equal(first.current,null);assert.equal(fs.existsSync(path.join(root,'video-recording.lock')),false);assert.equal(fs.existsSync(path.join(dir,'video')),false);
});
test('VIDEO stale recorder is reported as interrupted rather than still recording',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duck-video-orphan-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.mkdirSync(path.join(dir,'video'));fs.writeFileSync(path.join(dir,'video.json'),JSON.stringify({state:'recording',ownerPid:2147483647,offsetSeconds:8}));fs.writeFileSync(path.join(dir,'video/segments.csv'),'part-00000.webm,0,2\n');
 const view=new VideoService({home:dir}).recover(dir);assert.equal(view.state,'failed');assert.equal(view.segments[0].meetingStartSeconds,8);assert.equal(view.recovery,'video/');
});
test('VIDEO insufficient space leaves no empty recording that blocks retry',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duck-video-space-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));writeStatus(dir,{id:'space',state:'in_call',startedAt:new Date().toISOString()});
 const service=new VideoService({home:dir,python:process.execPath,executable:process.execPath,enumerate:async()=>[{id:'123',title:'NO CAPTURE',pid:0}]});t.mock.method(fs,'statfsSync',()=>({bavail:1,bsize:4096}));
 await assert.rejects(service.start({id:'space',dir,windowId:'123'}),/512 MB/);assert.equal(fs.existsSync(path.join(dir,'video')),false);assert.equal(fs.existsSync(path.join(dir,'video-recording.lock')),false);assert.equal(service.current,null);
});
