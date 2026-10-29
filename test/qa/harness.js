import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright-core';
import {startLiveServer} from '../../src/live-server.js';
import {writeStatus} from '../../src/status.js';

export const runRoot=path.resolve(process.env.QA_OUTPUT || 'test/.tmp/qa/manual');
fs.mkdirSync(runRoot,{recursive:true});
export const devices={inputs:[{id:11,name:'QA microphone <script>'}],outputs:[{id:22,name:'QA headphones'}],defaultInput:11,defaultOutput:22};
export const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

// Real HTTP and browser PCM, isolated speech/device boundary. Never claims ASR quality.
export async function fixture() {
  const root=path.join(runRoot,'data-'+randomUUID());fs.mkdirSync(root,{recursive:true});
  const calls={start:[],audio:[],stop:[],heartbeat:[]};let current;
  const seed=(id='qa-first',patch={},records=[])=>{
    const dir=path.join(root,id);fs.mkdirSync(dir,{recursive:true});
    writeStatus(dir,{id,code:'qa',source:'meet',state:'in_call',...patch});
    fs.writeFileSync(path.join(dir,'transcript.jsonl'),records.map(x=>JSON.stringify(x)).join('\n'));
    return dir;
  };
  const microphone={
    async start(options){
      calls.start.push(options);if(current)throw new Error('已有本機收音工作');
      const id='qa-capture';seed(id,{source:options.mode || 'microphone'});
      current={id,token:'qa-only-token',sequence:0};return {...current};
    },
    audio(token,sequence,pcm){
      assert.ok(current,'Capture must exist');
      assert.equal(token,current?.token);assert.equal(sequence,current.sequence++);
      assert.ok(pcm.length>0 && pcm.length%2===0);calls.audio.push({sequence,bytes:pcm.length});
      if(calls.audio.length===2)seed(current.id,{source:'microphone'},[record('QA adapter transcript')]);
    },
    stop(token){
      assert.ok(current,'Capture must exist');
      assert.equal(token,current?.token);calls.stop.push(token);writeStatus(path.join(root,current.id),{state:'done'});
      const id=current.id;current=null;return {id,state:'leaving'};
    },
    heartbeat(token){assert.ok(current,'Capture must exist');assert.equal(token,current.token);calls.heartbeat.push(token);return {ok:true};},
  };
  const server=await startLiveServer({meetingsDir:root,port:0,microphone});
  return {...server,root,calls,seed,close:()=>server.shutdown()};
}
export function record(text,speaker='QA speaker',at='2026-01-01T00:00:00.000Z') {
  return {text,speaker,t0:at,t1:at};
}
export function consoleGuard(page) {
  const errors=[];
  page.on('pageerror',error=>errors.push({kind:'pageerror',text:error.stack || error.message}));
  page.on('console',message=>{if(message.type()==='error')errors.push({kind:'console.error',text:message.text(),location:message.location()});});
  return {errors,assertClean:()=>assert.deepEqual(errors,[],'Zero console/page errors required')};
}
export async function browserCase(t,run,{component,viewport={width:1920,height:1080},media=true}={}) {
  const app=await fixture();let browser,context,page,guard,failed=false;
  const dir=path.join(runRoot,t.name.replace(/[^a-zA-Z0-9_-]/g,'_'));fs.mkdirSync(dir,{recursive:true});
  try {
    browser=await chromium.launch({channel:'chrome',headless:true,args:media?['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']:[]});
    context=await browser.newContext({viewport});page=await context.newPage();
    page.setDefaultTimeout(5000);
    t.signal.addEventListener('abort',()=>{void context.close().catch(()=>{});},{once:true});
    guard=consoleGuard(page);
    await context.tracing.start({screenshots:true,snapshots:true,sources:true});
    await page.coverage.startJSCoverage({resetOnNavigation:false});
    // A missing favicon is not an app journey. No external requests are allowed.
    await context.route('**/favicon.ico',route=>route.fulfill({status:204}));
    await context.route('**/api/audio-devices',route=>route.fulfill({json:devices}));
    if(component==='transcript')await context.route('**/microphone.js',route=>route.fulfill({body:''}));

    await context.route(url=>!['127.0.0.1','localhost'].includes(url.hostname),route=>route.abort());
    await run({page,context,app,guard,dir,ui:new Viewer(page)});
    guard.assertClean();
  } catch(error) {
    failed=true;
    if(page){await page.screenshot({path:path.join(dir,'failure.png'),fullPage:true}).catch(()=>{});
      fs.writeFileSync(path.join(dir,'dom.html'),await page.content().catch(()=>''));}
    fs.writeFileSync(path.join(dir,'failure.txt'),error.stack || String(error));throw error;
  } finally {
    fs.writeFileSync(path.join(dir,'console.json'),JSON.stringify(guard?.errors || [],null,2));
    if(page){const entries=await page.coverage.stopJSCoverage().catch(()=>[]);
      fs.writeFileSync(path.join(dir,'coverage.json'),JSON.stringify(entries));}
    await context?.tracing.stop(failed?{path:path.join(dir,'trace.zip')}:{}).catch(()=>{});
    await browser?.close();await app.close();
  }
}
export class Viewer {
  constructor(page){this.page=page;this.source=page.getByRole('combobox',{name:/^收音方式/});
    this.transcript=page.getByRole('region',{name:'會議逐字稿'});
    this.start=page.getByRole('button',{name:'開始收音',exact:true});
    this.stop=page.getByRole('button',{name:'結束記錄',exact:true});}
  async text(value){await this.page.getByText(value,{exact:true}).waitFor({state:'visible',timeout:5000});}
  async capture(){
    if(!await this.source.isVisible()) await this.page.getByRole('button',{name:'＋ 新增記錄',exact:true}).click();
  }
  async open(app,query=''){await this.page.goto(app.url+'/'+query);await this.page.getByRole('heading',{name:'每個人的話，都跟得上。'}).waitFor();}
}
export function spec(test,id,body,options={}) {
  const bug=options.bug;
  test(id,{timeout:20000,skip:bug && !process.env.QA_REPRODUCE_BUGS?bug:false},t=>browserCase(t,body,options));
}
