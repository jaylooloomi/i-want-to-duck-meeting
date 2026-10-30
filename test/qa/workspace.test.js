import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture,browserCase,record} from './harness.js';
import {createWavHeader} from '../../src/audio/wav-writer.js';
import {audioInfo,compareSources} from '../../src/workspace-data.js';
const base='2026-10-30T01:00:00.000Z';
const at=seconds=>new Date(Date.parse(base)+seconds*1000).toISOString();
function seedWorkspace(app){
 const dir=app.seed('workspace',{state:'done',title:'產品設計週會',startedAt:base,joinedAt:base,endedAt:at(35)},[
  {...record('The budget is 1357.','Alex',at(5)),t1:at(12),source:'captions'},
  {...record('Keep the original transcript.','Mina',at(20)),t1:at(25),source:'captions'},
 ]);
 const pcm=Buffer.alloc(16000*2*35);for(let i=0;i<pcm.length;i+=2)pcm.writeInt16LE(Math.round(5000*Math.sin(i/2*2*Math.PI*440/16000)),i);
 const wav=Buffer.concat([createWavHeader({dataBytes:pcm.length}),pcm]);
 for(const name of ['audio.wav','audio-microphone.wav','audio-system.wav'])fs.writeFileSync(path.join(dir,name),wav);
 fs.writeFileSync(path.join(dir,'transcript-whisper.json'),JSON.stringify({segments:[{start:5,end:12,text:'The budget is 1537.'},{start:20,end:25,text:'Keep the original transcript.'}]}));
 fs.writeFileSync(path.join(dir,'summary.md'),'# 產品設計週會\n\n## 會議摘要\n\n保留雙語原文，提升會議紀錄可讀性。\n\n## 重要決議\n\n- 導航統一在左側。\n\n## 行動方案\n\n| 事項 | 負責人 | 期限 |\n| --- | --- | --- |\n| 驗證多語顯示 | 未指定 | 未指定 |\n');
 return {dir,wav};
}
test('WORK-API audio ranges, metadata, rename validation and active mutation protection',async t=>{
 const app=await fixture();t.after(()=>app.close());const {dir,wav}=seedWorkspace(app);
 let r=await fetch(app.url+'/api/audio?id=workspace&file=audio.wav',{headers:{Range:'bytes=44-75'}});assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),`bytes 44-75/${wav.length}`);assert.deepEqual(Buffer.from(await r.arrayBuffer()),wav.subarray(44,76));
 r=await fetch(app.url+'/api/audio?id=workspace&file=audio.wav',{headers:{Range:'bytes=-16'}});assert.equal(r.status,206);assert.equal((await r.arrayBuffer()).byteLength,16);
 for(const range of ['bytes=999999999-','bytes=20-10','invalid','bytes=1-2,4-5'])assert.equal((await fetch(app.url+'/api/audio?id=workspace',{headers:{Range:range}})).status,416);
 assert.equal((await fetch(app.url+'/api/audio?id=missing')).status,404);assert.equal((await fetch(app.url+'/api/audio?id=workspace&file=..%2Fstatus.json')).status,404);
 const data=await (await fetch(app.url+'/api/transcript?id=workspace')).json();assert.equal(data.workspace.title,'產品設計週會');assert.equal(data.workspace.audio.length,3);assert.equal(data.workspace.comparison.pairs.length,1);assert.equal(data.workspace.comparison.pairs[0].important,true);
 const post=body=>fetch(app.url+'/api/meetings/action',{method:'POST',headers:{Origin:app.url,'Content-Type':'application/json'},body:JSON.stringify(body)});
 for(const title of ['',{},'x'.repeat(101)])assert.equal((await post({id:'workspace',action:'rename',title})).status,400);
 assert.equal((await post({id:'workspace',action:'rename',title:' 新名稱 '})).status,200);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'status.json'))).title,'新名稱');
 app.seed('waiting-notes',{state:'done',summaryJob:{state:'waiting_agent',provider:'agent'}});assert.equal((await post({id:'waiting-notes',action:'archive'})).status,409);
 app.seed('active',{state:'in_call'});for(const action of ['archive','delete'])assert.equal((await post({id:'active',action})).status,409);
 assert.equal(audioInfo(dir,'audio.wav').waveform.length,64);
 assert.equal(compareSources({},[],{}).state,'unavailable');
});
for(const width of [1920,1280,390])test(`WORK-UI complete workspace interaction ${width}`,{timeout:30000},t=>browserCase(t,async({page,context,app,dir})=>{
 seedWorkspace(app);app.seed('other',{state:'done',title:'另一場討論'});
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 await page.route('**/api/translate',route=>{const data=route.request().postDataJSON();return route.fulfill({json:{translations:data.texts.map(text=>text.includes('budget')?'預算為 1357。':'保留原始逐字稿。')}});});
 await page.goto(app.url+'/?id=workspace&secondary=zh-TW');
 await page.getByRole('heading',{name:'產品設計週會',exact:true,level:1}).waitFor();
 const audio=page.getByLabel('錄音播放引擎',{exact:true});
 await audio.evaluate(el=>el.readyState>=1?Promise.resolve():new Promise(resolve=>el.addEventListener('loadedmetadata',resolve,{once:true})));
 assert.equal(await page.getByRole('img',{name:'錄音波形'}).evaluate(el=>el.childElementCount),64);
 await page.getByRole('button',{name:'播放錄音',exact:false}).click();await page.getByRole('button',{name:'暫停錄音',exact:false}).waitFor();
 await page.getByRole('button',{name:'暫停錄音',exact:false}).click();
 await page.getByRole('combobox',{name:'速度',exact:true}).selectOption('1.5');assert.equal(await audio.evaluate(el=>el.playbackRate),1.5);
 await page.getByRole('slider',{name:'音量',exact:true}).evaluate(el=>{el.value='0.4';el.dispatchEvent(new Event('input'));});assert.equal(await audio.evaluate(el=>el.volume),0.4);
 await page.getByRole('slider',{name:'錄音播放位置',exact:true}).evaluate(el=>{el.value='10';el.dispatchEvent(new Event('input'));});assert.ok(Math.abs(await audio.evaluate(el=>el.currentTime)-10)<1);
 await page.getByRole('combobox',{name:'音軌',exact:true}).selectOption('audio-system.wav');await audio.evaluate(el=>el.readyState>=1?Promise.resolve():new Promise(resolve=>el.addEventListener('loadedmetadata',resolve,{once:true})));
 await page.getByRole('button',{name:'檢視差異 →',exact:true}).click();const compare=page.getByRole('dialog',{name:'字幕與錄音轉錄核對'});await compare.waitFor();await compare.getByText('平台字幕：The budget is 1357.',{exact:true}).waitFor();await compare.getByText('錄音轉錄：The budget is 1537.',{exact:true}).waitFor();await compare.getByRole('button',{name:'跳至錄音 00:05',exact:true}).click();await audio.evaluate(el=>el.readyState>=1?Promise.resolve():new Promise(resolve=>el.addEventListener('loadedmetadata',resolve,{once:true})));assert.ok(Math.abs(await audio.evaluate(el=>el.currentTime)-5)<1);assert.match(await audio.getAttribute('src'),/file=audio.wav/);
 const notes=page.getByRole('region',{name:'會議記錄整理'});
 await page.getByRole('button',{name:'決議',exact:true}).click();await notes.getByText('導航統一在左側。',{exact:true}).waitFor();assert.equal(await notes.getByText('保留雙語原文，提升會議紀錄可讀性。',{exact:true}).count(),0);
 await page.getByRole('button',{name:'待辦',exact:true}).click();await notes.getByRole('cell',{name:'驗證多語顯示',exact:true}).waitFor();
 await page.getByRole('button',{name:'複製',exact:true}).click();assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/行動方案/);
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'下載',exact:true}).click();assert.equal((await downloaded).suggestedFilename(),'workspace-summary.md');
 const zipEvent=page.waitForEvent('download');await page.getByRole('button',{name:'匯出整場資料',exact:false}).click();const zip=await zipEvent;assert.equal(zip.suggestedFilename(),'workspace.zip');assert.equal(fs.readFileSync(await zip.path()).readUInt32LE(0),0x04034b50);
 await page.getByRole('searchbox',{name:'搜尋逐字稿',exact:true}).focus();
 await page.getByRole('searchbox',{name:'搜尋逐字稿',exact:true}).fill('Mina');await page.getByText('Keep the original transcript.',{exact:true}).waitFor();assert.equal(await page.getByText('The budget is 1357.',{exact:true}).count(),0);await page.getByRole('searchbox',{name:'搜尋逐字稿',exact:true}).fill('');
 await page.getByRole('searchbox',{name:'搜尋會議',exact:true}).fill('不存在的名稱');await page.getByText('找不到符合的會議',{exact:true}).waitFor();await page.getByRole('searchbox',{name:'搜尋會議',exact:true}).fill('');
 await page.getByRole('button',{name:'設定',exact:false}).click();const settings=page.getByRole('dialog',{name:'工作台設定'});await settings.getByRole('combobox',{name:'文字密度',exact:true}).selectOption('compact');await settings.getByRole('button',{name:'完成',exact:true}).click();
 await page.getByRole('button',{name:'說明',exact:false}).click();await page.getByRole('dialog',{name:'使用說明'}).getByRole('button',{name:'回報問題',exact:true}).click();await page.getByRole('dialog',{name:'問題回報與操作指南'}).waitFor();await page.getByRole('button',{name:'關閉視窗',exact:true}).click();
 await page.getByLabel('會議更多操作',{exact:true}).click();await page.getByRole('button',{name:'重新命名',exact:true}).click();await page.getByRole('textbox',{name:'會議名稱',exact:true}).fill('新版會議名稱');await page.getByRole('button',{name:'儲存名稱',exact:true}).click();await page.getByRole('heading',{name:'新版會議名稱',exact:true}).waitFor();
 await page.getByRole('button',{name:'摘要',exact:true}).click();
 await page.getByRole('button',{name:'設定',exact:false}).click();
 await page.getByRole('button',{name:'會議整理',exact:true}).click();assert.equal(await page.getByRole('region',{name:'會議逐字稿'}).isVisible(),false);
 await page.getByRole('button',{name:'設定',exact:false}).click();
 await page.getByRole('button',{name:'並排檢視',exact:true}).click();await page.getByRole('region',{name:'會議逐字稿'}).waitFor();
 const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(size.scroll<=size.width+1,JSON.stringify(size));
 await page.screenshot({path:path.join(dir,'workspace.png'),fullPage:true});
 await page.reload();await page.getByRole('heading',{name:'新版會議名稱',exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.dataset.density),'compact');
},{viewport:{width,height:width===390?844:1080}}));

