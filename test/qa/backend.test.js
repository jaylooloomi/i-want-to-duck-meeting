import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fixture,record,runRoot} from './harness.js';
import {startLiveServer,readLiveMeeting} from '../../src/live-server.js';
import {MicrophoneService} from '../../src/microphone.js';

const post=(app,route,body,headers={})=>fetch(app.url+route,{method:'POST',headers:{Origin:app.url,'Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
async function api(t){const app=await fixture();t.after(()=>app.close());return app;}

test('BE-01 assets MIME security headers methods and 404',async t=>{
  const app=await api(t);
  for(const [url,mime] of [['/','text/html'],['/app.js','text/javascript'],['/microphone.js','text/javascript'],['/pcm-worklet.js','text/javascript'],['/style.css','text/css']]) {
    const r=await fetch(app.url+url);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),new RegExp(mime));
    assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');
    assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.ok((await r.text()).length>30);
  }
  assert.equal((await fetch(app.url+'/unknown')).status,404);
  assert.equal((await post(app,'/api/meetings',{})).status,405);
});
test('BE-02 hostile Origin Host and missing Origin cannot mutate capture',async t=>{
  const app=await api(t);
  assert.equal((await post(app,'/api/microphone/start',{}, {Origin:'https://evil.example'})).status,403);
  assert.equal((await fetch(app.url+'/api/microphone/start',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(app.url+'/api/meetings',{headers:{Origin:'null'}})).status,403);
  const status=await new Promise((resolve,reject)=>http.get(app.url,{headers:{Host:'evil.example'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject));
  assert.equal(status,403);assert.deepEqual(app.calls.start,[]);
});
test('BE-03 empty list and public list excludes sensitive status fields',async t=>{
  const app=await api(t);assert.deepEqual(await (await fetch(app.url+'/api/meetings')).json(),[]);
  app.seed('qa-first',{token:'never-public',pid:123});app.seed('qa-second',{state:'done'});
  const rows=await (await fetch(app.url+'/api/meetings')).json();assert.equal(rows.length,2);
  for(const row of rows)assert.deepEqual(Object.keys(row).sort(),['canArchive','code','endedAt','id','source','startedAt','state','title']);
  assert.ok(!JSON.stringify(rows).includes('never-public'));
});
test('BE-04 malformed partial JSON sorted transcript and terminal pending suppression',async t=>{
  const app=await api(t);const dir=app.seed('qa-first',{},[record('later','乙','2026-01-01T00:00:02Z'),record('earlier','甲')]);
  fs.appendFileSync(path.join(dir,'transcript.jsonl'),'\n{"text":');
  fs.writeFileSync(path.join(dir,'live.json'),JSON.stringify({pending:[{...record('draft'),t1:new Date().toISOString()}]}));
  let data=await (await fetch(app.url+'/api/transcript?id=qa-first')).json();
  assert.deepEqual(data.records.map(x=>x.text),['earlier','later']);assert.deepEqual(data.activeSpeakers,['QA speaker']);
  app.seed('qa-first',{state:'done'},[record('final')]);data=readLiveMeeting(app.root,'qa-first');
  assert.deepEqual(data.pending,[]);assert.deepEqual(data.activeSpeakers,[]);assert.equal(data.records[0].text,'final');
});
test('BE-05 traversal unknown IDs and extreme query never read outside meeting root',async t=>{
  const app=await api(t);app.seed();
  for(const id of ['../../outside','missing','<script>alert(1)</script>','x'.repeat(3000)]) {
    const r=await fetch(app.url+'/api/transcript?id='+encodeURIComponent(id));assert.equal(r.status,404);assert.deepEqual(await r.json(),{error:'找不到會議'});
  }
});
test('BE-06 start strips worker-owned filesystem and managed properties',async t=>{
  const app=await api(t);const r=await post(app,'/api/microphone/start',{mode:'teams',input:11,output:22,managed:true,meetingDir:'C:/outside',meetingId:'override'});
  assert.equal(r.status,200);assert.deepEqual(app.calls.start,[{mode:'teams',input:11,output:22}]);
  assert.equal((await r.json()).id,'qa-capture');
});
test('BE-07 invalid body MIME excessive size and unknown actions recover',async t=>{
  const app=await api(t);
  for(const body of ['{','null','x'.repeat(65537)])assert.equal((await post(app,'/api/microphone/start',body)).status,400);
  for(const action of ['stop','heartbeat'])for(const body of ['{','null',{}])
    assert.equal((await post(app,'/api/microphone/'+action,body)).status,400);
  assert.equal((await post(app,'/api/microphone/start',{}, {'Content-Type':'text/plain'})).status,400);
  assert.equal((await post(app,'/api/microphone/missing',{})).status,400);
  assert.equal((await fetch(app.url+'/api/meetings')).status,200);assert.deepEqual(app.calls.start,[]);
});
for(const body of ['[]','"text"','123','true'])test(`BE-07 reject non-object start body ${body}`,{

},async t=>{
  const app=await api(t);const response=await post(app,'/api/microphone/start',body);
  fs.writeFileSync(path.join(runRoot,'invalid-start-'+Buffer.from(body).toString('hex')+'.json'),
    JSON.stringify({input:body,status:response.status,response:await response.json(),startCalls:app.calls.start},null,2));
  assert.equal(response.status,400,'A scalar or array must not start capture');assert.equal(app.calls.start.length,0);
});
test('BE-08 real service rejects invalid and duplicate starts before spawning',async()=>{
  const service=new MicrophoneService({meetingsDir:'unused'});
  for(const options of [{mode:'bad'},{mode:'teams',input:'11',output:22},{mode:'teams',input:11,output:11},{mode:'teams',input:NaN,output:22}])await assert.rejects(service.start(options));
  service.current={id:'existing'};await assert.rejects(service.start({}),/已有/);assert.equal(service.current.id,'existing');
});
function session() {
  const writes=[];const service=new MicrophoneService({meetingsDir:'unused'});
  const s={id:'qa',token:'secret',ready:true,mode:'microphone',sequence:0,lastAudio:0,laneFrames:{mic:0,system:0},laneOffsets:{},
    wav:{write:data=>writes.push(data),close:()=>writes.push('close')},
    child:{stdin:{writableLength:0,write:data=>writes.push(JSON.parse(data)),end:()=>writes.push('end')},kill:()=>{}},status:()=>{}};
  service.current=s;return {service,s,writes};
}
test('BE-09 real audio rejects token sequence format lane and backpressure without mutation',()=>{
  for(const bad of ['token','sequence','odd','empty','large','lane','backpressure']) {
    const {service,s,writes}=session();if(bad==='backpressure')s.child.stdin.writableLength=1048577;
    assert.throws(()=>service.audio(bad==='token'?'wrong':'secret',bad==='sequence'?1:0,
      Buffer.alloc(bad==='empty'?0:bad==='odd'?3:bad==='large'?32002:4),bad==='lane'?'system':'mic'));
    assert.equal(s.sequence,0);assert.deepEqual(writes,[]);
  }
});
test('BE-10 real ordered PCM heartbeat and idempotent stop',t=>{
  const {service,s,writes}=session();t.after(()=>clearTimeout(s.stopTimer));
  service.audio('secret',0,Buffer.from([1,0,2,0]));assert.equal(s.sequence,1);assert.equal(s.laneFrames.mic,2);
  assert.equal(writes[1].pcm,Buffer.from([1,0,2,0]).toString('base64'));assert.equal(service.heartbeat('secret').ok,true);
  assert.throws(()=>service.heartbeat('wrong'));assert.throws(()=>service.stop('wrong'));
  assert.equal(service.stop('secret').state,'leaving');service.stop('secret');assert.equal(writes.filter(x=>x==='close').length,1);
  assert.throws(()=>service.audio('secret',1,Buffer.alloc(4)));assert.throws(()=>service.heartbeat('secret'));
});
test('BE-11 missing Windows device dependency returns JSON error and server survives',async t=>{
  const app=await api(t);const running=await startLiveServer({meetingsDir:app.root,port:0,microphone:{config:{home:path.join(app.root,'absent-python')}}});
  t.after(()=>running.shutdown());const r=await fetch(running.url+'/api/audio-devices');assert.equal(r.status,500);
  assert.equal(typeof (await r.json()).error,'string');assert.equal((await fetch(running.url+'/api/meetings')).status,200);
});
