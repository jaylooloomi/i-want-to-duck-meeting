import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setupAudio,audioReady} from '../../src/setup-audio.js';
test('setup prepares the configured data root and propagates failures; ready checks never download',async(t)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'openmeeting-setup-audio-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const config={home:root,repoRoot:root};const calls=[];
  const run=async(cmd,args)=>{calls.push([cmd,args]);};
  await setupAudio(config,{run,setup:async(c,o)=>{assert.equal(c.home,root);assert.ok(o.uv);},log:()=>{},fetcher:()=>{throw Error('should use existing uv');}});
  assert.ok(calls.some(([,a])=>a.includes('pip') && a.includes(path.join(root,'stt/requirements-live.txt'))));
  assert.ok(calls.some(([,a])=>a.includes(path.join(root,'models'))));
  assert.equal(await audioReady(config,{run}),true);
  assert.equal(await audioReady(config,{run:async()=>{throw Error('missing');}}),false);
  await assert.rejects(setupAudio(config,{run,setup:async()=>{throw Error('network failed');},log:()=>{}}),/network failed/);
});
test('missing uv bootstraps from the official vendor into the data root without changing PATH',async(t)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'openmeeting-bootstrap-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const calls=[];let bootstrapped=false;
  await setupAudio({home:root,repoRoot:root},{log:()=>{},setup:async()=>{},fetcher:async(url)=>{
    assert.equal(url,'https://astral.sh/uv/install.ps1');return {ok:true,text:async()=> '# official installer test fixture'};
  },run:async(cmd,args,options)=>{
    if(args[0]==='--version' && !bootstrapped)throw Error('not found');
    calls.push([cmd,args,options]);if(cmd.endsWith('powershell.exe'))bootstrapped=true;
  }});
  const ps=calls.find(([cmd])=>cmd.endsWith('powershell.exe'));
  assert.equal(ps[2].env.UV_INSTALL_DIR,path.join(root,'tools'));assert.equal(ps[2].env.UV_NO_MODIFY_PATH,'1');
  assert.ok(calls.some(([cmd])=>cmd===path.join(root,'tools','uv.exe')));
});