test('WORK-UI empty evidence, multi-language originals, failed translation and clipboard fallback',{timeout:20000},t=>browserCase(t,async({page,app})=>{
 const dir=app.seed('empty-evidence',{state:'done',title:'多語顯示'},[record('こんにちは、会議です。'),record('Guten Morgen, das ist ein Test.')]);
 fs.writeFileSync(path.join(dir,'summary.md'),'# 多語紀錄\n\n## 會議摘要\n\n<script>globalThis.workspaceXss=1</script>\n');
 await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw new Error('denied');}}});});
 await page.route('**/api/translate',route=>route.fulfill({json:{translations:[]}}));
 await page.goto(app.url+'/?id=empty-evidence&secondary=de');
 await page.getByText('こんにちは、会議です。',{exact:true}).waitFor();await page.getByText('Guten Morgen, das ist ein Test.',{exact:true}).waitFor();
 await page.getByText('部分翻譯暫時無法取得，將自動重試。',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'播放錄音',exact:false}).isVisible(),false);
 assert.equal(await page.getByRole('button',{name:'檢視差異 →',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'複製',exact:true}).click();await page.getByText('無法存取剪貼簿，請使用下載會議紀錄。',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>globalThis.workspaceXss),undefined);
 await page.getByRole('combobox',{name:'翻譯語言',exact:true}).selectOption('ja');await page.getByRole('combobox',{name:'翻譯語言',exact:true}).selectOption('none');
 assert.equal(await page.getByRole('combobox',{name:'翻譯語言',exact:true}).inputValue(),'none');
}));

