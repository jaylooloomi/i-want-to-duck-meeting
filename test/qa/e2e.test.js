import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spec,record,devices,defer} from './harness.js';

spec(test,'E2E-01 live HTTP transcript update finalization and meeting selection',async({page,app,ui})=>{
  app.seed('qa-first',{url:'https://meet.google.com/abc-defg-hij'},[record('第一場發言','甲')]);
  app.seed('qa-second',{},[record('第二場發言','乙')]);
  await ui.open(app,'?id=qa-first');await ui.text('第一場發言');
  assert.equal(await page.getByRole('link',{name:'進入 Meet ↗'}).getAttribute('href'),'https://meet.google.com/abc-defg-hij');
  await ui.meeting.selectOption('qa-second');await ui.text('第二場發言');
  assert.equal(new URL(page.url()).searchParams.get('id'),'qa-second');
  await page.reload();await ui.text('第二場發言');
  app.seed('qa-second',{state:'done'},[record('最終發言','乙')]);await ui.text('最終發言');await ui.text('記錄已停止');
});
spec(test,'E2E-02 extreme transcript and missing speaker render as text',async({page,app,ui})=>{
  const payload=' <script>globalThis.qaXss=1</script> \u0000 \' OR 1=1 -- 🙂'.repeat(70);
  app.seed('qa-first',{},[record(payload,'')]);await ui.open(app);await page.getByText(payload,{exact:true}).waitFor();
  await ui.text('未知發言者');assert.equal(await page.evaluate(()=>globalThis.qaXss),undefined);
});
spec(test,'E2E-03 empty initial state and final pending removal',async({page,app,ui})=>{
  await ui.open(app);await ui.text('尚無會議');await ui.text('尚無字幕，開始發言後會自動顯示。');
  const dir=app.seed('qa-first');fs.writeFileSync(path.join(dir,'live.json'),JSON.stringify({pending:[{...record('暫存內容'),t1:new Date().toISOString()}]}));
  await ui.text('暫存內容');app.seed('qa-first',{state:'done'},[]);
  await ui.text('已結束');await ui.text('尚無字幕，開始發言後會自動顯示。');assert.equal(await page.getByText('暫存內容',{exact:true}).count(),0);
});
spec(test,'E2E-03 deleting the last meeting removes private content from the viewer',async({page,app,ui})=>{
  app.seed('qa-first',{},[record('DELETED_PRIVATE_TEXT')]);await ui.open(app);await ui.text('DELETED_PRIVATE_TEXT');
  fs.rmSync(path.join(app.root,'qa-first'),{recursive:true,force:true});await ui.text('尚無會議');
  assert.equal(await ui.transcript.getByText('DELETED_PRIVATE_TEXT',{exact:true}).count(),0);
},{});
for(const code of [400,401,403,500])spec(test,`E2E-04 poll HTTP ${code} visible error and strict console`,async({page,app,ui})=>{
  await page.route('**/api/meetings',route=>route.fulfill({status:code,json:{error:'QA injected'}}));
  await ui.open(app);await ui.text('連線中斷 · 正在重試');await ui.text('畫面可能不是最新資料');
},{bug:'BUG-004'});
spec(test,'E2E-05 unknown deep link cannot silently display latest under a stale URL',async({page,app,ui})=>{
  app.seed('qa-first',{},[record('UNRELATED_LATEST')]);await ui.open(app,'?id=missing');
  await ui.text('UNRELATED_LATEST');
  assert.equal(new URL(page.url()).searchParams.get('id'),'latest','Fallback must synchronize the URL or show a not-found state');
},{});
for(const width of [1920,390])spec(test,`E2E-06 transcript viewport ${width} semantic controls and overflow`,async({page,app,ui})=>{
  app.seed('qa-'+ 'long-meeting-'.repeat(10),{},[record('長段落'.repeat(100),'非常長的發言者姓名'.repeat(15))]);
  await ui.open(app);await ui.text('1 段發言');
  await page.getByLabel('自動捲動',{exact:true}).uncheck();await page.getByLabel('自動捲動',{exact:true}).check();
  const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
  assert.ok(size.scroll<=size.width+1,JSON.stringify(size));await ui.start.click({trial:true});
},{viewport:{width,height:width===390?844:1080}});

