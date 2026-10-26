import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {writeStatus,readStatus} from '../../src/status.js';
import {panelState,requestPanelStop} from '../../src/meeting-panel.js';
import {finishPanelRecording,writePanelResults} from '../../src/panel-finish.js';

async function fixture(run){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meeting-panel-'));try{
  writeStatus(dir,{id:'synthetic-panel',state:'done',stats:{audioSeconds:5,audioPeak:12}});
  fs.writeFileSync(path.join(dir,'transcript.jsonl'),JSON.stringify({source:'captions',speaker:'A',text:'測試1357<script>alert(1)</script>'}));
  fs.writeFileSync(path.join(dir,'transcript.md'),'測試1357<script>alert(1)</script>');
  fs.writeFileSync(path.join(dir,'audio.wav'),Buffer.alloc(44));
  await run(dir);
}finally{fs.rmSync(dir,{recursive:true,force:true});}}
test('panel state is bounded and does not report recording before admission',()=>fixture(async dir=>{
  writeStatus(dir,{state:'waiting_admission',recordingControl:{enabled:true}});assert.equal(panelState(dir).recording,false);
  writeStatus(dir,{state:'in_call'});requestPanelStop(dir);assert.ok(fs.existsSync(path.join(dir,'STOP')));assert.equal(panelState(dir).ending,true);
  writeStatus(dir,{state:'done'});assert.throws(()=>requestPanelStop(dir),/already_finished/);
}));
test('panel finishing uses local offline transcription, creates separate safe draft and leaves sources unchanged',()=>fixture(async dir=>{
  const original=fs.readFileSync(path.join(dir,'transcript.jsonl'),'utf8');
  const result=await finishPanelRecording({config:{headless:true},dir},{available:()=>true,transcribe:async options=>{
    assert.equal(options.offline,true);fs.writeFileSync(path.join(dir,'transcript-whisper.json'),JSON.stringify({segments:[{text:'測試1357',start:0,end:2}]}));
  }});
  assert.equal(result.status.state,'draft_ready');assert.ok(fs.existsSync(path.join(dir,'meeting-report.draft.md')));
  const auto=JSON.parse(fs.readFileSync(path.join(dir,'meeting-report.auto.json'),'utf8'));
  assert.equal(auto.summary[0].text,'測試1357');assert.deepEqual(auto.decisions,[]);assert.deepEqual(auto.actionItems,[]);
  assert.equal(fs.readFileSync(path.join(dir,'transcript.jsonl'),'utf8'),original);
  const html=fs.readFileSync(result.file,'utf8');assert.ok(!html.includes('<script>alert(1)</script>'));assert.match(html,/&lt;script&gt;/);
}));
test('missing ASR remains partial and failed ASR remains failed, never fakes a recording transcript',()=>fixture(async dir=>{
  await finishPanelRecording({config:{headless:true},dir},{available:()=>false});assert.equal(readStatus(dir).panelReport.state,'partial');
  assert.equal(fs.existsSync(path.join(dir,'transcript-whisper.json')),false);
  await finishPanelRecording({config:{headless:true},dir},{available:()=>true,transcribe:async()=>{throw new Error('模型不可用');}});
  assert.equal(readStatus(dir).panelReport.state,'failed');assert.ok(fs.existsSync(writePanelResults(dir)));
}));
