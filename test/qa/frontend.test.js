import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spec,record,defer,devices} from './harness.js';

spec(test,'FE-01 transcript component revisions drafts state and speakers',async({page,app,ui})=>{
  const dir=app.seed('qa-first',{},[record('已定稿','甲')]);
  fs.writeFileSync(path.join(dir,'live.json'),JSON.stringify({pending:[{...record('草稿','乙'),t1:new Date().toISOString(),source:'local-audio'}]}));
  await ui.open(app);await ui.text('已定稿');await ui.text('草稿');await ui.text('語音辨識中');await ui.text('字幕活動 · 乙');
  app.seed('qa-first',{state:'done'},[record('已定稿','甲'),record('最後結果','乙')]);
  await ui.text('最後結果');await ui.text('已結束');assert.equal(await page.getByText('草稿',{exact:true}).count(),0);
},{component:'transcript'});

spec(test,'FE-02 transcript component hostile text and unsafe meeting link',async({page,app,ui})=>{
  const payload='<script>globalThis.qaXss=1</script>\' OR 1=1 -- 中文🙂'.repeat(40);
  app.seed('qa-first',{url:'javascript:alert(1)'},[record(payload,'<img src=x onerror=alert(1)>')]);
  await ui.open(app);await page.getByText(payload,{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>globalThis.qaXss),undefined);
  assert.equal(await page.getByRole('link',{name:'進入 Meet ↗'}).isVisible(),false);
},{component:'transcript'});

spec(test,'FE-03 empty list clears previously displayed private transcript',async({page,app,ui})=>{
  app.seed('qa-first',{url:'https://meet.google.com/abc-defg-hij'},[record('OLD_PRIVATE_TEXT')]);
  await ui.open(app);await ui.text('OLD_PRIVATE_TEXT');
  await page.route('**/api/meetings',route=>route.fulfill({json:[]}));
  await ui.text('尚無會議');assert.equal(await ui.transcript.getByText('OLD_PRIVATE_TEXT',{exact:true}).count(),0);
  await ui.text('0 段發言');assert.equal(await page.getByRole('link',{name:'進入 Meet ↗'}).isVisible(),false);
},{component:'transcript'});

for(const code of [400,401,403,500])spec(test,`FE-04 HTTP ${code} recovery and strict console`,async({page,app,ui})=>{
  app.seed('qa-first',{},[record('恢復後資料')]);let fault=true;
  await page.route('**/api/meetings',route=>fault?route.fulfill({status:code,json:{error:'QA injected failure'}}):route.continue());
  await ui.open(app);await ui.text('連線中斷 · 正在重試');await ui.text('畫面可能不是最新資料');
  fault=false;await ui.text('恢復後資料');
},{component:'transcript',bug:'BUG-004'});

spec(test,'FE-04 network abort recovers with visible feedback and zero console',async({page,app,ui})=>{
  app.seed('qa-first',{},[record('離線後恢復')]);let fault=true;
  await page.route('**/api/meetings',route=>fault?route.abort('timedout'):route.continue());
  await ui.open(app);await ui.text('連線中斷 · 正在重試');fault=false;await ui.text('離線後恢復');
},{component:'transcript',bug:'BUG-004'});

spec(test,'FE-05 microphone component permission denial restores controls',async({page,app,ui})=>{
  await page.addInitScript(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('QA permission denied','NotAllowedError');};});
  await ui.open(app);await ui.capture();await ui.start.click();await ui.text('無法開始收音：QA permission denied');
  assert.equal(await ui.start.isEnabled(),true);assert.equal(await ui.source.isEnabled(),true);assert.equal(app.calls.start.length,0);
},{component:'microphone'});

spec(test,'FE-06 empty Teams devices do not claim capture readiness',async({page,app,ui})=>{
  await page.route('**/api/audio-devices',route=>route.fulfill({json:{inputs:[],outputs:[],defaultInput:null,defaultOutput:null}}));
  const response=page.waitForResponse(r=>r.url().endsWith('/api/audio-devices'));
  await ui.open(app,'?source=teams');await response;
  assert.equal(await page.getByText('Windows 雙路收音已就緒；請選擇與 Teams 相同的裝置。',{exact:true}).isVisible(),false,
    'No device must not be presented as ready');
  await ui.text('找不到可用的 Windows 播放裝置與麥克風，請連接裝置後重新整理。');assert.equal(await ui.start.isDisabled(),true);assert.equal(app.calls.start.length,0);
},{component:'microphone'});

spec(test,'FE-06 malformed device response shows an error instead of throwing',async({page,app,ui})=>{
  await page.route('**/api/audio-devices',route=>route.fulfill({json:{inputs:null,outputs:'unexpected'}}));
  await ui.open(app,'?source=teams');
  await page.getByText(/^無法列出麥克風：/).waitFor({state:'visible'});
  assert.equal(await ui.start.isDisabled(),true);assert.equal(app.calls.start.length,0);
},{component:'microphone'});

spec(test,'FE-07 delayed start prevents duplicate submit and then stops',async({page,app,ui})=>{
  const gate=defer();let starts=0;
  await page.route('**/api/microphone/start',async route=>{starts++;await gate.promise;await route.continue();});
  await ui.open(app,'?source=teams');await page.getByRole('option',{name:'QA headphones',exact:true}).waitFor({state:'attached'});
  const request=page.waitForRequest(r=>r.url().endsWith('/api/microphone/start'));
  const clicked=ui.start.click();await request;
  assert.equal(await ui.start.isDisabled(),true);await ui.start.evaluate(button=>button.click());assert.equal(starts,1);
  gate.resolve();await clicked;await ui.text('● Teams 雙路收音中 · 自己：講者 A · 遠端：講者 B 起 · 全部留在本機');
  await ui.stop.click();await ui.text('記錄已保存');assert.equal(app.calls.stop.length,1);
},{component:'microphone'});

spec(test,'FE-08 outdated Teams response cannot overwrite current microphone feedback',async({page,app,ui})=>{
  const gate=defer();await page.route('**/api/audio-devices',async route=>{await gate.promise;await route.fulfill({json:devices});});
  await ui.open(app);await ui.capture();const request=page.waitForRequest(r=>r.url().endsWith('/api/audio-devices'));
  await ui.source.selectOption('teams');await request;await ui.source.selectOption('microphone');const response=page.waitForResponse(r=>r.url().endsWith('/api/audio-devices'));gate.resolve();
  await (await response).finished();await ui.text('尚未收音；按開始後會要求麥克風權限。');
  assert.equal(await page.getByText('Windows 雙路收音已就緒；請選擇與 Teams 相同的裝置。',{exact:true}).isVisible(),false);
},{component:'microphone'});
