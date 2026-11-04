import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {browserCase,fixture,record,defer} from './harness.js';
import {readVideo} from '../../src/video-recording.js';
import {VideoService,videoRuntime} from '../../src/video-recording.js';
import {createWavHeader} from '../../src/audio/wav-writer.js';
import {writeStatus} from '../../src/status.js';

test('VIDEO API origin exact identity input and media range boundaries',async t=>{
 const app=await fixture();t.after(()=>app.close());const dir=app.seed('video-api',{state:'done'});
 const post=(payload,origin=app.url)=>fetch(app.url+'/api/video',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(payload)});
 assert.equal((await post({id:'video-api',action:'start',windowId:'123'},'https://evil.example')).status,403);
 assert.equal((await post({id:'latest',action:'stop'})).status,400);assert.equal((await post({id:'video',action:'stop'})).status,404);
 assert.equal((await post({id:'video-api',action:'start',windowId:'123',synthetic:true})).status,400);
 assert.equal((await post({id:'video-api',action:'pause'})).status,400);
 fs.mkdirSync(path.join(dir,'video'));fs.writeFileSync(path.join(dir,'video/part-00000.webm'),Buffer.from('0123456789'));
 const res=await fetch(app.url+'/api/video-file?id=video-api&file=part-00000.webm',{headers:{Range:'bytes=2-5'}});assert.equal(res.status,206);assert.equal(res.headers.get('content-type'),'video/webm');assert.equal(await res.text(),'2345');
 assert.equal((await fetch(app.url+'/api/video-file?id=video-api&file=../status.json')).status,404);
 assert.equal((await fetch(app.url+'/api/video-file?id=video-api&file=part-00000.webm',{headers:{Range:'bytes=50-60'}})).status,416);
 assert.equal(readVideo(dir).state,'idle');
});

for(const width of [390,1280])for(const theme of ['light','dark'])test(`VIDEO UI explicit source busy guard errors and ready player ${width} ${theme}`,{timeout:25000},t=>browserCase(t,async({page,app,dir})=>{
 app.seed('video-ui',{state:'in_call',startedAt:'2026-11-03T00:00:00Z'},[record('錄影測試內容')]);
 await page.addInitScript(theme=>localStorage.setItem('duck-meeting:theme',theme),theme);
 let state={state:'idle',supported:true,runtimeReady:true,workerReady:true,activeId:null,segments:[]},starts=0;const gate=defer();
 await page.route('**/api/video?id=*',route=>route.fulfill({json:state}));
 await page.route('**/api/video/windows',route=>route.fulfill({json:{supported:true,runtimeReady:true,workerReady:true,windows:[{id:'123',pid:7,title:'Synthetic Meet <script>literal</script>',width:1280,height:720}]}}));
 await page.route('**/api/video',async route=>{const body=route.request().postDataJSON();if(body.action==='start'){starts++;assert.equal(body.windowId,'123');await gate.promise;state={...state,state:'recording',activeId:'video-ui'};await route.fulfill({json:state});}else{state={...state,state:'ready',activeId:null,error:'測試封裝失敗，片段保留'};await route.fulfill({json:state});}});
 await page.goto(app.url+'/?id=video-ui&secondary=none');await page.getByRole('region',{name:'會議逐字稿'}).getByText('錄影測試內容',{exact:true}).waitFor();assert.equal(starts,0);
 await page.getByLabel('會議更多操作',{exact:true}).click();await page.getByRole('button',{name:'會議影片／錄影',exact:true}).click();const modal=page.getByRole('dialog',{name:'會議影片／錄影',exact:true});await modal.waitFor();
 const start=modal.getByRole('button',{name:'開始錄影',exact:true}),stop=modal.getByRole('button',{name:'停止錄影',exact:true});assert.equal(await start.isEnabled(),false);
 await modal.getByRole('button',{name:'選擇錄影視窗',exact:true}).click();await modal.getByRole('combobox',{name:'錄影視窗',exact:true}).selectOption('123');assert.equal(await start.isEnabled(),true);await start.click();assert.equal(await start.isEnabled(),false);gate.resolve();await page.waitForFunction(()=>!document.getElementById('video-stop').disabled);assert.equal(starts,1);
 await stop.click();await modal.getByText(/測試封裝失敗，片段保留/).waitFor();assert.equal(await stop.isVisible(),false);
 const bounds=await modal.boundingBox();assert.ok(bounds.width<=width&&bounds.x>=0);assert.equal(await modal.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
 await page.screenshot({path:dir+'/video.png',fullPage:true});await modal.getByRole('button',{name:'關閉',exact:true}).click();
},{viewport:{width,height:900}}));

test('VIDEO real synthetic media plays and transcript seek uses meeting offset',{timeout:30000,skip:!videoRuntime(path.resolve('.'))?'Optional FFmpeg runtime missing':false},t=>browserCase(t,async({page,app,dir:proof})=>{
 const startedAt=new Date(Date.now()-10000).toISOString(),quoteAt=new Date(Date.parse(startedAt)+11000).toISOString();
 const dir=app.seed('video-play',{state:'in_call',startedAt},[record('影片來源定位測試','Arthur',quoteAt)]);
 const pcm=Buffer.alloc(16000*2*20);for(let i=0;i<pcm.length/2;i++)pcm.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/16000)*2000),i*2);
 fs.writeFileSync(path.join(dir,'audio.wav'),Buffer.concat([createWavHeader({sampleRate:16000,channels:1,bitsPerSample:16,dataBytes:pcm.length}),pcm]));
 const service=new VideoService({home:app.root,python:path.resolve('.venv-stt/Scripts/python.exe'),synthetic:true,syntheticRealtime:true,enumerate:async()=>[{id:'123',title:'SYNTHETIC',pid:0}],segmentSeconds:2,maxSeconds:3});t.after(()=>service.shutdown());
 await service.start({id:'video-play',dir,windowId:'123'});await service.current.finished;writeStatus(dir,{state:'done'});const merged=await service.finalize(dir);assert.equal(merged.audioState,'embedded',merged.error);
 await page.goto(app.url+'/?id=video-play&secondary=none');await page.getByRole('region',{name:'會議逐字稿'}).getByText('影片來源定位測試',{exact:true}).waitFor();
 await page.getByLabel('會議更多操作',{exact:true}).click();await page.getByRole('button',{name:'會議影片／錄影',exact:true}).click();const modal=page.getByRole('dialog',{name:'會議影片／錄影',exact:true});await modal.getByText(/影片已合併本場錄音/).waitFor();
 await page.waitForFunction(()=>document.getElementById('meeting-video').readyState>=1);const metrics=await page.getByLabel('會議影片播放器',{exact:true}).evaluate(video=>({duration:video.duration,width:video.videoWidth,height:video.videoHeight}));assert.ok(metrics.duration>2&&metrics.width>0&&metrics.height>0);
 await modal.getByRole('button',{name:'關閉',exact:true}).click();await page.getByRole('button',{name:'從此處播放 00:11',exact:true}).click();await modal.waitFor();
 const target=11-merged.offsetSeconds;await page.waitForFunction(target=>Math.abs(document.getElementById('meeting-video').currentTime-target)<.25,target);
 await page.getByLabel('會議影片播放器',{exact:true}).evaluate(video=>video.play());await page.waitForFunction(()=>!document.getElementById('meeting-video').paused&&document.getElementById('meeting-audio').paused);
 await page.screenshot({path:proof+'/real-synthetic-video.png',fullPage:true});
}));
