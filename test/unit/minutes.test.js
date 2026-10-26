import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {compareTranscripts} from '../../src/transcript/crosscheck.js';
import {createMinutesDraft,validateMinutes,renderMinutes,writeMinutes} from '../../src/transcript/minutes.js';

const status={id:'synthetic-meeting',state:'done',joinedAt:'2026-10-26T06:00:00Z',endedAt:'2026-10-26T06:01:00Z',stats:{audioSeconds:60}};
const cc=[{speaker:'甲',text:'建議下週上線，負責人未定。',source:'captions'}];
const audio=[{text:'建議下週上線，負責人未定。',start:0,end:5}];
const evidence=[{source:'captions',recordId:1,quote:'建議下週上線'}];
const fixture=()=>compareTranscripts(cc,audio);
test('minutes draft has all fixed sections and never invents decisions/tasks or attendees',()=>{
  const doc=createMinutesDraft(status), rendered=renderMinutes(doc,status,fixture(),false);
  validateMinutes(doc,fixture(),status.id);
  for(const name of ['會議基本資料','參與者','重點摘要','各議題討論','已確認決議','提案與未決事項','待辦事項','風險與阻礙','待確認問題','下次追蹤','記錄品質與附件'])assert.ok(rendered.includes(name));
  assert.deepEqual(doc.decisions,[]);assert.deepEqual(doc.actionItems,[]);assert.deepEqual(doc.participants,[]);
  assert.match(rendered,/空欄位代表尚未整理/);
});
test('reviewed minutes preserve proposal distinction and null ownership, validate real source references',()=>{
  const doc=createMinutesDraft(status);
  doc.proposals=[{text:'提議下週上線，尚未確認',evidence}];
  doc.actionItems=[{task:'確認安排',owner:null,deadline:null,completionCriteria:null,evidence}];
  doc.participants=[{name:'甲',role:null,evidence}];
  validateMinutes(doc,fixture(),status.id);
  const md=renderMinutes(doc,status,fixture(),true);
  assert.match(md,/負責人：未指定/);assert.match(md,/captions #1/);assert.deepEqual(doc.decisions,[]);
});
test('minutes rejects missing evidence, fabricated quotes, invalid IDs, speaker inference and unknown fields',()=>{
  const variants=[
    d=>{d.summary=[{text:'憑空結論',evidence:[]}]},
    d=>{d.decisions=[{text:'通過',evidence:[{source:'captions',recordId:1,quote:'同意上線'}]}]},
    d=>{d.topics=[{text:'主題',evidence:[{source:'recording',recordId:2,quote:'建議'}]}]},
    d=>{d.participants=[{name:'甲',role:null,evidence:[{source:'recording',recordId:1,quote:'建議'}]}]},
    d=>{d.extra=true},d=>{d.meetingId='other'},d=>{d.actionItems=[{task:'測試',evidence}]},
  ];
  for(const mutate of variants){const doc=createMinutesDraft(status);mutate(doc);assert.throws(()=>validateMinutes(doc,fixture(),status.id),/invalid_minutes/);}
});
test('report files keep raw transcripts, reject active meetings, and never overwrite summary',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'minutes-'));
  try{
    fs.writeFileSync(path.join(dir,'status.json'),JSON.stringify({...status,state:'in_call'}));
    assert.throws(()=>writeMinutes(dir),/meeting_not_finished/);
    fs.writeFileSync(path.join(dir,'status.json'),JSON.stringify(status));
    fs.writeFileSync(path.join(dir,'transcript.jsonl'),cc.map(x=>JSON.stringify(x)).join('\n'));
    fs.writeFileSync(path.join(dir,'transcript-whisper.json'),JSON.stringify({segments:audio}));
    fs.writeFileSync(path.join(dir,'summary.md'),'user summary');
    const draft=writeMinutes(dir);assert.match(draft.mdPath,/draft.md$/);
    const doc=draft.doc;doc.summary=[{text:'討論上線提案',evidence}];
    const report=writeMinutes(dir,doc);assert.match(report.mdPath,/meeting-report.md$/);
    assert.equal(fs.readFileSync(path.join(dir,'summary.md'),'utf8'),'user summary');
    assert.equal(fs.readFileSync(path.join(dir,'transcript.jsonl'),'utf8'),cc.map(x=>JSON.stringify(x)).join('\n'));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
