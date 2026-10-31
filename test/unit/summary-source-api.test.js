import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startLiveServer,buildAiPromptPackage} from '../../src/live-server.js';

test('source API requires same origin, exact meeting, current revisions and original record',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'duck-source-api-')),id='demo',dir=path.join(root,id);fs.mkdirSync(dir);
 fs.writeFileSync(path.join(dir,'status.json'),JSON.stringify({id,state:'done'}));fs.writeFileSync(path.join(dir,'summary.md'),'## Decisions\n1. Demo');
 const record={text:'Original demo',speaker:'Demo',t0:'2026-10-31T00:00:01Z'};fs.writeFileSync(path.join(dir,'transcript.jsonl'),JSON.stringify(record)+'\n');
 const running=await startLiveServer({meetingsDir:root,port:0});t.after(async()=>{await running.shutdown();fs.rmSync(root,{recursive:true,force:true});});
 const read=async()=>fetch(running.url+'/api/transcript?id='+id).then(response=>response.json());
 const current=await read(),payload={id,itemId:current.noteItems.items[0].id,revision:current.noteItems.revision,evidenceRevision:current.noteItems.evidenceRevision,recordIndex:0,recordText:record.text,recordTime:record.t0,recordSpeaker:record.speaker};
 const post=(input=payload,origin=running.url)=>fetch(running.url+'/api/summary-source',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)});
 assert.equal((await post(payload,'http://other.test')).status,403);assert.equal((await post({...payload,id:'latest'})).status,400);assert.equal((await post({...payload,id:'../outside'})).status,404);
 assert.equal((await post({...payload,recordText:'invented'})).status,409);assert.equal(fs.existsSync(path.join(dir,'summary-evidence.json')),false);
 let response=await post();assert.equal(response.status,200);assert.equal((await response.json()).noteItems.items[0].source.linked,true);
 assert.equal((await post()).status,409);assert.equal((await read()).noteItems.items[0].source.text,record.text);
});
test('Agent prompt includes bounded valid original source index and refuses inferred source metadata',()=>{
 const record={text:'Original words',speaker:'Demo',t0:'2026-10-31T00:00:01Z'},prompt=buildAiPromptPackage({id:'demo'},'Transcript','',[record]);
 assert.match(prompt.systemPrompt,/來源原文/);assert.match(prompt.systemPrompt,/不得推測/);assert.match(prompt.userPrompt,/2026-10-31T00:00:01Z/);assert.match(prompt.userPrompt,/Original words/);
 const large=buildAiPromptPackage({},'Transcript','',Array.from({length:1000},()=>({...record,text:'x'.repeat(1000)}))).userPrompt;
 const json=large.slice(large.lastIndexOf('\n')+1);assert.ok(JSON.parse(json).length<1000);assert.ok(json.length<61000);
});
