import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {TeamsCaptionRouter} from '../../src/teams-captions.js';
import {TranscriptStore} from '../../src/transcript/store.js';

function setup(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'om-teams-caption-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new TranscriptStore(dir);const states=[];
  return {dir,store,states,router:new TeamsCaptionRouter({dir,store,changed:s=>states.push(s)})};
}
const caption=(overrides={})=>({messageId:'utterance',speakerId:'user',speaker:'Arthur',revision:1,text:'Microsoft Teams 1357',...overrides});

test('native revisions replace old text, reject duplicates and survive reload',t=>{
  const {router,store,dir}=setup(t);
  assert.equal(router.platform(caption()),true);
  assert.equal(router.platform(caption()),false);
  router.platform(caption({revision:2,text:'我是手機端 Microsoft Teams 1357'}));
  router.platform(caption({revision:0,text:'stale'}));
  assert.equal(store.count,1);assert.equal(store.utterances[0].text,'我是手機端 Microsoft Teams 1357');
  assert.equal(new TranscriptStore(dir).count,1);
  assert.equal(fs.readFileSync(path.join(dir,'transcript-native.jsonl'),'utf8').trim().split('\n').length,2);
});
test('same text prefers platform but preserves original ASR for audio verification',t=>{
  const {router,store,dir}=setup(t);const now=new Date().toISOString();
  router.asr({t0:now,t1:now,speaker:'B',text:'Microsoft Teams 1357',source:'teams-system'});
  router.platform(caption());
  assert.equal(store.count,1);assert.equal(store.utterances[0].source,'teams-native');
  assert.match(fs.readFileSync(path.join(dir,'transcript-paraformer.jsonl'),'utf8'),/teams-system/);
});
test('native from one speaker cannot erase unmatched second speaker or old repeated speech',t=>{
  const {router,store}=setup(t);const now=new Date().toISOString();
  router.platform(caption());
  router.asr({t0:now,t1:now,speaker:'A',text:'電腦端獨立測試',source:'teams-mic'});
  router.asr({t0:'2020-01-01T00:00:00Z',t1:'2020-01-01T00:00:01Z',speaker:'B',text:'Microsoft Teams 1357',source:'teams-system'});
  assert.equal(store.count,3);
});
test('session and speaker identities isolate revision sequences; invalid events ignored',t=>{
  const {router,store}=setup(t);
  router.platform(caption());router.platform(caption({speakerId:'second'}));router.platform(caption({sessionId:'new-call'}));
  for(const value of [null,{},caption({text:''}),caption({revision:NaN}),caption({messageId:''})]) assert.equal(router.platform(value),false);
  assert.equal(store.count,3);
});
