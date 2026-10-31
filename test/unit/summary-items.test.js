import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {summaryItems,setSummarySource} from '../../src/summary-items.js';
import {saveMailDraft,readMailDraft} from '../../src/mail-draft.js';

const markdown='# Demo\n\n## 決議\n1. Keep originals\n1. Keep originals\n\n## 行動方案\n| 事項 | 負責人 | 期限 |\n| --- | --- | --- |\n| Review | 未指定 | 未指定 |\n\n## Other\nNot selectable';
const records=[{text:'Keep originals.',speaker:'Demo',t0:'2026-10-31T00:00:02Z'},{text:'Review it.',speaker:'Demo'}];
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duck-evidence-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.writeFileSync(path.join(dir,'summary.md'),markdown);fs.writeFileSync(path.join(dir,'status.json'),JSON.stringify({id:'demo',state:'done'}));return dir;}
function bind(dir,current,index=0,recordIndex=0){const record=records[recordIndex];return setSummarySource(dir,markdown,records,{revision:current.revision,evidenceRevision:current.evidenceRevision,itemId:current.items[index].id,recordIndex,recordText:record.text,recordTime:record.t0??null,recordSpeaker:record.speaker??null});}
test('sources preserve exact quote/time independently for duplicate items, with unknown times left null',t=>{
 const dir=fixture(t),initial=summaryItems(dir,markdown,records);assert.equal(initial.items.length,3);assert.notEqual(initial.items[0].id,initial.items[1].id);assert.equal(initial.items[0].source.linked,false);assert.match(initial.items[2].details,/未指定/);
 const saved=bind(dir,initial);assert.deepEqual(saved.items[0].source,{text:records[0].text,time:records[0].t0,speaker:'Demo',linked:true});assert.equal(saved.items[1].source.linked,false);
 const missing=bind(dir,saved,2,1);assert.equal(missing.items[2].source.time,null);assert.equal(summaryItems(dir,markdown,records).items[2].source.linked,true);
 const changed=summaryItems(dir,markdown,[{...records[0],text:'Changed'},records[1]]);assert.equal(changed.items[0].source.linked,false);assert.equal(changed.items[0].source.previous.text,records[0].text);
 const removed=summaryItems(dir,markdown,[]);assert.equal(removed.items[0].source.reason,'source_changed');
 assert.equal(fs.readFileSync(path.join(dir,'summary.md'),'utf8'),markdown);
 const unlinked=setSummarySource(dir,markdown,records,{revision:missing.revision,evidenceRevision:missing.evidenceRevision,itemId:missing.items[0].id,recordIndex:null});assert.equal(unlinked.items[0].source.linked,false);
});
test('evidence refuses stale summary, concurrent edits, changed transcript and fabricated records',t=>{
 const dir=fixture(t),initial=summaryItems(dir,markdown,records);bind(dir,initial);
 assert.throws(()=>bind(dir,initial),/evidence_conflict/);
 const current=summaryItems(dir,markdown,records),input={revision:current.revision,evidenceRevision:current.evidenceRevision,itemId:current.items[0].id,recordIndex:0,recordText:'invented',recordTime:records[0].t0,recordSpeaker:'Demo'};
 assert.throws(()=>setSummarySource(dir,markdown,records,input),/evidence_source_changed/);
 assert.throws(()=>setSummarySource(dir,markdown+'changed',records,input),/evidence_conflict/);
 assert.throws(()=>setSummarySource(dir,markdown,records,{...input,recordIndex:-1}),/evidence_record_missing/);
 assert.throws(()=>setSummarySource(dir,markdown,records,{...input,itemId:'missing'}),/evidence_item_missing/);
 assert.equal(summaryItems(dir,markdown.replace('Keep originals','Revised'),records).items[0].source.linked,false);
});
test('mail selections persist including empty selection, reject duplicates and stale/unknown IDs, preserve manual text',t=>{
 const dir=fixture(t),items=summaryItems(dir,markdown).items;assert.deepEqual(summaryItems(dir,'\n'+markdown+'\n').items.map(item=>item.id),items.map(item=>item.id));
 const input=()=>{const current=readMailDraft(dir);return {to:[],subject:'Demo mail',body:'Manually edited original body',expectedRevision:current.revision,sourceRevision:current.sourceRevision};};
 let saved=saveMailDraft(dir,{...input(),selectedItemIds:[items[0].id,items[2].id]});assert.deepEqual(saved.draft.selectedItemIds,[items[0].id,items[2].id]);assert.equal(saved.draft.body,'Manually edited original body');
 saved=saveMailDraft(dir,{...input(),selectedItemIds:[]});assert.deepEqual(saved.draft.selectedItemIds,[]);
 for(const ids of [[items[0].id,items[0].id],['f'.repeat(64)],['bad']])assert.throws(()=>saveMailDraft(dir,{...input(),selectedItemIds:ids}),/mail_invalid_selection/);
 fs.appendFileSync(path.join(dir,'summary.md'),'\nchanged');assert.equal(readMailDraft(dir).stale,true);
 assert.equal(readMailDraft(dir).draft.body,'Manually edited original body');
});
test('explicit Agent source columns resolve only exact original quote/time and can be manually unlinked',t=>{
 const dir=fixture(t),md='## Decisions\n| Decision | Source quote | Source time |\n| --- | --- | --- |\n| Keep | Keep originals. | 2026-10-31T00:00:02Z |\n| Unknown | Review it. | 時間未知 |';
 const parsed=summaryItems(dir,md,records);assert.equal(parsed.items[0].source.linked,true);assert.equal(parsed.items[0].source.time,records[0].t0);assert.equal(parsed.items[1].source.linked,true);assert.equal(parsed.items[1].source.time,null);
 assert.equal(summaryItems(dir,md.replace('2026-10-31T00:00:02Z','2026-10-31T00:00:03Z'),records).items[0].source.linked,false);
 assert.equal(summaryItems(dir,md,[records[0],records[0],records[1]]).items[0].source.linked,false);
 assert.equal(parsed.items[0].details,'Decision: Keep');
 const unlinked=setSummarySource(dir,md,records,{itemId:parsed.items[0].id,revision:parsed.revision,evidenceRevision:parsed.evidenceRevision,recordIndex:null});assert.equal(unlinked.items[0].source.linked,false);
 assert.equal(summaryItems(dir,'## Discussion\n- **最終決議**：Keep originals',records).items[0].kind,'decision');
});
