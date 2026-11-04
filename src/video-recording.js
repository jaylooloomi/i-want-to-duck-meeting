// Independent local window recording. Inspired by before-you-do (Arthur Wang, MIT).
import fs from 'node:fs';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {sttPython} from './stt.js';
import {readStatus,isProcessAlive} from './status.js';

const worker=fileURLToPath(new URL('../scripts/video-worker.py',import.meta.url));
const terminal=state=>['done','failed','archived'].includes(state);
export function videoRuntime(home){
 const candidates=[process.env.OPENMEETING_FFMPEG,path.join(home,'recording-runtime/bin/ffmpeg.exe'),process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'before-you-do/recording-runtime/ffmpeg-8.1-0448c3f3/bin/ffmpeg.exe')].filter(Boolean);
 return candidates.find(file=>path.isAbsolute(file)&&fs.existsSync(file))||null;
}
export function readVideo(dir){try{return JSON.parse(fs.readFileSync(path.join(dir,'video.json'),'utf8'));}catch{return {state:'idle',segments:[]};}}
function save(dir,value){const file=path.join(dir,'video.json'),tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2));fs.renameSync(tmp,file);}
export function videoArgs(target,out,{segmentSeconds=120,maxSeconds=4*3600,synthetic=false,syntheticRealtime=true}={}){
 if(!Number.isInteger(segmentSeconds)||segmentSeconds<1||segmentSeconds>600||!Number.isInteger(maxSeconds)||maxSeconds<1||maxSeconds>8*3600)throw new Error('Invalid recording limits');
 if(!synthetic&&!/^[1-9]\d{0,19}$/.test(target))throw new Error('Invalid window');
 return ['-hide_banner','-loglevel','error','-progress','pipe:1','-y',...(synthetic?[...(syntheticRealtime?['-re']:[]),'-f','lavfi','-i','testsrc2=size=320x180:rate=15']:['-f','gdigrab','-framerate','15','-draw_mouse','1','-i','hwnd='+target]),'-an','-t',String(maxSeconds),'-vf','scale=w=min(1280\\,iw):h=-2,pad=ceil(iw/2)*2:ceil(ih/2)*2','-c:v','libvpx','-deadline','realtime','-cpu-used','6','-b:v','1600k','-g','30','-f','segment','-segment_time',String(segmentSeconds),'-reset_timestamps','1','-segment_list',path.join(out,'segments.csv'),'-segment_list_type','csv',path.join(out,'part-%05d.webm')];
}
export function segmentTimeline(csv,offset){
 return csv.trim().split(/\r?\n/).filter(Boolean).map(line=>{
  const match=/^"?(part-\d{5}\.webm)"?,([\d.]+),([\d.]+)$/.exec(line);
  if(!match||!Number.isFinite(offset)||+match[3]<=+match[2])throw new Error('Invalid recording timeline');
  return {file:match[1],startSeconds:+match[2],endSeconds:+match[3],meetingStartSeconds:offset+(+match[2]),meetingEndSeconds:offset+(+match[3])};
 });
}
export function safeVideoFile(dir,name){
 if(!/^(?:part-\d{5}|meeting-video)\.webm$/.test(name))return null;
 try{const requestedRoot=path.join(fs.realpathSync(dir),'video');if(fs.lstatSync(requestedRoot).isSymbolicLink())return null;const root=fs.realpathSync(requestedRoot),file=path.join(root,name);if(fs.lstatSync(file).isSymbolicLink()||fs.realpathSync(file)!==file||!fs.statSync(file).isFile())return null;return file;}catch{return null;}
}
export class VideoService{
 constructor({home,python,executable,enumerate,synthetic=false,syntheticRealtime=true,segmentSeconds=120,maxSeconds=4*3600}={}){
  this.home=home;this.python=python||sttPython({home});this.executable=executable||videoRuntime(home);this.enumerate=enumerate;this.synthetic=synthetic;this.syntheticRealtime=syntheticRealtime;this.segmentSeconds=segmentSeconds;this.maxSeconds=maxSeconds;this.current=null;this.finalizations=new Map();
 }
 capabilities(){return {supported:process.platform==='win32',runtimeReady:!!this.executable&&fs.existsSync(this.executable),workerReady:fs.existsSync(this.python),activeId:this.current?.id||null};}
 async install(){if(this.current||this.installing)throw new Error('錄影元件忙碌中');this.installing=true;try{await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('../scripts/install-video-runtime.ps1',import.meta.url))],{windowsHide:true,timeout:600000,maxBuffer:65536,env:{...process.env,DUCK_VIDEO_RUNTIME:path.join(this.home,'recording-runtime')}});this.executable=videoRuntime(this.home);return this.capabilities();}finally{this.installing=false;}}
 async windows(){if(this.enumerate)return this.enumerate();const {stdout}=await promisify(execFile)(this.python,[worker,'--windows'],{windowsHide:true,timeout:10000,maxBuffer:1024*1024});return JSON.parse(stdout);}
 acquire(session){
  fs.mkdirSync(this.home,{recursive:true});const file=path.join(this.home,'video-recording.lock');
  try{const old=JSON.parse(fs.readFileSync(file,'utf8'));if(old.pid&&!isProcessAlive(old.pid)&&!fs.lstatSync(file).isSymbolicLink())fs.unlinkSync(file);}catch{}
  try{const fd=fs.openSync(file,'wx');session.lock=file;session.lockValue=JSON.stringify({pid:process.pid,id:session.id,created:Date.now()});try{fs.writeFileSync(fd,session.lockValue);}finally{fs.closeSync(fd);}}catch{throw new Error('另一個站台已有錄影工作');}
 }
 release(session){try{if(session.lock&&fs.readFileSync(session.lock,'utf8')===session.lockValue)fs.unlinkSync(session.lock);}catch{}}
 async start({id,dir,windowId}){
  if(this.closed||this.current||this.installing)throw new Error('已有錄影工作或正在安裝元件');
  if(!this.capabilities().runtimeReady||!this.capabilities().workerReady)throw new Error('錄影元件尚未備妥');
  const status=readStatus(dir);if(status?.state!=='in_call')throw new Error('僅能為進行中的會議開始錄影');
  const base=Date.parse(status.joinedAt||status.startedAt);if(!Number.isFinite(base))throw new Error('缺少會議起始時間');
  if(readVideo(dir).state!=='idle')throw new Error('這場已有錄影資料，請保留原檔');
  // Reserve before the asynchronous window lookup to reject concurrent starts.
  const session={id,dir,starting:true};session.started=new Promise(resolve=>{session.startedResolve=resolve;});this.current=session;
  try{
   this.acquire(session);
   const targets=await this.windows(),target=targets.find(w=>w.id===windowId);if(!target)throw new Error('視窗已關閉或最小化，請重新選擇');
   if(this.closed)throw new Error('站台正在關閉');
   const out=path.join(dir,'video');if(fs.existsSync(out))throw new Error('錄影資料夾已存在');
   const stat=fs.statfsSync(dir);if(Number(stat.bavail)*Number(stat.bsize)<512*1024*1024)throw new Error('磁碟空間不足 512 MB');fs.mkdirSync(out);
   const startedAt=new Date().toISOString();session.view={state:'starting',ownerPid:process.pid,startedAt,offsetSeconds:Math.max(0,(Date.parse(startedAt)-base)/1000),target:{id:target.id,title:target.title,pid:target.pid},segments:[],audioState:'separate',timelineAccuracy:'encoder-start-estimate'};
   save(dir,session.view);
   const args=videoArgs(target.id,out,this),child=spawn(this.python,[worker,'--run',String(process.pid),this.executable,...args],{windowsHide:true,stdio:['pipe','pipe','pipe']});
   session.child=child;session.starting=false;let logs='';child.stderr.on('data',chunk=>{logs=(logs+chunk).slice(-4096);});let progress='';child.stdout.on('data',chunk=>{progress+=chunk;const lines=progress.split('\n');progress=lines.pop();for(const line of lines)if(/^out_time_us=\d+/.test(line)&&session.view.state==='starting'){const elapsed=Number(line.split('=')[1])/1e6;session.view.offsetSeconds=Math.max(0,(Date.now()-base)/1000-elapsed);session.view.state='recording';try{save(dir,session.view);}catch{void this.stop(id).catch(()=>{});}}});child.stdin.on('error',()=>{});
   session.finished=new Promise(resolve=>{let done=false;const finish=async(code,error)=>{
    if(done)return;done=true;clearInterval(session.timer);session.view.stoppedAt=new Date().toISOString();
    try{
     session.view.state='finalizing';save(dir,session.view);
     try{session.view.segments=segmentTimeline(fs.readFileSync(path.join(out,'segments.csv'),'utf8'),session.view.offsetSeconds);if(error||code!==0||!session.view.segments.length)throw new Error(error?.message||logs||'未錄到有效畫面');session.view.state='ready';}catch(e){session.view.state='failed';session.view.error=e.message;session.view.recovery='video/';}
     save(dir,session.view);
     if(session.view.state==='ready'&&terminal(readStatus(dir)?.state))session.view=await this.finalize(dir);
    }catch(error){session.view.state='failed';session.view.error=error.message;session.view.recovery='video/';try{save(dir,session.view);}catch{}}
    finally{this.release(session);if(this.current===session)this.current=null;resolve(session.view);}
   };child.once('error',error=>void finish(null,error));child.once('close',code=>void finish(code));});
   session.timer=setInterval(()=>{if(session.stopping)return;try{const st=readStatus(dir),disk=fs.statfsSync(dir);if(terminal(st?.state)||Number(disk.bavail)*Number(disk.bsize)<256*1024*1024)void this.stop(id).catch(()=>{});else{const csv=path.join(out,'segments.csv');if(fs.existsSync(csv)){session.view.segments=segmentTimeline(fs.readFileSync(csv,'utf8'),session.view.offsetSeconds);if(session.view.segments.length)session.view.state='recording';save(dir,session.view);}}}catch{void this.stop(id).catch(()=>{});}},1000);session.timer.unref();
   return session.view;
  }catch(error){this.release(session);if(this.current===session)this.current=null;throw error;}finally{session.startedResolve();}
 }
 async stop(id){const s=this.current;if(!s||s.id!==id)throw new Error('沒有這場的錄影工作');if(s.starting)throw new Error('錄影正在啟動');if(!s.stopping){s.stopping=true;s.view.state='stopping';try{save(s.dir,s.view);}catch{}s.child.stdin.end('q\n');}return s.finished;}
 async finalize(dir){
  if(this.finalizations.has(dir))return this.finalizations.get(dir);
  const value=readVideo(dir);if(value.state!=='ready'||value.audioState==='embedded'||!terminal(readStatus(dir)?.state)||!value.segments?.length)return value;
  const task=(async()=>{
   const out=path.join(dir,'video'),list=path.join(out,'concat.txt'),output=path.join(out,'meeting-video.webm');
   const audio=path.join(dir,'audio.wav');let hasAudio=false;
   try{const stat=fs.lstatSync(audio);hasAudio=stat.isFile()&&!stat.isSymbolicLink()&&stat.size>44;}catch{}
   if(!hasAudio&&value.file==='meeting-video.webm')return value;
   try{
    for(const segment of value.segments)if(!safeVideoFile(dir,segment.file))throw new Error('錄影片段不存在');
    const required=value.segments.reduce((bytes,segment)=>bytes+fs.statSync(safeVideoFile(dir,segment.file)).size,0)*1.2+(hasAudio?fs.statSync(audio).size:0)+256*1024*1024,disk=fs.statfsSync(dir);
    if(Number(disk.bavail)*Number(disk.bsize)<required)throw new Error('磁碟空間不足以封裝影片；原始片段已保留');
    fs.writeFileSync(list,value.segments.map(s=>`file '${s.file}'`).join('\n')+'\n');
    value.state='finalizing';save(dir,value);
    const args=['-hide_banner','-loglevel','error','-y','-f','concat','-safe','1','-i',list,...(hasAudio?['-ss',String(value.offsetSeconds),'-i',audio,'-map','0:v:0','-map','1:a:0','-c:a','libopus','-shortest']:['-an']),'-c:v','copy',output];
    await new Promise((resolve,reject)=>{const child=spawn(this.python,[worker,'--run',String(process.pid),this.executable,...args],{windowsHide:true,stdio:['pipe','ignore','pipe']});let logs='';const timer=setTimeout(()=>{child.kill();reject(new Error('影片封裝逾時，保留原始片段'));},120000);child.stderr.on('data',c=>{logs=(logs+c).slice(-4096);});child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(logs||'影片封裝失敗'));});});
    if(!fs.statSync(output).size)throw new Error('影片檔案為空');
    const probe=path.join(path.dirname(this.executable),'ffprobe.exe');
    const {stdout}=await promisify(execFile)(probe,['-v','error','-show_streams','-show_format','-of','json',output],{windowsHide:true,timeout:15000,maxBuffer:1024*1024});const media=JSON.parse(stdout);
    if(!media.streams?.some(s=>s.codec_type==='video')||!(Number(media.format?.duration)>0)||(hasAudio&&!media.streams.some(s=>s.codec_type==='audio')))throw new Error('影片或音軌驗證失敗，保留原始片段');
    value.state='ready';value.file='meeting-video.webm';value.audioState=hasAudio?'embedded':'unavailable';delete value.error;save(dir,value);
   }catch(error){value.state='ready';value.error=error.message;value.recovery='video/';save(dir,value);}
   return value;
  })().finally(()=>this.finalizations.delete(dir));this.finalizations.set(dir,task);return task;
 }
 async shutdown(){this.closed=true;if(this.current?.starting)await this.current.started;if(this.current)await this.stop(this.current.id);await Promise.allSettled([...this.finalizations.values()]);}
 recover(dir){const value=readVideo(dir);if(['starting','recording','stopping','finalizing'].includes(value.state)&&value.ownerPid&&!isProcessAlive(value.ownerPid)){value.state='failed';value.error='錄影程序已中斷，原始片段已保留';value.recovery='video/';try{value.segments=segmentTimeline(fs.readFileSync(path.join(dir,'video/segments.csv'),'utf8'),value.offsetSeconds);}catch{}save(dir,value);}return value;}
}
