import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {browserCase,record,defer} from './harness.js';

test('LIVE-TRANSLATE draft is translated before finalization and final text replaces it',{timeout:25000},t=>browserCase(t,async({page,app,dir:proofDir})=>{
 const startedAt=new Date().toISOString(),dir=app.seed('draft-translation',{state:'in_call',joinedAt:startedAt},[]);
 const draft=text=>fs.writeFileSync(path.join(dir,'live.json'),JSON.stringify({pending:[{...record(text,'講者',startedAt),t1:new Date().toISOString(),source:'captions'}]}));
 const gate=defer(),requests=[];let firstResolve;const first=new Promise(resolve=>firstResolve=resolve);
 draft('這是即時測試');
 await page.route('**/api/translate',async route=>{const body=route.request().postDataJSON();requests.push(body);if(requests.length===1){firstResolve();await gate.promise;}await route.fulfill({json:{translations:body.texts.map(text=>text.includes('完整')?'Final translation 1357.':text.includes('最新')?'Latest live translation.':'Initial draft translation.')}});});
 await page.goto(app.url+'/?id=draft-translation&secondary=en');await first;
 draft('這是最新的即時測試');gate.resolve();
 await page.getByText('Latest live translation.',{exact:true}).waitFor();
 await page.getByText('暫譯 · 持續更新',{exact:true}).waitFor();
 await page.screenshot({path:path.join(proofDir,'live-before-finalization.png'),fullPage:true});
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'status.json'))).state,'in_call');
 assert.equal(fs.readFileSync(path.join(dir,'transcript.jsonl'),'utf8'),'');
 app.seed('draft-translation',{state:'done'},[{...record('這是完整測試1357','講者',startedAt),source:'captions'}]);
 await page.getByText('Final translation 1357.',{exact:true}).waitFor();
 assert.equal(await page.getByText('暫譯 · 持續更新',{exact:true}).count(),0);
 assert.ok(requests.some(r=>r.texts.includes('這是最新的即時測試')));
}));

test('LIVE-TRANSLATE switching translation off discards late UI responses',{timeout:20000},t=>browserCase(t,async({page,app})=>{
 const dir=app.seed('late-draft',{state:'in_call'},[]);fs.writeFileSync(path.join(dir,'live.json'),JSON.stringify({pending:[{...record('尚未完成的字幕'),t1:new Date().toISOString()}]}));
 const gate=defer();let reached;const requested=new Promise(resolve=>reached=resolve);
 await page.route('**/api/translate',async route=>{reached();await gate.promise;await route.fulfill({json:{translations:['Do not display late translation.']}});});
 await page.goto(app.url+'/?id=late-draft&secondary=en');await requested;
 await page.getByRole('combobox',{name:'翻譯語言',exact:true}).selectOption('none');
 const response=page.waitForResponse(r=>r.url().endsWith('/api/translate'));gate.resolve();await(await response).finished();
 await page.getByText('尚未完成的字幕',{exact:true}).waitFor();
 assert.equal(await page.getByText('Do not display late translation.',{exact:true}).count(),0);
}));

test('LIVE-TRANSLATE batched results keep the transcript position and focused controls stable',{timeout:25000},t=>browserCase(t,async({page,app})=>{
 const records=Array.from({length:9},(_,i)=>record('測試字幕 '+(i+1),'測試講者',new Date(Date.UTC(2026,10,4,0,0,i)).toISOString()));
 app.seed('translation-batches',{state:'done'},records);
 const batches=Array.from({length:3},()=>({requested:defer(),release:defer()}));
 let calls=0;
 await page.route('**/api/translate',async route=>{
  const batch=batches[calls++];
  const {texts}=route.request().postDataJSON();
  if(batch){batch.requested.resolve();await batch.release.promise;}
  await route.fulfill({json:{translations:texts.map(text=>'Translation '+text.split(' ').at(-1))}});
 });
 await page.addInitScript(()=>localStorage.setItem('duck-meeting:theme','dark'));
 await page.goto(app.url+'/?id=translation-batches&primary=all&secondary=none');
 const transcript=page.getByRole('region',{name:'會議逐字稿',exact:true});
 const language=page.getByRole('combobox',{name:'翻譯語言',exact:true});
 await transcript.getByText(records[0].text,{exact:true}).waitFor();
 await language.selectOption('en');
 const star=transcript.getByRole('button',{name:'標記整段重點：測試字幕 1',exact:true});
 const status=page.getByText('翻譯中…',{exact:true});
 try{
  await status.waitFor();
  const before=await transcript.boundingBox();
  await star.focus();
  const original=await star.elementHandle();
  for(const [index,number] of [9,5,1].entries()){
   await batches[index].requested.promise;
   await status.waitFor();
   batches[index].release.resolve();
   await transcript.getByText('Translation '+number,{exact:true}).waitFor();
   assert.ok(await original.evaluate(node=>node.isConnected&&node===document.activeElement),'Translation replaced or blurred the original control');
   assert.equal((await transcript.boundingBox()).y,before.y,'Translation moved the whole transcript panel');
  }
  await status.waitFor({state:'hidden'});
  assert.equal((await transcript.boundingBox()).y,before.y,'Completion moved the whole transcript panel');
  assert.equal(calls,3);
 }finally{
  for(const batch of batches)batch.release.resolve();
 }
}));
