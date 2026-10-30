import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {highlightKey,readHighlights,updateHighlight,renderHighlightsMarkdown} from '../../src/highlights.js';

test('highlights retain source snapshots, survive revisions and cancellations without changing transcript',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meeting-highlights-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const base=Date.parse('2026-10-30T01:00:00Z'),quote={text:'重要的原文',speaker:'甲',t0:new Date(base+2000).toISOString(),t1:new Date(base+4000).toISOString()};
 const data={status:{state:'in_call',joinedAt:new Date(base).toISOString()},records:[],pending:[quote]};
 let markers=updateHighlight(dir,data,{action:'mark',key:highlightKey(quote)},base+5000);assert.equal(markers[0].text,'重要的原文');assert.equal(markers[0].pending,true);assert.equal(markers[0].offsetSeconds,2);
 quote.text='後來修訂的整段原文';markers=updateHighlight(dir,data,{action:'mark',key:highlightKey(quote)},base+6000);assert.equal(markers.length,1);assert.equal(markers[0].text,'重要的原文');
 markers=updateHighlight(dir,data,{action:'mark',kind:'moment'},base+7000);assert.equal(markers.length,2);assert.equal(markers[1].offsetSeconds,7);assert.equal(markers[1].text,quote.text);
 assert.match(renderHighlightsMarkdown(markers),/不等於|並非正式決議/);
 markers=updateHighlight(dir,data,{action:'unmark',key:markers[0].key},base+8000);assert.equal(markers.length,1);assert.equal(fs.readFileSync(path.join(dir,'highlights.jsonl'),'utf8').trim().split('\n').length,3);
 assert.equal(readHighlights(dir).length,1);assert.ok(fs.existsSync(path.join(dir,'highlights.md')));
});
test('time-only markers never attribute old or absent speech',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meeting-highlights-empty-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const now=Date.now(),data={status:{state:'in_call',joinedAt:new Date(now-60000).toISOString()},records:[{text:'很久前說的話',speaker:'甲',t0:new Date(now-50000).toISOString()}],pending:[]};
 const result=updateHighlight(dir,data,{action:'mark',kind:'moment'},now);assert.equal(result[0].text,'');assert.equal(result[0].speaker,'');assert.equal(result[0].offsetSeconds,60);
 assert.throws(()=>updateHighlight(dir,{...data,status:{state:'done'}},{action:'mark',kind:'moment'},now),/進行中/);
 assert.throws(()=>updateHighlight(dir,data,{action:'mark',key:'not-a-real-utterance'},now),/字幕已更新/);
});
