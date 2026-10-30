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
