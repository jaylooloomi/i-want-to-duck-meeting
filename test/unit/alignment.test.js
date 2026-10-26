import {test} from 'node:test';
import assert from 'node:assert/strict';
import {alignParagraphs,importantDifferences,similarity,splitUnits} from '../../src/transcript/alignment.js';

const seg = (text,start = 0) => ({text,start,end:start + 5});
test('alignment handles split captions, preserves order and does not align unrelated text',()=>{
  const rows = alignParagraphs([{text:'需求確認。今天發布。完全不同的事情。'}],[seg('需求確認今天發布'),seg('風景很好')]);
  assert.ok(rows.some(x=>x.captions.length===2 && x.recording.length===1));
  assert.ok(rows.some(x=>x.status==='captions-only'));
  assert.ok(rows.some(x=>x.status==='recording-only'));
  assert.equal(rows.flatMap(x=>x.captions).map(x=>x.text).join(''),'需求確認。今天發布。完全不同的事情。');
});
test('alignment supports one caption unit to two recording units and repeated utterances',()=>{
  const r=alignParagraphs([{text:'今天完成版本驗收'},{text:'今天完成版本驗收'}],[seg('今天完成'),seg('版本驗收',5),seg('今天完成版本驗收',10)]);
  assert.equal(r.filter(x=>x.status==='wording-agrees').length,2);
  assert.equal(r[0].recording.length,2);
  assert.deepEqual(r.flatMap(x=>x.recording).map(x=>x.recordId),[1,2,3]);
});
test('alignment pairs three fragmented captions with one recording paragraph',()=>{
  const rows=alignParagraphs([{text:'然後1357。OK。結束並整理會議。'}],[seg('好，1357，OK，然後結束並整理會議。')]);
  assert.equal(rows.length,1); assert.equal(rows[0].captions.length,3);
  assert.ok(!importantDifferences(rows[0]).some(x=>x.type==='numbers'));
});
test('alignment preserves all text including long unpunctuated inputs and missing sources',()=>{
  const text='測'.repeat(750);
  assert.equal(splitUnits([{text}],'captions').map(x=>x.text).join(''),text);
  assert.equal(alignParagraphs([],[seg('測試')])[0].status,'recording-only');
  assert.deepEqual(alignParagraphs([],[]),[]);
});
test('critical review catches numbers negation dates proper terms and owner/decision wording',()=>{
  const row={status:'different',captionText:'Arthur同意週五完成Google Meet 1357',recordingText:'Ather不同意週六完成Google Map 13570'};
  const flags=importantDifferences(row,['Google Meet']);
  for(const type of ['numbers','negation','date-deadline','name-or-term','decision-or-owner','glossary'])assert.ok(flags.some(x=>x.type===type),type);
  assert.deepEqual(importantDifferences({...row,status:'wording-agrees'}),[]);
});
test('same number elsewhere is not agreement for the wrong aligned paragraph',()=>{
  const rows=alignParagraphs([{text:'今天金額1357。明天金額2468。'}],[seg('今天金額2468。明天金額1357。')]);
  assert.ok(rows.every(row=>row.status !== 'wording-agrees'));
  assert.ok(rows.every(row=>importantDifferences(row).some(x=>['numbers','date-deadline'].includes(x.type))));
  assert.equal(rows.flatMap(row=>row.captions).length,2);
  assert.equal(rows.flatMap(row=>row.recording).length,2);
});
test('similarity is lexical not a probability and bounds are explicit',()=>{
  assert.equal(similarity('Google Meet','google meet!'),1);
  assert.equal(similarity('',''),0); assert.equal(similarity('蘋果','架構'),0);
  assert.throws(()=>alignParagraphs(Array.from({length:1000},()=>({text:'a'})),Array.from({length:1000},()=>seg('b'))),/alignment_limit/);
});