test('WORK-API German and Japanese translation targets reach the provider',async t=>{
 const app=await fixture();t.after(()=>app.close());const original=globalThis.fetch,targets=[];
 t.mock.method(globalThis,'fetch',async(input,options)=>{
  const url=new URL(String(input));
  if(url.hostname==='translate.googleapis.com'){targets.push(url.searchParams.get('tl'));return new Response(JSON.stringify([[['translated']]]));}
  return original(input,options);
 });
 for(const target of ['de','ja']){
  const response=await original(app.url+'/api/translate',{method:'POST',headers:{Origin:app.url,'Content-Type':'application/json'},body:JSON.stringify({texts:['Unique provider text '+target],target})});
  assert.equal(response.status,200);assert.deepEqual((await response.json()).translations,['translated']);
 }
 assert.deepEqual(targets,['de','ja']);
});


test('WORK-NOTES native Agent four-section format preserves inline decisions and action table',{timeout:15000},t=>browserCase(t,async({page,app})=>{
 const dir=app.seed('agent-format',{state:'done',title:'議題會議'},[record('核准新版流程')]);
 fs.writeFileSync(path.join(dir,'summary.md'),'## 1. 基本資訊（會議身分證）\n\n記錄人：Agent\n\n## 2. 會議內容（討論精髓）\n\n- **案由**：操作流程\n- **討論要點**：保持精簡\n- **最終決議**：\n  - 核准新版流程\n\n## 3. 行動方案（後續執行指標）\n\n| 待辦 | 負責人 | 完成時限 |\n| --- | --- | --- |\n| 實測新版流程 | 未指定 | 未指定 |\n');
 await page.goto(app.url+'/?id=agent-format');await page.getByRole('heading',{name:'議題會議',level:1,exact:true}).waitFor();
 const notes=page.getByRole('region',{name:'會議記錄整理'});
 await page.getByRole('button',{name:'決議',exact:true}).click();await notes.getByText('核准新版流程',{exact:true}).waitFor();assert.equal(await notes.getByText('保持精簡',{exact:true}).count(),0);
 await page.getByRole('button',{name:'待辦',exact:true}).click();await notes.getByRole('cell',{name:'實測新版流程',exact:true}).waitFor();
}));

