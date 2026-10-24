import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseLiveHostArgs,runLiveHost} from '../../scripts/verify-meet-live-host.js';

test('real-service test requires opt-in, rejects unbounded duration and arbitrary audio',()=>{
  assert.throws(()=>parseLiveHostArgs([]));
  for(const value of ['0','999','NaN',''])assert.throws(()=>parseLiveHostArgs(['--live','--seconds',value]));
  assert.throws(()=>parseLiveHostArgs(['--live','--audio','private.wav']));
  assert.equal(parseLiveHostArgs(['--live','--seconds','10']).seconds,10);
});

test('cancellation during connection cannot proceed into a meeting or leak browser ownership',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'om-host-cancel-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  let closed=0,pages=0;
  const result=await runLiveHost({live:true,seconds:10,dir:path.join(root,'run'),config:{repoRoot:root,profileDir:root}}, {
    generate:async file=>fs.writeFileSync(file,'synthetic'),
    launch:async()=>({cdpUrl:'test',close:async()=>closed++}),
    connect:async()=>{process.emit('SIGTERM');return {browser:{close:async()=>closed++},context:{newPage:async()=>pages++}};},
  });
  assert.equal(result.state,'cancelled');assert.equal(result.remoteContentMatched,false);
  assert.equal(pages,0);assert.equal(closed,2);
});

test('failed navigation closes both browser owners and never reports remote success',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'om-live-host-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  let chromeClosed=0,browserClosed=0;
  const result=await runLiveHost({live:true,seconds:10,dir:path.join(root,'run'),config:{repoRoot:root,profileDir:path.join(root,'profile')}}, {
    generate:async file=>fs.writeFileSync(file,'synthetic fixture'),
    launch:async options=>{assert.ok(options.extraArgs.some(x=>x.startsWith('--use-file-for-fake-audio-capture=')));return {cdpUrl:'test',close:async()=>chromeClosed++};},
    connect:async()=>({browser:{close:async()=>browserClosed++},context:{grantPermissions:async()=>{},newPage:async()=>({goto:async()=>{throw new Error('navigation failed');}})}}),
  });
  assert.equal(result.state,'failed');assert.equal(result.remoteContentMatched,false);
  assert.equal(chromeClosed,1);assert.equal(browserClosed,1);
  const saved=JSON.parse(fs.readFileSync(path.join(root,'run','host-result.json'),'utf8'));
  assert.equal(saved.error,'navigation failed');assert.equal(saved.validationScope,'host-only');
});