spec(test,'E2E-07 real browser AudioWorklet PCM to HTTP and graceful stop',async({page,app,ui})=>{
  await ui.open(app);
  const pcm=page.waitForRequest(r=>r.url().endsWith('/api/microphone/audio'));
  await ui.start.click();await pcm;await ui.text('QA adapter transcript');
  assert.ok(app.calls.audio.length>=2);assert.deepEqual(app.calls.audio.map(x=>x.sequence),app.calls.audio.map((_,i)=>i));
  await ui.stop.click();await ui.text('已停止收音，剩餘辨識在本機完成；可查看下方會議狀態。');
  assert.equal(app.calls.start.length,1);assert.equal(app.calls.stop.length,1);assert.equal(await ui.start.isEnabled(),true);
});
spec(test,'E2E-08 denied microphone never creates a backend session',async({page,app,ui})=>{
  await page.addInitScript(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Permission denied','NotAllowedError');};});
  await ui.open(app);await ui.start.click();await ui.text('無法開始收音：Permission denied');
  assert.equal(await ui.start.isEnabled(),true);assert.deepEqual(app.calls.start,[]);
});
spec(test,'E2E-09 in-flight start is disabled and stop issues one request',async({page,app,ui})=>{
  const gate=defer();await page.route('**/api/microphone/start',async route=>{await gate.promise;await route.continue();});
  await ui.open(app,'?source=teams');await page.getByRole('option',{name:'QA headphones',exact:true}).waitFor({state:'attached'});
  const sent=page.waitForRequest(r=>r.url().endsWith('/api/microphone/start'));const clicked=ui.start.click();await sent;
  try{assert.equal(await ui.start.isDisabled(),true);assert.equal(await ui.source.isDisabled(),true);}finally{gate.resolve();}
  await clicked;await ui.text('● Teams 雙路收音中 · 自己：講者 A · 遠端：講者 B 起 · 全部留在本機');
  await ui.stop.click();await ui.text('已停止收音，剩餘辨識在本機完成；可查看下方會議狀態。');assert.equal(app.calls.start.length,1);assert.equal(app.calls.stop.length,1);
});
for(const code of [400,401,403,500])spec(test,`E2E-10 start HTTP ${code} recovers controls with strict console`,async({page,app,ui})=>{
  await page.route('**/api/microphone/start',route=>route.fulfill({status:code,json:{error:'QA model unavailable'}}));
  await ui.open(app,'?source=teams');await page.getByRole('option',{name:'QA headphones',exact:true}).waitFor({state:'attached'});
  await ui.start.click();await ui.text('無法開始收音：QA model unavailable');assert.equal(await ui.start.isEnabled(),true);
},{bug:'BUG-004'});
spec(test,'E2E-10 stop failure restores start controls and reports incomplete finalization',async({page,app,ui})=>{
  await page.route('**/api/microphone/stop',route=>route.fulfill({status:500,json:{error:'QA stop failed'}}));
  await ui.open(app,'?source=teams');await page.getByRole('option',{name:'QA headphones',exact:true}).waitFor({state:'attached'});
  await ui.start.click();await ui.text('● Teams 雙路收音中 · 自己：講者 A · 遠端：講者 B 起 · 全部留在本機');
  await ui.stop.click();await ui.text('收音已停止；收尾失敗：QA stop failed');assert.equal(await ui.start.isEnabled(),true);
},{bug:'BUG-004'});
spec(test,'E2E-10 upload failure stops capture and shows the packet error',async({page,app,ui})=>{
  await page.route('**/api/microphone/audio',route=>route.fulfill({status:500,json:{error:'QA packet rejected'}}));
  await ui.open(app);await ui.start.click();await ui.text('收音已停止：QA packet rejected');
  assert.equal(await ui.start.isEnabled(),true);assert.equal(app.calls.stop.length,1);
},{bug:'BUG-004'});
spec(test,'E2E-11 pagehide sends stop beacon and reload has no active capture claim',async({page,app,ui})=>{
  await ui.open(app);const pcm=page.waitForRequest(r=>r.url().endsWith('/api/microphone/audio'));
  await ui.start.click();await pcm;
  const stopped=defer();app.server.on('request',(request,response)=>{
    if(request.url==='/api/microphone/stop')response.once('finish',()=>stopped.resolve());
  });
  await page.reload();await stopped.promise;await ui.text('尚未收音；按開始後會要求麥克風權限。');assert.equal(app.calls.stop.length,1);
});
for(const width of [1920,390])spec(test,`E2E-12 microphone controls actionable viewport ${width}`,async({page,app,ui})=>{
  await ui.open(app);await ui.start.click();await ui.text('● 正在本機收音 · 依聲音區分講者 A、B · 請告知與會者正在記錄');
  await ui.stop.click();await ui.text('已停止收音，剩餘辨識在本機完成；可查看下方會議狀態。');
  const box=await ui.start.boundingBox();assert.ok(box.x>=0 && box.x+box.width<=width);
},{viewport:{width,height:width===390?844:1080}});

spec(test,'E2E-13 Teams device IDs start heartbeat levels and stop',async({page,app,ui})=>{
  await ui.open(app,'?source=teams');await page.getByRole('option',{name:'QA headphones',exact:true}).waitFor({state:'attached'});
  await ui.start.click();await ui.text('● Teams 雙路收音中 · 自己：講者 A · 遠端：講者 B 起 · 全部留在本機');
  await page.waitForRequest(r=>r.url().endsWith('/api/microphone/heartbeat'));
  assert.deepEqual(app.calls.start,[{mode:'teams',input:11,output:22}]);
  assert.equal(await page.evaluate(()=>globalThis.qaXss),undefined);await ui.stop.click();
  await ui.text('已停止收音，剩餘辨識在本機完成；可查看下方會議狀態。');assert.equal(app.calls.stop.length,1);
});
spec(test,'E2E-14 absent Teams devices block start with a readable message',async({page,app,ui})=>{
  await page.route('**/api/audio-devices',route=>route.fulfill({json:{inputs:[],outputs:[],defaultInput:null,defaultOutput:null}}));
  const loaded=page.waitForResponse(r=>r.url().endsWith('/api/audio-devices'));
  await ui.open(app,'?source=teams');await loaded;
  await ui.text('找不到可用的 Windows 播放裝置與麥克風，請連接裝置後重新整理。');assert.equal(await ui.start.isDisabled(),true);assert.equal(app.calls.start.length,0);
});
spec(test,'E2E-15 pending Teams device request blocks unsafe start and shows loading',async({page,app,ui})=>{
  const gate=defer();await page.route('**/api/audio-devices',async route=>{await gate.promise;await route.fulfill({json:devices});});
  const request=page.waitForRequest(r=>r.url().endsWith('/api/audio-devices'));await ui.open(app,'?source=teams');await request;
  try{await ui.text('正在讀取 Windows 播放裝置與麥克風…');assert.equal(await ui.start.isDisabled(),true,'Start must be disabled until required devices are known');}
  finally{gate.resolve();}
},{});
spec(test,'E2E-16 Teams device API failure has visible feedback and zero console',async({page,app,ui})=>{
  await page.route('**/api/audio-devices',route=>route.fulfill({status:500,json:{error:'QA no device backend'}}));
  await ui.open(app,'?source=teams');await ui.text('無法列出麥克風：QA no device backend');assert.equal(await ui.start.isDisabled(),true);
},{bug:'BUG-004'});
spec(test,'E2E-17 Teams mode query survives start stop and reload',async({page,app,ui})=>{
  await ui.open(app,'?source=teams');await page.getByRole('option',{name:'QA headphones',exact:true}).waitFor({state:'attached'});
  await ui.start.click();await ui.text('● Teams 雙路收音中 · 自己：講者 A · 遠端：講者 B 起 · 全部留在本機');
  await ui.stop.click();await ui.text('已停止收音，剩餘辨識在本機完成；可查看下方會議狀態。');
  await page.reload();assert.equal(await ui.source.inputValue(),'teams');
},{});
for(const width of [1920,390])spec(test,`E2E-18 long Teams device labels viewport ${width}`,async({page,app,ui})=>{
  await page.route('**/api/audio-devices',route=>route.fulfill({json:{...devices,inputs:[{id:11,name:'Very long microphone '.repeat(20)}]}}));
  await ui.open(app,'?source=teams');await page.getByRole('option',{name:'QA headphones',exact:true}).waitFor({state:'attached'});
  await page.getByRole('combobox',{name:/^自己的麥克風/}).selectOption('11');
  await ui.start.click({trial:true});const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
  assert.ok(size.scroll<=size.width+1,JSON.stringify(size));
},{viewport:{width,height:width===390?844:1080}});
spec(test,'E2E-19 root query routes browser back forward and 404',async({page,app,ui})=>{
  app.seed('qa-first',{},[record('ROUTE_A')]);app.seed('qa-second',{},[record('ROUTE_B')]);
  await ui.open(app,'?id=qa-first');await ui.text('ROUTE_A');
  await page.goto(app.url+'/?id=qa-second');await ui.text('ROUTE_B');
  await page.goBack();await ui.text('ROUTE_A');await page.goForward();await ui.text('ROUTE_B');
  const response=await page.request.get(app.url+'/not-a-page');assert.equal(response.status(),404);
});
