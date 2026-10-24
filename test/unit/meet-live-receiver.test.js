import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {receiveLiveTest} from '../../scripts/meet-test-receiver.js';
import {liveTestOutcome} from '../../scripts/verify-meet-live.js';

test('missing or partial content never becomes a complete remote test',()=>{
  const host={state:'completed_host_only'},receiver={state:'completed'};
  assert.equal(liveTestOutcome(host,receiver,{remoteContentMatched:false}),'partial');
  assert.equal(liveTestOutcome(host,null,{remoteContentMatched:true}),'failed');
  assert.equal(liveTestOutcome({state:'failed'},receiver,{remoteContentMatched:true}),'failed');
  assert.equal(liveTestOutcome(host,receiver,{remoteContentMatched:true}),'completed_synthetic_remote');
});
test('join failure closes receiver and preserves explicit failure artifacts',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'om-receiver-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  let closed=0;
  const result=await receiveLiveTest({context:{newPage:async()=>({addInitScript:async()=>{},close:async()=>closed++})},url:'https://meet.google.com/abc-defg-hij',dir,seconds:10},
    {join:async()=>{throw new Error('blocked');}});
  assert.equal(result.state,'failed');assert.equal(result.joined,false);assert.equal(result.audioPeak,0);
  assert.equal(closed,1);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'receiver-captions.json'),'utf8')),[]);
});
test('artifact write failure still closes the owned receiver page',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'om-receiver-write-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  let closed=0;
  await assert.rejects(receiveLiveTest({context:{newPage:async()=>({addInitScript:async()=>{},close:async()=>closed++})},
    url:'https://meet.google.com/abc-defg-hij',dir,seconds:10},{join:async()=>{
      fs.rmSync(dir,{recursive:true,force:true});throw new Error('blocked');
    }}));
  assert.equal(closed,1);
});