test('EMERALD-REFERENCE 1280x800 geometry matches selected concept',{timeout:20000},t=>browserCase(t,async({page,app,dir})=>{
 const seeded=seedWorkspace(app);
 fs.appendFileSync(path.join(seeded.dir,'transcript.jsonl'),'\n'+[{...record('Please keep the original transcript next to the translation.','Leon Weber',at(26)),source:'captions'},{...record('Agreed. We will review the first version on Friday.','Arthur Wang',at(30)),source:'captions'}].map(JSON.stringify).join('\n'));
 fs.writeFileSync(path.join(seeded.dir,'summary.md'),'# 產品設計週會\n\n## 會議摘要\n\n- 團隊同意將會議切換統一放在左側清單，以簡化操作流程。\n- 原文與翻譯以兩層方式並列，方便核對。\n\n## 重要決議\n\n1. 會議切換統一使用左側清單。\n2. 原文與譯文以兩層方式呈現。\n\n## 行動項目\n\n| 事項 | 負責人 | 期限 |\n| --- | --- | --- |\n| 完成操作流程初稿 | Emma | 11/02 |\n| 驗證多語顯示 | Leon | 11/03 |\n');
 app.seed('other-one',{state:'done',title:'客戶需求訪談',startedAt:at(0)});app.seed('other-two',{state:'done',title:'開發進度同步',startedAt:at(0)});
 await page.route('**/api/translate',route=>{const data=route.request().postDataJSON();return route.fulfill({json:{translations:data.texts.map(text=>text.includes('Friday')?'我們週五再確認。':text.includes('next to')?'請讓原文與翻譯保持對照，方便核對。':text.includes('budget')?'預算為 1357。':'保留原始逐字稿。')}});});
 await page.goto(app.url+'/?id=workspace&primary=en&secondary=zh-TW');await page.getByText('我們週五再確認。',{exact:true}).waitFor();
 const geometry=await page.getByRole('region',{name:'會議逐字稿'}).evaluate(el=>{const r=el.parentElement.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});
 fs.writeFileSync(path.join(dir,'geometry.json'),JSON.stringify({viewport:{width:1280,height:800},transcriptPane:geometry},null,2));
 assert.ok(Math.abs(geometry.x-239)<=5,JSON.stringify(geometry));assert.ok(Math.abs(geometry.y-164)<=10,JSON.stringify(geometry));assert.ok(Math.abs(geometry.width-574)<=12,JSON.stringify(geometry));
 assert.ok(await page.getByRole('region',{name:'會議逐字稿'}).getByText('The budget is 1357.',{exact:true}).evaluate(el=>parseFloat(getComputedStyle(el).fontSize))>=13);
 await page.screenshot({path:path.join(dir,'reference-implemented.png'),fullPage:true});
},{viewport:{width:1280,height:800}}));
