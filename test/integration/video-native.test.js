import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {VideoService,videoArgs,segmentTimeline,safeVideoFile,videoRuntime,readVideo} from '../../src/video-recording.js';
import {writeStatus} from '../../src/status.js';
import {isProcessAlive} from '../../src/status.js';

const nativeReady=process.platform==='win32'&&!!videoRuntime(path.resolve('.'))&&fs.existsSync(path.resolve('.venv-stt/Scripts/python.exe'));
test('VIDEO real synthetic FFmpeg segments exceed short-clip limits and decode',{timeout:30000,skip:!nativeReady?'Optional Windows FFmpeg/Python runtime unavailable':false},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duck-video-native-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const home=path.resolve('.'),exe=videoRuntime(home);assert.ok(exe,'Install the documented FFmpeg runtime before native verification');
 writeStatus(dir,{id:'synthetic',state:'in_call',startedAt:new Date(Date.now()-10000).toISOString()});
 const service=new VideoService({home,python:path.resolve('.venv-stt/Scripts/python.exe'),executable:exe,synthetic:true,enumerate:async()=>[{id:'123',title:'SYNTHETIC ONLY',pid:0}],segmentSeconds:2,maxSeconds:5});
 t.after(()=>service.shutdown());await service.start({id:'synthetic',dir,windowId:'123'});const result=await service.current.finished;
 assert.equal(result.state,'ready',result.error);assert.ok(result.segments.length>=2);assert.ok(result.offsetSeconds>=9&&result.offsetSeconds<14);
 for(const segment of result.segments)await promisify(execFile)(exe,['-v','error','-i',safeVideoFile(dir,segment.file),'-f','null','-'],{windowsHide:true,timeout:10000});
 assert.equal(service.current,null);assert.equal(readVideo(dir).state,'ready');
 await promisify(execFile)(exe,['-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=16000','-t','20','-c:a','pcm_s16le',path.join(dir,'audio.wav')],{windowsHide:true});
 writeStatus(dir,{state:'done'});const merged=await service.finalize(dir);assert.equal(merged.audioState,'embedded',merged.error);
 const probe=path.join(path.dirname(exe),'ffprobe.exe');const {stdout}=await promisify(execFile)(probe,['-v','error','-show_streams','-of','json',safeVideoFile(dir,merged.file)],{windowsHide:true});
 const streams=JSON.parse(stdout).streams;assert.ok(streams.some(s=>s.codec_type==='video'));assert.ok(streams.some(s=>s.codec_name==='opus'));
 const decoded=await promisify(execFile)(exe,['-hide_banner','-i',safeVideoFile(dir,merged.file),'-vn','-af','volumedetect','-f','null','-'],{windowsHide:true});assert.match(decoded.stderr,/mean_volume: -(?:[1-9]|[1-9]\d)(?:\.\d+)? dB/);
 assert.throws(()=>videoArgs('123',dir,{maxSeconds:120.5}));
});
test('VIDEO long synthetic recording produces over 120 seconds of playable video',{timeout:60000,skip:!nativeReady?'Optional Windows FFmpeg/Python runtime unavailable':false},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duck-video-long-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const home=path.resolve('.');
 writeStatus(dir,{id:'long',state:'in_call',startedAt:new Date().toISOString()});
 const service=new VideoService({home,python:path.resolve('.venv-stt/Scripts/python.exe'),synthetic:true,syntheticRealtime:false,enumerate:async()=>[{id:'123',title:'SYNTHETIC LONG',pid:0}],segmentSeconds:30,maxSeconds:125});t.after(()=>service.shutdown());
 await service.start({id:'long',dir,windowId:'123'});const result=await service.current.finished;assert.equal(result.state,'ready',result.error);assert.ok(result.segments.at(-1).endSeconds>=124);assert.ok(result.segments.length>=4);
 const exe=videoRuntime(home);for(const part of result.segments)await promisify(execFile)(exe,['-v','error','-i',safeVideoFile(dir,part.file),'-f','null','-'],{windowsHide:true,timeout:15000});
});
test('VIDEO real HWND capture records only own synthetic window pixels',{timeout:30000,skip:!nativeReady?'Optional Windows FFmpeg/Python runtime unavailable':false},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duck-video-hwnd-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const home=path.resolve('.'),python=path.resolve('.venv-stt/Scripts/python.exe');
 const window=spawn(python,['test/fixtures/video-window.py'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let logs='';window.stderr.on('data',c=>{logs+=c;});t.after(()=>{window.stdin.end('q');window.kill();});
 const target=await new Promise((resolve,reject)=>{window.stdout.once('data',c=>{try{resolve(JSON.parse(c.toString().trim()));}catch(e){reject(e);}});window.once('error',reject);window.once('exit',code=>reject(new Error('Synthetic window failed '+code+': '+logs)));});
 writeStatus(dir,{id:'hwnd',state:'in_call',startedAt:new Date().toISOString()});
 const service=new VideoService({home,python,enumerate:async()=>[target],segmentSeconds:2,maxSeconds:3});t.after(()=>service.shutdown());await service.start({id:'hwnd',dir,windowId:target.id});const result=await service.current.finished;assert.equal(result.state,'ready',result.error);
 const {stdout}=await promisify(execFile)(videoRuntime(home),['-v','error','-i',safeVideoFile(dir,result.segments[0].file),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{windowsHide:true,encoding:'buffer',maxBuffer:2*1024*1024});
 let matching=0;for(let i=0;i<stdout.length;i+=3)if(Math.abs(stdout[i]-51)<15&&Math.abs(stdout[i+1]-102)<15&&Math.abs(stdout[i+2]-204)<15)matching++;assert.ok(matching/(stdout.length/3)>.85,'Captured pixels must match the synthetic window, not the desktop');
});
test('VIDEO owner crash terminates both guard and synthetic encoder',{timeout:20000,skip:!nativeReady?'Optional Windows FFmpeg/Python runtime unavailable':false},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duck-video-owner-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const code=`const {spawn}=require('node:child_process');const c=spawn(process.argv[1],['scripts/video-worker.py','--run',String(process.pid),process.argv[2],'-hide_banner','-loglevel','error','-re','-f','lavfi','-i','testsrc2=size=160x120:rate=10','-t','60','-an','-c:v','libvpx',process.argv[3]],{windowsHide:true,stdio:['pipe','pipe','pipe']});console.log('DUCK_GUARD_PID='+c.pid);c.stdout.pipe(process.stdout);c.stderr.pipe(process.stderr);setInterval(()=>{},1000);`;
 const parent=spawn(process.execPath,['-e',code,path.resolve('.venv-stt/Scripts/python.exe'),videoRuntime(path.resolve('.')),path.join(dir,'test.webm')],{windowsHide:true,stdio:['ignore','pipe','pipe']});t.after(()=>parent.kill());let output='',errors='';parent.stderr.on('data',c=>errors+=c);
 const pids=await new Promise((resolve,reject)=>{parent.stdout.on('data',c=>{output+=c;const guard=/DUCK_GUARD_PID=(\d+)/.exec(output),encoder=/DUCK_ENCODER_PID=(\d+)/.exec(output);if(guard&&encoder)resolve([+guard[1],+encoder[1]]);});parent.once('exit',code=>reject(new Error('Owner failed '+code+': '+errors)));});
 assert.ok(pids.every(isProcessAlive));parent.kill();
 await new Promise((resolve,reject)=>{const deadline=setTimeout(()=>{clearInterval(check);reject(new Error('Recording process survived owner death'));},17000);const check=setInterval(()=>{if(pids.every(pid=>!isProcessAlive(pid))){clearInterval(check);clearTimeout(deadline);resolve();}},100);});
 assert.ok(pids.every(pid=>!isProcessAlive(pid)));
});
test('VIDEO meeting completion automatically stops capture without an audio success claim',{timeout:20000,skip:!nativeReady?'Optional Windows FFmpeg/Python runtime unavailable':false},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duck-video-end-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));writeStatus(dir,{id:'end',state:'in_call',startedAt:new Date().toISOString()});
 const service=new VideoService({home:dir,python:path.resolve('.venv-stt/Scripts/python.exe'),synthetic:true,enumerate:async()=>[{id:'123',title:'SYNTHETIC END',pid:0}],maxSeconds:60});t.after(()=>service.shutdown());
 await service.start({id:'end',dir,windowId:'123'});const finished=service.current.finished;writeStatus(dir,{state:'done'});const result=await finished;
 assert.equal(result.state,'ready',result.error);assert.equal(result.audioState,'unavailable');assert.ok(result.segments.at(-1).endSeconds<15);assert.equal(result.file,'meeting-video.webm');assert.equal(service.current,null);assert.equal(fs.existsSync(path.join(dir,'video-recording.lock')),false);
});
