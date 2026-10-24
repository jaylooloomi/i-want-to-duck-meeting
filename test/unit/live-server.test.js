import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startLiveServer } from '../../src/live-server.js';
import { CaptionAssembler } from '../../src/captions/assembler.js';

test('HTTP start cannot override the worker identity, filesystem destination or capture lease',async(t)=>{
  let received;
  const running=await startLiveServer({meetingsDir:os.tmpdir(),port:0,microphone:{start:async(options)=>{received=options;return {id:'test'};}}});
  t.after(()=>running.shutdown());
  const response=await fetch(running.url+'/api/microphone/start',{method:'POST',headers:{Origin:running.url,'Content-Type':'application/json'},
    body:JSON.stringify({mode:'teams',input:20,output:23,meetingId:'arbitrary',meetingDir:'C:/outside',managed:true})});
  assert.equal(response.status,200);
  assert.deepEqual(received,{mode:'teams',input:20,output:23});
});

test('live captions revise, retain separate speakers, and disappear after finalization', () => {
  const a = new CaptionAssembler();
  a.update([{ id:'a', speaker:'甲', text:'測試' }, { id:'b', speaker:'乙', text:'你好' }], 1000);
  a.update([{ id:'a', speaker:'甲', text:'測試聲音' }, { id:'b', speaker:'乙', text:'你好' }], 1200);
  assert.deepEqual(a.pending().map(({ speaker, text }) => ({ speaker, text })), [{ speaker:'甲', text:'測試聲音' }, { speaker:'乙', text:'你好' }]);
  const finalized = a.flush(2000);
  assert.equal(finalized.length, 2);
  assert.deepEqual(a.pending(), []);
});

test('HTTP viewer updates before finalization, handles partial records and ended meetings, confines access', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openmeeting-live-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const id = '20261024-142335-noq-axxy-hgb';
  const dir = path.join(root, id); fs.mkdirSync(dir);
  const status = { id, state:'in_call', url:'https://meet.google.com/noq-axxy-hgb' };
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(status));
  const { server, url } = await startLiveServer({ meetingsDir:root, port:0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const data = () => fetch(url + '/api/transcript?id=' + id).then((r) => r.json());
  assert.equal((await data()).records.length, 0);
  fs.writeFileSync(path.join(dir, 'live.json'), JSON.stringify({ pending:[{ speaker:'Arthur', text:'還沒定稿', t1:new Date().toISOString() }] }));
  assert.deepEqual((await data()).activeSpeakers, ['Arthur']);
  assert.equal((await data()).pending[0].text, '還沒定稿');
  fs.writeFileSync(path.join(dir, 'transcript.jsonl'), JSON.stringify({ speaker:'Arthur', text:'已定稿' }) + '\n{"text":');
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ ...status, state:'done' }));
  assert.equal((await data()).records[0].text, '已定稿');
  assert.deepEqual((await data()).pending, []);
  assert.deepEqual((await data()).activeSpeakers, []);
  assert.equal((await fetch(url + '/api/transcript?id=../../other')).status, 404);
  assert.equal((await fetch(url + '/api/meetings', { headers:{ Origin:'https://example.com' } })).status, 403);
  const invalidHostStatus = await new Promise((resolve, reject) => {
    http.get(url + '/', { headers:{ Host:'example.com' } }, (r) => { r.resume(); resolve(r.statusCode); }).on('error', reject);
  });
  assert.equal(invalidHostStatus, 403);
  assert.match(await (await fetch(url)).text(), /即時逐字稿/);
});
