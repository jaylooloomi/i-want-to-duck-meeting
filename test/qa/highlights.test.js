import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture,browserCase,record} from './harness.js';
import {createWavHeader} from '../../src/audio/wav-writer.js';

test('HL-API exact session, origin checks, idempotency and AI export uses only active highlights',async t=>{
 const app=await fixture();t.after(()=>app.close());const at=new Date().toISOString();const dir=app.seed('highlights',{state:'in_call',joinedAt:at},[record('重要測試 1357','講者',at)]);
 const data=await(await fetch(app.url+'/api/transcript?id=highlights')).json(),key=data.records[0].highlightKey;
 const post=(body,origin=app.url)=>fetch(app.url+'/api/highlights',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post({id:'highlights',action:'mark',key},'https://untrusted.example')).status,403);
 assert.equal((await post({id:'latest',action:'mark',key})).status,400);assert.equal((await post({id:'missing',action:'mark',key})).status,404);
 for(let i=0;i<2;i++)assert.equal((await post({id:'highlights',action:'mark',key,text:'FORGED CLIENT QUOTE'})).status,200);
 const after=await(await fetch(app.url+'/api/transcript?id=highlights')).json();assert.equal(after.highlights.length,1);assert.equal(after.highlights[0].text,'重要測試 1357');assert.equal(after.records[0].highlighted,true);
 const prompt=await(await fetch(app.url+'/api/export-prompt?id=highlights')).json();assert.match(prompt.content,/使用者標記重點/);assert.match(prompt.content,/1357/);assert.ok(!prompt.content.includes('FORGED CLIENT QUOTE'));
 assert.equal((await post({id:'highlights',action:'unmark',key})).status,200);assert.equal((await(await fetch(app.url+'/api/transcript?id=highlights')).json()).highlights.length,0);
 assert.equal(fs.readFileSync(path.join(dir,'highlights.jsonl'),'utf8').trim().split('\n').length,2);
});
for(const width of [1920,390])test(`HL-UI mark live moment, whole utterance, filter and persist ${width}`,{timeout:20000},t=>browserCase(t,async({page,app,dir:proofDir})=>{
 const now=new Date().toISOString(),dir=app.seed('live-highlights',{state:'in_call',joinedAt:now},[record('另一句一般內容','乙',new Date(Date.now()-30000).toISOString())]);
 fs.writeFileSync(path.join(dir,'live.json'),JSON.stringify({pending:[{...record('這句是重要的話語1357','甲',now),t1:new Date().toISOString(),source:'captions'}]}));
 await page.goto(app.url+'/?id=live-highlights&primary=all&secondary=none');await page.getByText('這句是重要的話語1357',{exact:true}).waitFor();
 await page.getByRole('button',{name:'★ 標記此刻重點',exact:true}).click();await page.getByRole('button',{name:'查看重點（1）',exact:true}).waitFor();
 await page.getByRole('button',{name:'標記整段重點：這句是重要的話語1357',exact:true}).click();await page.getByRole('button',{name:'查看重點（2）',exact:true}).waitFor();
 await page.getByRole('checkbox',{name:'只看重點',exact:true}).check();await page.getByRole('region',{name:'會議逐字稿'}).getByText('另一句一般內容',{exact:true}).waitFor({state:'hidden'});assert.equal(await page.getByRole('region',{name:'會議逐字稿'}).getByText('另一句一般內容',{exact:true}).isVisible(),false);
 await page.getByRole('button',{name:'查看重點（2）',exact:true}).click();const dialog=page.getByRole('dialog',{name:'使用者標記重點',exact:true});await dialog.waitFor();assert.equal(await dialog.getByText('這句是重要的話語1357',{exact:true}).count(),2);
 await dialog.getByRole('button',{name:'關閉',exact:true}).click();
 await page.screenshot({path:path.join(proofDir,'highlights.png'),fullPage:true});
 await page.reload();await page.getByRole('button',{name:'查看重點（2）',exact:true}).waitFor();
 const pcm=Buffer.alloc(32000*20);fs.writeFileSync(path.join(dir,'audio.wav'),Buffer.concat([createWavHeader({dataBytes:pcm.length}),pcm]));
 app.seed('live-highlights',{state:'done'},[record('這句是重要的話語1357','已確認甲',now)]);await page.getByText('已確認甲',{exact:true}).waitFor();
 await page.getByRole('button',{name:'取消整段重點：這句是重要的話語1357',exact:true}).click();await page.getByRole('button',{name:'查看重點（1）',exact:true}).waitFor();
 await page.getByRole('button',{name:'查看重點（1）',exact:true}).click();
 await page.getByRole('dialog',{name:'使用者標記重點'}).getByRole('button',{name:/^跳至錄音 /}).click();
 const audio=page.getByLabel('錄音播放引擎',{exact:true});await audio.evaluate(el=>el.readyState>=1?Promise.resolve():new Promise(resolve=>el.addEventListener('loadedmetadata',resolve,{once:true})));
 const marker=fs.readFileSync(path.join(dir,'highlights.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line)).find(event=>event.marker?.kind==='moment').marker;assert.ok(Math.abs(await audio.evaluate(el=>el.currentTime)-marker.offsetSeconds)<0.2);
 assert.equal(fs.readFileSync(path.join(dir,'transcript.jsonl'),'utf8').includes('這句是重要的話語1357'),true);
} ,{viewport:{width,height:width===390?844:1080}}));

for(const width of [1920,390])test(`HL-TIMELINE star position, seek, removal and reload ${width}`,{timeout:20000},t=>browserCase(t,async({page,app})=>{
 const start='2026-10-31T00:00:00.000Z',at='2026-10-31T00:00:08.000Z';
 const dir=app.seed('timeline',{state:'done',startedAt:start,joinedAt:start},[record('時間軸重點','甲',at)]);
 const pcm=Buffer.alloc(32000*20);fs.writeFileSync(path.join(dir,'audio.wav'),Buffer.concat([createWavHeader({dataBytes:pcm.length}),pcm]));
 await page.goto(app.url+'/?id=timeline&primary=all&secondary=none');
 await page.getByRole('button',{name:'標記整段重點：時間軸重點',exact:true}).click();
 const pin=page.getByRole('button',{name:'跳至錄音 00:08 · 時間軸重點',exact:true});await pin.waitFor();
 assert.equal(await pin.evaluate(el=>el.style.left),'40%');
 await pin.click();const audio=page.getByLabel('錄音播放引擎',{exact:true});
 await page.waitForFunction(()=>Math.abs(document.getElementById('meeting-audio').currentTime-8)<0.15);
 assert.ok(Math.abs(await audio.evaluate(el=>el.currentTime)-8)<0.15);
 await page.reload();await pin.waitFor();
 await page.getByRole('button',{name:'取消整段重點：時間軸重點',exact:true}).click();await pin.waitFor({state:'detached'});
 assert.equal(await pin.count(),0);
},{viewport:{width,height:width===390?844:1080}}));
