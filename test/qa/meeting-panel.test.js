import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {browserCase,record} from './harness.js';
import {attachMeetingPanel,requestPanelStop} from '../../src/meeting-panel.js';
import {writeStatus} from '../../src/status.js';

for(const viewport of [{width:1920,height:1080},{width:390,height:844}])test(`PANEL-01 controls, safe live text and collapse ${viewport.width}`,{timeout:25000},t=>browserCase(t,async({page,app})=>{
  const dir=app.seed('panel',{state:'in_call',recordingControl:{enabled:false},stats:{audioSeconds:4,audioPeak:0,captionsOn:true}},[record('<script>window.pwned=true</script>')]);
  await attachMeetingPanel(page,{dir,origins:[app.url],canPause:true,onAction:async action=>{
    if(action==='stop')requestPanelStop(dir);else writeStatus(dir,{recordingControl:{enabled:action==='start'}});
  }});
  await page.goto(app.url);
  const start=page.getByRole('button',{name:'開始記錄',exact:true}), pause=page.getByRole('button',{name:'暫停記錄',exact:true});
  await start.waitFor({state:'visible'}); await start.click();
  await pause.waitFor({state:'visible'}); assert.equal(await start.isDisabled(),true);assert.equal(await pause.isEnabled(),true);
  await page.getByRole('log',{name:'即時逐字稿'}).getByText(/<script>/).waitFor();
  assert.equal(await page.evaluate(()=>window.pwned),undefined);
  await pause.click();assert.equal(await start.isEnabled(),true);
  await page.getByRole('button',{name:'收合 meeting AI 面板',exact:true}).click();
  assert.equal(await start.isVisible(),false);
  await page.getByRole('button',{name:'展開 meeting AI 面板',exact:true}).click();
  await page.getByRole('button',{name:'結束並整理',exact:true}).click();
  assert.ok(fs.existsSync(path.join(dir,'STOP')));
  assert.equal(await page.getByRole('button',{name:'結束並整理',exact:true}).isDisabled(),true);
},{viewport}));

test('PANEL-02 reload restores one panel and pending captions without changing native page controls',{timeout:25000},t=>browserCase(t,async({page,app})=>{
  const dir=app.seed('panel',{state:'in_call',stats:{audioPeak:120,audioSeconds:5,captionsOn:true}});
  fs.writeFileSync(path.join(dir,'live.json'),JSON.stringify({pending:[{speaker:'A',text:'即時測試1357'}]}));
  await attachMeetingPanel(page,{dir,origins:[app.url]});await page.goto(app.url);
  await page.getByRole('log',{name:'即時逐字稿'}).getByText(/即時測試1357/).waitFor();
  await page.reload();await page.getByRole('heading',{name:'meeting AI',exact:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'meeting AI',exact:true}).count(),1);
  await page.getByRole('heading',{name:'每個人的話，都跟得上。'}).waitFor();
}));

test('PANEL-03 rejected actions show feedback and always release busy controls',{timeout:25000},t=>browserCase(t,async({page,app})=>{
  const dir=app.seed('panel',{state:'in_call',recordingControl:{enabled:false}});
  let release;const pending=new Promise(resolve=>{release=resolve;});let calls=0;
  await attachMeetingPanel(page,{dir,origins:[app.url],onAction:async()=>{calls++;await pending;throw new Error('測試拒絕');}});
  await page.goto(app.url);const start=page.getByRole('button',{name:'開始記錄',exact:true});await start.click();
  assert.equal(await start.isDisabled(),true);assert.equal(calls,1);release();
  await page.getByRole('alert').filter({hasText:'測試拒絕'}).waitFor();assert.equal(await start.isEnabled(),true);
}));

test('PANEL-04 non-meeting origins never receive a control panel',{timeout:20000},t=>browserCase(t,async({page,app})=>{
  const dir=app.seed('panel',{state:'in_call'});
  await attachMeetingPanel(page,{dir,origins:['https://meet.google.com']});await page.goto(app.url);
  await page.getByRole('heading',{name:'每個人的話，都跟得上。'}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'meeting AI',exact:true}).count(),0);
}));

test('PANEL-05 iframe and unknown actions cannot control the recorder',{timeout:20000},t=>browserCase(t,async({page,app})=>{
  const dir=app.seed('panel',{state:'in_call'});let actions=0;
  await attachMeetingPanel(page,{dir,origins:[app.url],onAction:async()=>{actions++;}});await page.goto(app.url);
  await page.getByRole('heading',{name:'meeting AI',exact:true}).waitFor();
  const bad=await page.evaluate(async()=>{const key=Object.keys(window).find(x=>x.startsWith('__omPanel_'));try{await window[key]({action:'delete-files'});return 'accepted';}catch(e){return e.message;}});
  assert.match(bad,/invalid_action/);
  const attached=page.waitForEvent('frameattached');
  await page.evaluate(()=>{const frame=document.createElement('iframe');frame.srcdoc='<p>local iframe</p>';document.body.append(frame);});
  const frame=await attached;await frame.waitForLoadState('domcontentloaded');
  const denied=await frame.evaluate(async()=>{const key=Object.keys(window).find(x=>x.startsWith('__omPanel_'));try{await window[key]({action:'stop'});return 'accepted';}catch(e){return e.message;}});
  assert.match(denied,/origin_rejected/);assert.equal(actions,0);
  assert.equal(await frame.getByRole('heading',{name:'meeting AI',exact:true}).count(),0);
}));
