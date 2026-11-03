import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {browserCase,record,defer} from './harness.js';

for(const width of [1920,390])test(`FOLLOW pauses for reading, anchors updates and resumes explicitly ${width}`,{timeout:25000},t=>browserCase(t,async({page,app})=>{
 const rows=Array.from({length:70},(_,i)=>record(`第 ${i} 段持續開會的逐字稿，保留閱讀位置。`,'甲',new Date(Date.UTC(2026,0,1,0,0,i)).toISOString()));
 const folder=app.seed('smart-follow',{state:'in_call'},rows);
 await page.goto(app.url+'/?id=smart-follow&secondary=none');
 await page.waitForFunction(()=>{const el=document.getElementById('transcript');return el.children.length===70&&el.scrollHeight-el.clientHeight-el.scrollTop<2;});
 const transcript=page.getByRole('region',{name:'會議逐字稿',exact:true});
 await transcript.evaluate(el=>el.scrollTop=el.scrollHeight*.4);
 await page.waitForFunction(()=>followPaused);
 const anchor=await transcript.evaluate(el=>{const top=el.getBoundingClientRect().top,node=[...el.children].find(node=>node.getBoundingClientRect().bottom>top);return {key:node.dataset.sourceRecord,offset:node.getBoundingClientRect().top-top};});
 // Expand an earlier paragraph: preserving only scrollTop would lose the visible passage.
 rows[0]={...rows[0],text:'變長的早期字幕。'.repeat(90)};
 rows.push(record('最新發言一','乙','2026-01-01T00:02:00Z'));
 app.seed('smart-follow',{state:'in_call'},rows);
 const latest=page.getByRole('button',{name:'↓ 有新發言・返回最新',exact:true});await latest.waitFor();
 await page.getByText('最新發言一',{exact:true}).waitFor({state:'attached'});
 const offset=await transcript.evaluate((el,key)=>[...el.children].find(node=>node.dataset.sourceRecord===key).getBoundingClientRect().top-el.getBoundingClientRect().top,anchor.key);
 assert.ok(Math.abs(offset-anchor.offset)<=2,JSON.stringify({offset,anchor}));
 // An updating pending caption must not force a jump either.
 fs.writeFileSync(path.join(folder,'live.json'),JSON.stringify({pending:[record('即時字幕仍在更新','丙','2026-01-01T00:02:01Z')]}));
 await page.getByText('即時字幕仍在更新',{exact:true}).waitFor({state:'attached'});
 assert.ok(await transcript.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)>100);
 await latest.click();await page.waitForFunction(()=>{const el=document.getElementById('transcript');return el.scrollHeight-el.clientHeight-el.scrollTop<2;});
 assert.equal(await latest.isVisible(),false);
 rows.push(record('最新發言二','乙','2026-01-01T00:02:02Z'));app.seed('smart-follow',{state:'in_call'},rows);
 await page.getByText('最新發言二',{exact:true}).waitFor({state:'attached'});
 await page.waitForFunction(()=>{const el=document.getElementById('transcript');return el.scrollHeight-el.clientHeight-el.scrollTop<2;});
 // A second upward read can resume by manually scrolling to the bottom.
 await transcript.evaluate(el=>el.scrollTop=0);await page.waitForFunction(()=>followPaused);
 await transcript.evaluate(el=>el.scrollTop=el.scrollHeight);await page.waitForFunction(()=>!followPaused);
 assert.equal(await latest.isVisible(),false);
 await page.getByRole('searchbox',{name:'搜尋逐字稿',exact:true}).fill('持續開會');
 await page.waitForFunction(()=>followPaused);
 rows.push(record('最新發言三','乙','2026-01-01T00:02:03Z'));app.seed('smart-follow',{state:'in_call'},rows);
 await latest.waitFor();assert.equal(await page.getByRole('searchbox',{name:'搜尋逐字稿',exact:true}).inputValue(),'持續開會');
 await latest.click();await page.getByText('最新發言三',{exact:true}).waitFor();
 assert.equal(await page.getByRole('searchbox',{name:'搜尋逐字稿',exact:true}).inputValue(),'');
 app.seed('smart-follow',{state:'done'},rows);await page.waitForFunction(()=>currentRecord?.status?.state==='done');assert.equal(await latest.isVisible(),false);
}));

test('FOLLOW preserves the visible source paragraph when delayed translations change height',{timeout:20000},t=>browserCase(t,async({page,app})=>{
 const rows=Array.from({length:10},(_,i)=>record(`段落 ${i}：`+'會議討論內容。'.repeat(120),'甲',new Date(Date.UTC(2026,0,1,0,0,i)).toISOString()));
 app.seed('translation-anchor',{state:'in_call'},rows);
 const gate=defer(),requested=defer();
 await page.route('**/api/translate',async route=>{requested.resolve();await gate.promise;const body=route.request().postDataJSON();await route.fulfill({json:{translations:body.texts.map(text=>'Translation '+text.slice(0,4)+' '+('translated discussion. '.repeat(35)))}});});
 await page.goto(app.url+'/?id=translation-anchor&primary=all&secondary=en');await requested.promise;
 const transcript=page.getByRole('region',{name:'會議逐字稿',exact:true});
 await transcript.evaluate(el=>{const node=el.children[7];el.scrollTop+=node.getBoundingClientRect().top-el.getBoundingClientRect().top+20;});await page.waitForFunction(()=>followPaused);
 const anchor=await transcript.evaluate(el=>{const node=el.children[7];return {key:node.dataset.sourceRecord,offset:node.getBoundingClientRect().top-el.getBoundingClientRect().top};});
 gate.resolve();await page.getByText(/^Translation 段落 7/).waitFor({state:'attached'});
 const offset=await transcript.evaluate((el,key)=>[...el.children].find(node=>node.dataset.sourceRecord===key).getBoundingClientRect().top-el.getBoundingClientRect().top,anchor.key);
 assert.ok(Math.abs(offset-anchor.offset)<=2,JSON.stringify({offset,anchor}));
}));
