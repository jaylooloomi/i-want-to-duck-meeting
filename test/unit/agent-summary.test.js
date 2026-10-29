import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {writeStatus,readStatus} from '../../src/status.js';
import {requestAgentSummary,followAgentMeeting,enqueueFinishedAgentMeeting,pendingAgentMeetings,completeAgentSummary} from '../../src/agent-summary.js';
import {triggerMeetingSummary,getMeetingSummaryState} from '../../src/live-server.js';

function fixture(run){const home=fs.mkdtempSync(path.join(os.tmpdir(),'agent-summary-')),dir=path.join(home,'20261030-test');fs.mkdirSync(dir);writeStatus(dir,{id:'20261030-test',state:'done',stats:{utterances:1}});try{return run(dir,home);}finally{fs.rmSync(home,{recursive:true,force:true});}}
test('finished meeting queues one persistent request for its owning chat only',()=>fixture((dir,home)=>{
  followAgentMeeting(dir,'chat-a');const first=requestAgentSummary(dir);const again=enqueueFinishedAgentMeeting(dir);
  assert.equal(first.requestedAt,again.requestedAt);assert.equal(first.state,'waiting_agent');
  assert.equal(pendingAgentMeetings(home,'chat-a').length,1);assert.deepEqual(pendingAgentMeetings(home,'chat-b'),[]);
  assert.equal(getMeetingSummaryState(dir,readStatus(dir)).state,'waiting_agent');
}));
test('in-call meeting cannot be summarized early; untracked historical meeting is not queued',()=>fixture(dir=>{
  assert.equal(enqueueFinishedAgentMeeting(dir),null);
  writeStatus(dir,{state:'in_call'});followAgentMeeting(dir,'chat-a');assert.equal(readStatus(dir).summaryJob,undefined);
  assert.throws(()=>requestAgentSummary(dir),/meeting_not_finished/);
}));
test('summary endpoint queues agent work without network calls, generated notes or fake progress',()=>fixture(dir=>{
  const original=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw Error('No backend model allowed');};
  try{const state=triggerMeetingSummary(dir,readStatus(dir),[{text:'test'}]);assert.equal(state.state,'waiting_agent');assert.equal(state.progress,0);assert.equal(calls,0);assert.equal(fs.existsSync(path.join(dir,'summary.md')),false);}finally{globalThis.fetch=original;}
}));
test('forced regeneration preserves old notes and requires actually updated content before ready',()=>fixture(dir=>{
  fs.writeFileSync(path.join(dir,'summary.md'),'old notes');requestAgentSummary(dir,{force:true});
  assert.equal(fs.readFileSync(path.join(dir,'summary.pre-agent.md'),'utf8'),'old notes');
  assert.throws(()=>completeAgentSummary(dir),/not_updated/);
  fs.writeFileSync(path.join(dir,'summary.md'),'Agent reviewed transcript notes');completeAgentSummary(dir);
  assert.equal(getMeetingSummaryState(dir,readStatus(dir)).state,'ready');assert.equal(readStatus(dir).summaryJob.provider,'agent');
  writeStatus(dir,{summaryJob:{state:'failed',provider:'agent',error:'重整失敗'}});
  assert.equal(getMeetingSummaryState(dir,readStatus(dir)).state,'failed');
}));
test('missing notes cannot be marked ready and legacy generating state does not show pretend progress',()=>fixture(dir=>{
  assert.throws(()=>completeAgentSummary(dir),/summary_missing/);
  writeStatus(dir,{summaryJob:{state:'generating',progress:86}});assert.equal(getMeetingSummaryState(dir,readStatus(dir)).state,'waiting_agent');
}));
